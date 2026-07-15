import * as pty from 'node-pty';
import { execSync } from 'child_process';
import type { TabId, FolderPath, SessionId } from '../shared/types';
import { v4 as uuidv4 } from 'uuid';
import { getLoginShellEnv, resolveClaudePath } from './claude-cli';

interface PtyEntry {
  process: pty.IPty;
  sessionId: SessionId;
}

export interface SpawnOptions {
  /** Resume this session (`claude --resume`). Also becomes the tab's session id. */
  resumeSessionId?: SessionId;
  /**
   * Attach to a live background agent by job id (`claude attach`) instead of resuming.
   * Pair with resumeSessionId so the tab still tracks the agent's session id.
   */
  attachAgentId?: string;
  cols?: number;
  rows?: number;
}

/** The claude CLI invocation for a tab: attach, resume, or start fresh. */
export function buildClaudeArgs(sessionId: SessionId, options: SpawnOptions): string[] {
  if (options.attachAgentId) {
    // A live background agent refuses --resume; attaching hands us the running session,
    // the same as picking it out of `claude agents`.
    return ['attach', options.attachAgentId];
  }
  if (options.resumeSessionId) return ['--resume', options.resumeSessionId];
  return ['--session-id', sessionId];
}

export class PtyManager {
  private ptys = new Map<TabId, PtyEntry>();
  private shellEnv = getLoginShellEnv();

  spawn(tabId: TabId, folder: FolderPath, options: SpawnOptions = {}): { sessionId: SessionId } {
    const { resumeSessionId, cols, rows } = options;
    const sessionId = resumeSessionId ?? uuidv4();
    const args = buildClaudeArgs(sessionId, options);

    // On Windows, spawn via cmd.exe so node-pty gets a proper console.
    // On macOS/Linux, use the user's login shell so their PATH is loaded
    // (critical when the app is launched from Finder/dock rather than terminal).
    const isWin = process.platform === 'win32';
    const userShell = process.env.SHELL || '/bin/zsh';
    const shell = isWin ? 'cmd.exe' : userShell;

    // Resolve claude's full path from the login shell env, since the
    // non-interactive PTY shell may not have it on PATH.
    const claudePath = resolveClaudePath();

    const shellArgs = isWin
      ? ['/c', claudePath, ...args]
      : ['-l', '-c', `${claudePath} ${args.join(' ')}`];

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: folder,
      env: { ...this.shellEnv, TERM: 'xterm-256color', SHELL: userShell },
    });

    this.ptys.set(tabId, { process: ptyProcess, sessionId });
    return { sessionId };
  }

  onData(tabId: TabId, callback: (data: string) => void): void {
    const entry = this.ptys.get(tabId);
    if (entry) {
      entry.process.onData(callback);
    }
  }

  onExit(tabId: TabId, callback: (exitCode: number) => void): void {
    const entry = this.ptys.get(tabId);
    if (entry) {
      entry.process.onExit(({ exitCode }) => callback(exitCode));
    }
  }

  write(tabId: TabId, data: string): void {
    this.ptys.get(tabId)?.process.write(data);
  }

  resize(tabId: TabId, cols: number, rows: number): void {
    const entry = this.ptys.get(tabId);
    if (entry) {
      try {
        entry.process.resize(cols, rows);
      } catch {
        // Resize can fail if the process has already exited
      }
    }
  }

  /** Kill the entire process tree (Windows: taskkill /T, Unix: kill group) */
  private forceKillTree(pid: number): void {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' });
      } else {
        process.kill(-pid, 'SIGKILL');
      }
    } catch {
      // Process may already be dead
    }
  }

  /** Graceful shutdown: double Ctrl+C to quit, tree-kill as fallback */
  gracefulKill(tabId: TabId): Promise<void> {
    const entry = this.ptys.get(tabId);
    if (!entry) return Promise.resolve();

    const pid = entry.process.pid;

    return new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          this.ptys.delete(tabId);
          resolve();
        }
      };

      // Listen for process exit
      entry.process.onExit(() => done());

      // Double Ctrl+C in quick succession signals Claude Code to quit
      try {
        entry.process.write('\x03');
        entry.process.write('\x03');
      } catch {
        // Process may already be dead
        done();
        return;
      }

      // Force kill the entire process tree after 5 seconds
      setTimeout(() => {
        if (!resolved) {
          this.forceKillTree(pid);
          done();
        }
      }, 5000);
    });
  }

  async gracefulKillAll(): Promise<void> {
    const kills = Array.from(this.ptys.keys()).map(id => this.gracefulKill(id));
    await Promise.all(kills);
  }

  getSessionId(tabId: TabId): SessionId | undefined {
    return this.ptys.get(tabId)?.sessionId;
  }
}
