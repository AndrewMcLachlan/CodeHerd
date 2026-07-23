import { spawn } from 'child_process';
import * as path from 'path';

export type SquirrelSpawn = (file: string, args: string[]) => void;

const defaultSpawn: SquirrelSpawn = (file, args) => {
  try {
    spawn(file, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Update.exe missing (e.g. running from the portable zip) — nothing to do.
  }
};

/**
 * Handle Squirrel.Windows installer lifecycle events. The installer relaunches
 * the app with a `--squirrel-*` flag during install, update, and uninstall;
 * when that happens we do the shortcut work and return true so the caller
 * quits without opening a window.
 *
 * Shortcuts go to the Start Menu ONLY — never the desktop. Users who want a
 * desktop icon can create one from the Start Menu entry themselves.
 */
export function handleSquirrelEvent(
  argv: readonly string[] = process.argv,
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
  spawnFn: SquirrelSpawn = defaultSpawn,
): boolean {
  if (platform !== 'win32' || argv.length <= 1) return false;

  // Installed layout: %LocalAppData%\codeherd\Update.exe above app-<version>\codeherd.exe.
  // Explicit win32 path semantics: these are always Windows paths, and the generic
  // `path` would misparse the backslashes when the tests run on macOS/Linux.
  const updateExe = path.win32.resolve(path.win32.dirname(execPath), '..', 'Update.exe');
  const exeName = path.win32.basename(execPath);

  switch (argv[1]) {
    case '--squirrel-install':
    case '--squirrel-updated':
      spawnFn(updateExe, [`--createShortcut=${exeName}`, '--shortcut-locations=StartMenu']);
      return true;
    case '--squirrel-uninstall':
      spawnFn(updateExe, [`--removeShortcut=${exeName}`, '--shortcut-locations=StartMenu']);
      return true;
    case '--squirrel-obsolete':
      // An older version being cleaned up after an update — just exit.
      return true;
    case '--squirrel-firstrun':
      // Normal launch; Squirrel only marks that this is the first run.
      return false;
  }
  return false;
}
