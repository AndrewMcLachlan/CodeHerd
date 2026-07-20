import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { CLAUDE_HISTORY_FILE, CLAUDE_PROJECTS_DIR } from '../shared/constants';
import type { AgentSession, AgentType, FolderPath } from '../shared/types';
import type { AgentRegistry } from './agent-registry';
import { CodexSessionTracker, type CodexSessionRef, type CodexSessionStatus } from './codex-session-tracker';

interface SessionAccumulator {
  /** Most recent prompt that isn't a slash command */
  lastMeaningfulPrompt: string | null;
  /** Most recent prompt of any kind (fallback label) */
  lastPrompt: string | null;
  timestamp: number;
  /** Project path as Claude Code recorded it (used to locate the transcript dir) */
  rawProject: string;
}

export class SessionTracker {
  private codex = new CodexSessionTracker();

  constructor(private agents: AgentRegistry) {}

  async getSessionsForFolder(folder: FolderPath, agent: AgentType): Promise<AgentSession[]> {
    if (agent === 'codex') return this.codex.getSessionsForFolder(folder);
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

  private async getClaudeSessionsForFolder(folder: FolderPath): Promise<AgentSession[]> {
    if (!fs.existsSync(CLAUDE_HISTORY_FILE)) {
      return [];
    }

    const accumulators = new Map<string, SessionAccumulator>();

    const stream = fs.createReadStream(CLAUDE_HISTORY_FILE, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
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
      } catch {
        // Skip malformed lines
      }
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
        CLAUDE_PROJECTS_DIR,
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
    return sessions.sort((a, b) => b.timestamp - a.timestamp);
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
