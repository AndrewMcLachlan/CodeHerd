import * as pty from 'node-pty';
import { execSync } from 'child_process';
import type { TabId, FolderPath, SessionId } from '../shared/types';
import { v4 as uuidv4 } from 'uuid';

interface PtyEntry {
  process: pty.IPty;
  sessionId: SessionId;
}

export class PtyManager {
  private ptys = new Map<TabId, PtyEntry>();

  spawn(
    tabId: TabId,
    folder: FolderPath,
    resumeSessionId?: SessionId,
    cols?: number,
    rows?: number,
  ): { sessionId: SessionId } {
    const sessionId = resumeSessionId ?? uuidv4();

    const args: string[] = [];
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    } else {
      args.push('--session-id', sessionId);
    }

    // On Windows, spawn via cmd.exe so node-pty gets a proper console
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const shellArgs = process.platform === 'win32'
      ? ['/c', 'claude', ...args]
      : ['-c', `claude ${args.join(' ')}`];

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: folder,
      env: { ...process.env } as Record<string, string>,
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

      // Force kill the entire process tree after 2 seconds
      setTimeout(() => {
        if (!resolved) {
          this.forceKillTree(pid);
          done();
        }
      }, 2000);
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
