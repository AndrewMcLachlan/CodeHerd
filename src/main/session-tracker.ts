import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { CLAUDE_HISTORY_FILE, CLAUDE_PROJECTS_DIR } from '../shared/constants';
import type { AgentSession, AgentType, FolderPath, SessionId } from '../shared/types';
import type { AgentRegistry } from './agent-registry';
import { diagnoseSessionListing, type SessionProblem } from './session-diagnosis';
import {
  CodexSessionTracker,
  type CodexSessionRef,
  type CodexSessionRuntime,
  type CodexSessionStatus,
} from './codex-session-tracker';

interface SessionAccumulator {
  /** Most recent prompt that isn't a slash command */
  lastMeaningfulPrompt: string | null;
  /** Most recent prompt of any kind (fallback label) */
  lastPrompt: string | null;
  timestamp: number;
  /** Project path as Claude Code recorded it (used to locate the transcript dir) */
  rawProject: string;
}

/**
 * A folder's sessions, plus why the list is empty or short when it is. The reason
 * matters: "you have never used an agent here" and "CodeHerd can no longer read
 * your sessions" both rendered as an empty list before.
 */
export interface SessionListing {
  sessions: AgentSession[];
  problem: SessionProblem | null;
}

export class SessionTracker {
  private codex = new CodexSessionTracker();

  /** Path parameters exist for tests; production callers use the defaults. */
  constructor(
    private agents: AgentRegistry,
    private historyFile: string = CLAUDE_HISTORY_FILE,
    private projectsDir: string = CLAUDE_PROJECTS_DIR,
  ) {}

  async getSessionsForFolder(folder: FolderPath, agent: AgentType): Promise<SessionListing> {
    if (agent === 'codex') return this.codex.getSessionListingForFolder(folder);
    return this.getClaudeSessionsForFolder(folder);
  }

  getCodexSessionRefs(): Promise<CodexSessionRef[]> {
    return this.codex.getAllSessionRefs();
  }

  getCodexSessionRef(sessionId: string): Promise<CodexSessionRef | undefined> {
    return this.codex.getSessionRef(sessionId);
  }

  getCodexSessionStatus(ref: CodexSessionRef): CodexSessionStatus | null {
    return this.codex.getSessionStatus(ref);
  }

  getCodexSessionRuntime(ref: CodexSessionRef): CodexSessionRuntime {
    return this.codex.getSessionRuntime(ref);
  }

  private async getClaudeSessionsForFolder(folder: FolderPath): Promise<SessionListing> {
    if (!fs.existsSync(this.historyFile)) {
      return { sessions: [], problem: diagnoseSessionListing({ storeExists: false, linesRead: 0, linesParsed: 0, sessions: 0 }) };
    }

    const accumulators = new Map<string, SessionAccumulator>();
    // Counted so a format change is distinguishable from an empty history.
    let linesRead = 0;
    let linesParsed = 0;
    let readFailed = false;

    try {
      const stream = fs.createReadStream(this.historyFile, { encoding: 'utf-8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!line.trim()) continue;
        linesRead++;
        try {
          const entry = JSON.parse(line);
          // Normalize paths for comparison (handle Windows backslash vs forward slash)
          const entryProject = (entry.project || '').replace(/\\/g, '/').toLowerCase();
          const targetFolder = folder.replace(/\\/g, '/').toLowerCase();

          if (entryProject === targetFolder && entry.sessionId) {
            const acc = accumulators.get(entry.sessionId) ?? {
              lastMeaningfulPrompt: null,
              lastPrompt: null,
              timestamp: 0,
              rawProject: entry.project || folder,
            };
            const display = (entry.display || entry.prompt || '').trim();
            if (display) {
              acc.lastPrompt = display;
              // Slash commands like /exit or /clear make useless labels —
              // prefer the last real prompt (#70)
              if (!display.startsWith('/')) {
                acc.lastMeaningfulPrompt = display;
              }
            }
            acc.timestamp = entry.timestamp || acc.timestamp;
            accumulators.set(entry.sessionId, acc);
          }
          linesParsed++;
        } catch {
          // Skip malformed lines; the tally above decides whether there are enough
          // of them to mean the format moved.
        }
      }
    } catch {
      readFailed = true;
    }

    // Background agents log prompts against their project folder just like any other
    // session, so the list can't tell them apart on history alone — tag them here, since
    // they need `claude attach` rather than --resume.
    const live = await this.agents.snapshot();

    // History entries outlive Claude Code's transcript cleanup, so drop any
    // session whose transcript is gone or holds no conversation — those
    // can't be resumed (#70)
    const sessions: AgentSession[] = [];
    for (const [sessionId, acc] of accumulators) {
      const transcript = path.join(
        this.projectsDir,
        acc.rawProject.replace(/[^a-zA-Z0-9]/g, '-'),
        `${sessionId}.jsonl`,
      );
      if (!(await this.isResumable(transcript))) continue;
      const agent = live.get(sessionId);
      sessions.push({
        agent: 'claude',
        sessionId,
        project: acc.rawProject,
        lastPrompt: acc.lastMeaningfulPrompt || acc.lastPrompt || '(no prompt)',
        timestamp: acc.timestamp,
        ...(agent?.kind === 'background' && agent.agentId ? { agentId: agent.agentId } : {}),
      });
    }

    // Sort by timestamp descending (most recent first)
    sessions.sort((a, b) => b.timestamp - a.timestamp);
    return {
      sessions,
      problem: diagnoseSessionListing({
        storeExists: true,
        linesRead,
        linesParsed,
        sessions: sessions.length,
        readFailed,
      }),
    };
  }

  /**
   * Whether `claude --resume <sessionId>` would find a conversation for a session
   * launched in `folder`. A tab opened but never used before the app closed has a
   * session id Claude never persisted, so resuming it prints "No conversation found"
   * into the tab — restore uses this to fall back to a fresh session instead.
   */
  async canResume(folder: FolderPath, sessionId: SessionId): Promise<boolean> {
    const transcript = path.join(
      this.projectsDir,
      folder.replace(/[^a-zA-Z0-9]/g, '-'),
      `${sessionId}.jsonl`,
    );
    return this.isResumable(transcript);
  }

  /**
   * A session can only be resumed if its transcript exists and contains at
   * least one user message — transcripts holding only metadata entries
   * (e.g. from /rename or /color) have no conversation to restore.
   */
  private async isResumable(transcriptPath: string): Promise<boolean> {
    const NEEDLE = '"type":"user"';
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(transcriptPath, 'r');
    } catch {
      return false;
    }
    try {
      const buf = Buffer.alloc(64 * 1024);
      let carry = '';
      let position = 0;
      for (;;) {
        const { bytesRead } = await handle.read(buf, 0, buf.length, position);
        if (bytesRead === 0) return false;
        const text = carry + buf.toString('utf-8', 0, bytesRead);
        if (text.includes(NEEDLE)) return true;
        // Keep the tail in case the needle straddles a chunk boundary
        carry = text.slice(-NEEDLE.length);
        position += bytesRead;
      }
    } catch {
      return false;
    } finally {
      await handle.close();
    }
  }
}
