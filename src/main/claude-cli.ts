import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

let cachedEnv: Record<string, string> | null = null;

/**
 * The environment as the user's login shell sees it — critical when the app is launched
 * from Finder/dock rather than a terminal, where PATH would otherwise be minimal.
 * Memoized: the login+interactive shell spawn is slow enough to notice.
 */
export function getLoginShellEnv(): Record<string, string> {
  if (cachedEnv) return cachedEnv;

  if (process.platform === 'win32') {
    cachedEnv = { ...process.env } as Record<string, string>;
    return cachedEnv;
  }

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    // Run login+interactive shell to source both .zprofile and .zshrc
    const raw = execSync(`${shell} -l -i -c 'env'`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const env: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        env[line.substring(0, idx)] = line.substring(idx + 1);
      }
    }
    cachedEnv = env;
  } catch {
    cachedEnv = { ...process.env } as Record<string, string>;
  }
  return cachedEnv;
}

/**
 * Full path to the claude binary, resolved from the login shell's PATH since a
 * non-interactive PTY shell may not have it. On Windows we let cmd.exe resolve it,
 * which also handles the .cmd/.exe shim.
 */
export function resolveClaudePath(): string {
  if (process.platform === 'win32') return 'claude';
  return (
    getLoginShellEnv()
      .PATH?.split(':')
      .map(p => path.join(p, 'claude'))
      .find(p => fs.existsSync(p)) || 'claude'
  );
}

/**
 * Command + args to run `claude <args>` as a plain (non-PTY) child process.
 * Windows goes through cmd.exe so the shim resolves, mirroring how PtyManager spawns.
 */
export function claudeCommand(args: string[]): { file: string; args: string[] } {
  const claudePath = resolveClaudePath();
  if (process.platform === 'win32') {
    return { file: 'cmd.exe', args: ['/c', claudePath, ...args] };
  }
  return { file: claudePath, args };
}
