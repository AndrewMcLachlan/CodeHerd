import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_SESSIONS_DIR } from '../shared/constants';

/** EPERM means the process exists but belongs to someone else, which still counts as alive. */
function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Session ids that currently have a live Claude process behind them.
 *
 * Claude writes one `~/.claude/sessions/<pid>.json` per running CLI holding the
 * session id that process is on right now, so a tab whose session id appears here
 * is still on that session and cannot be the tab that rolled forward to a new one.
 * Files outlive their process, hence the liveness check.
 */
export function readLiveSessionIds(
  dir: string = CLAUDE_SESSIONS_DIR,
  isAlive: (pid: number) => boolean = pidIsAlive,
): Set<string> {
  const live = new Set<string>();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return live;
  }

  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const entry: unknown = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
      const record = entry as { pid?: unknown; sessionId?: unknown };
      if (typeof record.pid !== 'number' || typeof record.sessionId !== 'string') continue;
      if (isAlive(record.pid)) live.add(record.sessionId);
    } catch {
      // unreadable, or caught mid-write — skip it
    }
  }
  return live;
}
