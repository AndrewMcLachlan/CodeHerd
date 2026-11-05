import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type PathChange = 'add' | 'remove';

/** Puts `codeherd` on the user's PATH (or takes it off), given the Squirrel install root. */
export type CommandLineInstaller = (rootDir: string, change: PathChange) => void;

/**
 * `bin\codeherd.cmd`: starts the Squirrel stub, which always runs the newest installed version.
 * `start` stops cmd waiting on a GUI app. `%CD%\.` keeps a drive root's trailing backslash from escaping the quote.
 */
export const launcherScript = '@echo off\r\nstart "" "%~dp0..\\codeherd.exe" --cwd="%CD%\\." %*\r\n';

/** PowerShell that adds or removes `dir` in the user PATH, keeping other entries unexpanded, then tells Explorer. */
export function userPathScript(dir: string, change: PathChange): string {
  const quoted = `'${dir.replace(/'/g, "''")}'`;
  return [
    `$dir = ${quoted}`,
    `$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)`,
    `$entries = @(([string]$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')) -split ';' | Where-Object { $_ })`,
    `$others = @($entries | Where-Object { $_.TrimEnd('\\') -ne $dir.TrimEnd('\\') })`,
    change === 'add'
      ? `if ($others.Count -ne $entries.Count) { exit 0 }; $others += $dir`
      : `if ($others.Count -eq $entries.Count) { exit 0 }`,
    `$key.SetValue('Path', ($others -join ';'), 'ExpandString')`,
    // Setting any user variable through .NET broadcasts WM_SETTINGCHANGE, so new terminals see the PATH.
    `[Environment]::SetEnvironmentVariable('CodeHerdPathRefresh', '1', 'User')`,
    `[Environment]::SetEnvironmentVariable('CodeHerdPathRefresh', $null, 'User')`,
  ].join('\n');
}

export const installCommandLine: CommandLineInstaller = (rootDir, change) => {
  const binDir = path.win32.join(rootDir, 'bin');
  try {
    if (change === 'add') {
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.win32.join(binDir, 'codeherd.cmd'), launcherScript);
    }
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', userPathScript(binDir, change)], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch {
    // A PATH entry is a convenience; failing to add one must never fail the install.
  }
};
