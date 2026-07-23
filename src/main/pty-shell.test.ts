import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPowerShellAgentCommand, resolveWindowsPtyShell } from './pty-shell';

let dir: string;

const makeShell = (name: string): string => {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, name);
  fs.writeFileSync(file, '');
  return binDir;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeherd-shell-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('resolveWindowsPtyShell', () => {
  it('prefers pwsh when the probe reports PowerShell 7+', () => {
    const binDir = makeShell('pwsh.EXE');
    const shell = resolveWindowsPtyShell({ PATH: binDir }, () => 7);
    expect(shell).toEqual({ executable: path.join(binDir, 'pwsh.EXE'), kind: 'pwsh' });
  });

  it('skips a pwsh older than 7', () => {
    makeShell('pwsh.EXE');
    const binDir = makeShell('powershell.EXE');
    const shell = resolveWindowsPtyShell({ PATH: binDir }, () => 5);
    expect(shell).toEqual({ executable: path.join(binDir, 'powershell.EXE'), kind: 'windows-powershell' });
  });

  it('skips pwsh when the probe fails', () => {
    makeShell('pwsh.EXE');
    const binDir = makeShell('powershell.EXE');
    expect(resolveWindowsPtyShell({ PATH: binDir }, () => null).kind).toBe('windows-powershell');
  });

  it('falls back to cmd from PATH when no PowerShell exists', () => {
    const binDir = makeShell('cmd.EXE');
    const shell = resolveWindowsPtyShell({ PATH: binDir }, () => null);
    expect(shell).toEqual({ executable: path.join(binDir, 'cmd.EXE'), kind: 'cmd' });
  });

  it('falls back to ComSpec, then a literal cmd.exe', () => {
    expect(resolveWindowsPtyShell({ PATH: dir, ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, () => null))
      .toEqual({ executable: 'C:\\Windows\\system32\\cmd.exe', kind: 'cmd' });
    expect(resolveWindowsPtyShell({}, () => null)).toEqual({ executable: 'cmd.exe', kind: 'cmd' });
  });
});

describe('buildPowerShellAgentCommand', () => {
  it('builds a call expression with single-quoted literals', () => {
    expect(buildPowerShellAgentCommand('C:\\bin\\claude.cmd', ['--session-id', 'abc']))
      .toBe("& 'C:\\bin\\claude.cmd' '--session-id' 'abc'");
  });

  it('escapes embedded single quotes so arguments cannot become script', () => {
    expect(buildPowerShellAgentCommand("C:\\od'd path\\claude.cmd", ["it's; Remove-Item x"]))
      .toBe("& 'C:\\od''d path\\claude.cmd' 'it''s; Remove-Item x'");
  });

  it('handles spaces and $ without expansion', () => {
    expect(buildPowerShellAgentCommand('C:\\Program Files\\claude.cmd', ['$env:SECRET']))
      .toBe("& 'C:\\Program Files\\claude.cmd' '$env:SECRET'");
  });
});
