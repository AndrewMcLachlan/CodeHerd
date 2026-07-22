import * as pty from 'node-pty';
import { execSync } from 'child_process';
import type { AgentType, TabId, FolderPath, SessionId } from '../shared/types';
import { v4 as uuidv4 } from 'uuid';
import { getLoginShellEnv } from './claude-cli';
import { resolveCommandPath } from './agent-detection';
import { buildPowerShellAgentCommand, resolveWindowsPtyShell } from './pty-shell';
import type { WindowsPtyShell } from './pty-shell';

interface PtyEntry {
  process: pty.IPty;
  sessionId: SessionId;
  agent: AgentType;
}

export interface SpawnOptions {
  /** Resume this session with the selected agent. Also becomes the tab's session id. */
  resumeSessionId?: SessionId;
  /**
   * Attach to a live background agent by job id (`claude attach`) instead of resuming.
   * Pair with resumeSessionId so the tab still tracks the agent's session id.
   */
  attachAgentId?: string;
  cols?: number;
  rows?: number;
}

/** Agent CLI arguments for attaching, resuming, or starting a fresh session. */
export function buildAgentArgs(agent: AgentType, sessionId: SessionId, options: SpawnOptions): string[] {
  if (agent === 'codex') {
    return options.resumeSessionId ? ['resume', options.resumeSessionId] : [];
  }
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
  private windowsPtyShell: WindowsPtyShell | null = null;

  spawn(tabId: TabId, agent: AgentType, folder: FolderPath, options: SpawnOptions = {}): { sessionId: SessionId } {
    const { resumeSessionId, cols, rows } = options;
    const sessionId = resumeSessionId ?? uuidv4();
    const args = buildAgentArgs(agent, sessionId, options);

    // On Windows, prefer PowerShell 7+, fall back to Windows PowerShell, and use
    // cmd.exe only as a last resort. On macOS/Linux, use the user's login shell
    // so their PATH is loaded (critical when launched from Finder/dock).
    const isWin = process.platform === 'win32';
    const userShell = process.env.SHELL || '/bin/zsh';
    const windowsShell = isWin
      ? (this.windowsPtyShell ??= resolveWindowsPtyShell(this.shellEnv))
      : null;
    const shell = windowsShell?.executable ?? userShell;

    // Resolve the agent's full path from the login shell env, since the
    // non-interactive PTY shell may not have it on PATH.
    const agentPath = resolveCommandPath(agent, this.shellEnv) || agent;
    const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

    const shellArgs = windowsShell
      ? (windowsShell.kind === 'cmd'
        ? ['/c', agent, ...args]
        : ['-NoLogo', '-Command', buildPowerShellAgentCommand(agentPath, args)])
      : ['-l', '-c', [agentPath, ...args].map(quote).join(' ')];

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: folder,
      env: { ...this.shellEnv, TERM: 'xterm-256color', SHELL: shell },
    });

    this.ptys.set(tabId, { process: ptyProcess, sessionId, agent });
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

  /** Graceful agent shutdown, with process-tree kill as a bounded fallback. */
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

      // Claude exits on a double interrupt. Codex documents /quit; interrupt first so
      // an in-flight turn returns to the composer before sending the command.
      try {
        if (entry.agent === 'codex') {
          entry.process.write('\x03');
          setTimeout(() => {
            if (!resolved) {
              try { entry.process.write('/quit\r'); } catch { done(); }
            }
          }, 150);
        } else {
          entry.process.write('\x03');
          entry.process.write('\x03');
        }
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

  setSessionId(tabId: TabId, sessionId: SessionId): void {
    const entry = this.ptys.get(tabId);
    if (entry) entry.sessionId = sessionId;
  }
}
