import { execFile } from 'child_process';
import { claudeCommand, getLoginShellEnv } from './claude-cli';
import type { FolderPath, SessionId } from '../shared/types';

/** A Claude Code session that is currently alive, as reported by `claude agents --json`. */
export interface LiveSession {
  sessionId: SessionId;
  /** Short job id — the handle `claude attach <id>` takes. Background agents only. */
  agentId?: string;
  kind: 'background' | 'interactive';
  pid: number;
  cwd: FolderPath;
  name?: string;
}

/** Serve a cached snapshot for this long before shelling out again. */
const TTL_MS = 5_000;
/** Floor on forced refreshes, so an unrecognised session id can't cause a spawn storm. */
const MIN_REFRESH_MS = 1_000;

interface AgentJson {
  pid?: number;
  id?: string;
  cwd?: string;
  kind?: string;
  sessionId?: string;
  name?: string;
}

function parseAgents(stdout: string): Map<SessionId, LiveSession> {
  const live = new Map<SessionId, LiveSession>();
  const rows: unknown = JSON.parse(stdout);
  if (!Array.isArray(rows)) return live;

  for (const row of rows as AgentJson[]) {
    if (!row || typeof row.sessionId !== 'string') continue;
    // --json reports 'background'; the on-disk registry says 'bg'. Accept both so a
    // change in which spelling surfaces here can't silently reclassify an agent.
    const isBackground = row.kind === 'background' || row.kind === 'bg';
    live.set(row.sessionId, {
      sessionId: row.sessionId,
      kind: isBackground ? 'background' : 'interactive',
      pid: typeof row.pid === 'number' ? row.pid : 0,
      cwd: typeof row.cwd === 'string' ? row.cwd : '',
      ...(typeof row.id === 'string' ? { agentId: row.id } : {}),
      ...(typeof row.name === 'string' ? { name: row.name } : {}),
    });
  }
  return live;
}

/**
 * Live view of Claude Code's sessions, via `claude agents --json`.
 *
 * Background agents are the reason this exists: `claude --resume <id>` refuses while an
 * agent's process is alive, directing you to attach instead. Nothing in history.jsonl
 * distinguishes them — a background agent logs prompts against the same project folder
 * as any other session — so this is the only way to tell a session we can resume from
 * one we must `claude attach` to.
 *
 * We shell out rather than read ~/.claude/sessions/*.json directly: that layout is
 * internal to Claude Code and changes between releases, whereas --json is documented for
 * scripting and needs no TTY. The call costs ~1s, hence the cache.
 */
export class AgentRegistry {
  private live = new Map<SessionId, LiveSession>();
  private fetchedAt = 0;
  private inflight: Promise<void> | null = null;

  /** Warm the cache so the first tab restore doesn't wait on the spawn. */
  prime(): void {
    void this.refresh(TTL_MS);
  }

  /** Every live session, keyed by session id. */
  async snapshot(): Promise<ReadonlyMap<SessionId, LiveSession>> {
    await this.refresh(TTL_MS);
    return this.live;
  }

  /**
   * The live background agent owning this session, or undefined if there isn't one —
   * either an ordinary session or an agent that has since exited, both of which resume
   * normally.
   */
  async getBackgroundAgent(sessionId: SessionId): Promise<LiveSession | undefined> {
    await this.refresh(TTL_MS);
    // An id we've never seen may belong to a session started since the last fetch — pay
    // for a fresh read rather than mis-classify it.
    if (!this.live.has(sessionId)) await this.refresh(MIN_REFRESH_MS);
    const session = this.live.get(sessionId);
    return session?.kind === 'background' ? session : undefined;
  }

  private refresh(maxAgeMs: number): Promise<void> {
    if (Date.now() - this.fetchedAt <= maxAgeMs) return Promise.resolve();
    if (this.inflight) return this.inflight;
    this.inflight = this.fetch().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private fetch(): Promise<void> {
    const { file, args } = claudeCommand(['agents', '--json']);
    return new Promise<void>(resolve => {
      execFile(
        file,
        args,
        { env: getLoginShellEnv(), timeout: 10_000, windowsHide: true },
        (err, stdout) => {
          // Rate-limit failures too (an old CLI without --json would otherwise make every
          // lookup pay for a spawn); keep the last good snapshot rather than assuming the
          // agents have gone away.
          this.fetchedAt = Date.now();
          if (!err) {
            try {
              this.live = parseAgents(stdout);
            } catch {
              // Unexpected output shape — keep what we had.
            }
          }
          resolve();
        },
      );
    });
  }
}
