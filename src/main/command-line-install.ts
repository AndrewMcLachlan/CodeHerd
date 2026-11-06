import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type PathChange = 'add' | 'remove';

/** Puts `codeherd` on the user's PATH (or takes it off), given the Squirrel install root. */
export type CommandLineInstaller = (rootDir: string, change: PathChange, version: string) => void;

/**
 * `bin\codeherd.cmd`: starts the Squirrel stub, which always runs the newest installed version.
 * `start` stops cmd waiting on a GUI app. `%CD%\.` keeps a drive root's trailing backslash from escaping the quote.
 * The script answers `--version` itself because output from the GUI app can't reach the caller's console.
 */
export const launcherScript = (version: string) => [
  '@echo off',
  'if /i "%~1"=="--version" goto version',
  'if /i "%~1"=="-v" goto version',
  'start "" "%~dp0..\\codeherd.exe" --cwd="%CD%\\." %*',
  'exit /b',
  ':version',
  `echo ${version}`,
  '',
].join('\r\n');

const sameEntry = (a: string, b: string) => a.replace(/\\+$/, '').toLowerCase() === b.replace(/\\+$/, '').toLowerCase();

/** `current` with `dir` added or removed, or null when it already says what was asked. */
export function changePath(current: string, dir: string, change: PathChange): string | null {
  const entries = current.split(';').filter(entry => entry.trim());
  const others = entries.filter(entry => !sameEntry(entry, dir));
  if (change === 'add') return others.length === entries.length ? [...entries, dir].join(';') : null;
  return others.length === entries.length ? null : others.join(';');
}

/** The user PATH as `reg query` prints it, unexpanded. Empty when the value doesn't exist. */
export function parseRegQuery(output: string): { value: string; type: string } {
  const match = /^\s*Path\s+(REG_\w+)(?:[ \t]+(.*?))?\s*$/im.exec(output);
  return match ? { value: match[2] ?? '', type: match[1] } : { value: '', type: 'REG_EXPAND_SZ' };
}

const environmentKey = 'HKCU\\Environment';

export const installCommandLine: CommandLineInstaller = (rootDir, change, version) => {
  const binDir = path.win32.join(rootDir, 'bin');
  try {
    if (change === 'add') {
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.win32.join(binDir, 'codeherd.cmd'), launcherScript(version));
    }
    let query = '';
    try {
      query = execFileSync('reg.exe', ['query', environmentKey, '/v', 'Path'], { encoding: 'utf8', windowsHide: true });
    } catch {
      // No user PATH yet: reg exits non-zero and there is nothing to keep.
    }
    const current = parseRegQuery(query);
    const next = changePath(current.value, binDir, change);
    if (next === null) return;
    const type = current.type === 'REG_SZ' && !next.includes('%') ? 'REG_SZ' : 'REG_EXPAND_SZ';
    execFileSync('reg.exe', ['add', environmentKey, '/v', 'Path', '/t', type, '/d', next, '/f'], { windowsHide: true, stdio: 'ignore' });
  } catch (err) {
    // A PATH entry is a convenience; failing to add one must never fail the install.
    try {
      fs.mkdirSync(binDir, { recursive: true });
      fs.appendFileSync(path.win32.join(binDir, 'install.log'), `${new Date().toISOString()} ${change} failed: ${String(err)}\r\n`);
    } catch {
      // Nowhere to report it.
    }
  }
};
