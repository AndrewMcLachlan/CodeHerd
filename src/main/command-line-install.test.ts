import { describe, expect, it } from 'vitest';
import { launcherScript, userPathScript } from './command-line-install';

describe('launcherScript', () => {
  it('starts the Squirrel stub with the caller\'s directory and arguments', () => {
    expect(launcherScript).toContain('start "" "%~dp0..\\codeherd.exe" --cwd="%CD%\\." %*');
  });
});

describe('userPathScript', () => {
  it('quotes the folder for PowerShell', () => {
    expect(userPathScript("C:\\Users\\o'brien\\bin", 'add')).toContain("$dir = 'C:\\Users\\o''brien\\bin'");
  });

  it('appends only when the folder is missing', () => {
    expect(userPathScript('C:\\bin', 'add')).toContain('if ($others.Count -ne $entries.Count) { exit 0 }; $others += $dir');
  });

  it('writes only when there is an entry to remove', () => {
    const script = userPathScript('C:\\bin', 'remove');
    expect(script).toContain('if ($others.Count -eq $entries.Count) { exit 0 }');
    expect(script).not.toContain('+= $dir');
  });
});
