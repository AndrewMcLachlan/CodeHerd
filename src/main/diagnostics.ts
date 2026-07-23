import * as fs from 'fs';
import * as path from 'path';

/**
 * Raw PTY logging captures every byte the terminal shows — prompts, conversation
 * content, and potentially secrets — and grows without bound, so it is strictly
 * opt-in for debugging sessions: set CODEHERD_PTY_DEBUG=1 or pass --pty-debug.
 */
export function isPtyDebugEnabled(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  const value = env.CODEHERD_PTY_DEBUG;
  if (value && value !== '0' && value.toLowerCase() !== 'false') return true;
  return argv.includes('--pty-debug');
}

/**
 * Delete raw PTY debug logs left behind by earlier runs (older releases wrote
 * them unconditionally). Best-effort; returns the number of files removed.
 */
export function cleanPtyDebugLogs(dir: string): number {
  let removed = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/^pty-debug-.+\.log$/.test(name)) continue;
      try {
        fs.unlinkSync(path.join(dir, name));
        removed++;
      } catch {
        // in use or already gone
      }
    }
  } catch {
    // directory unreadable — nothing to clean
  }
  return removed;
}
