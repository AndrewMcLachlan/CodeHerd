import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCommandPath } from './agent-detection';

let dir: string;

/** Create an empty file (executable on POSIX) and return its directory. */
const makeCommand = (name: string, subdir = 'bin'): string => {
  const binDir = path.join(dir, subdir);
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, name);
  fs.writeFileSync(file, '');
  if (process.platform !== 'win32') fs.chmodSync(file, 0o755);
  return binDir;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeherd-detect-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('resolveCommandPath (win32 semantics)', () => {
  // platform is passed explicitly, so these behave identically on any test host.
  const SEP = path.delimiter;

  it('finds a command through PATHEXT extensions', () => {
    const binDir = makeCommand('claude.CMD');
    const found = resolveCommandPath('claude', { PATH: binDir, PATHEXT: `.COM${SEP}.EXE${SEP}.BAT${SEP}.CMD` }, 'win32');
    expect(found).toBe(path.join(binDir, 'claude.CMD'));
  });

  it('falls back to default Windows extensions when PATHEXT is absent', () => {
    const binDir = makeCommand('codex.EXE');
    expect(resolveCommandPath('codex', { PATH: binDir }, 'win32')).toBe(path.join(binDir, 'codex.EXE'));
  });

  it('searches PATH entries in order', () => {
    const first = makeCommand('claude.EXE', 'first');
    const second = makeCommand('claude.EXE', 'second');
    const found = resolveCommandPath('claude', { PATH: `${first}${SEP}${second}` }, 'win32');
    expect(found).toBe(path.join(first, 'claude.EXE'));
  });

  it('strips quotes from PATH entries and skips empty segments', () => {
    const binDir = makeCommand('claude.EXE');
    const found = resolveCommandPath('claude', { PATH: `${SEP}"${binDir}"${SEP}` }, 'win32');
    expect(found).toBe(path.join(binDir, 'claude.EXE'));
  });

  it('reads PATH case-insensitively (Path vs PATH)', () => {
    const binDir = makeCommand('claude.EXE');
    expect(resolveCommandPath('claude', { Path: binDir }, 'win32')).not.toBeNull();
  });

  it('returns null when the command is absent or PATH is unset', () => {
    expect(resolveCommandPath('claude', { PATH: dir }, 'win32')).toBeNull();
    expect(resolveCommandPath('claude', {}, 'win32')).toBeNull();
  });

  it('does not match a directory with the command name', () => {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(path.join(binDir, 'claude.EXE'), { recursive: true });
    expect(resolveCommandPath('claude', { PATH: binDir }, 'win32')).toBeNull();
  });
});

describe('resolveCommandPath (posix semantics)', () => {
  it('finds an executable with no extension', () => {
    const binDir = makeCommand('claude');
    expect(resolveCommandPath('claude', { PATH: binDir }, 'linux')).toBe(path.join(binDir, 'claude'));
  });

  // The executable-bit check is meaningful only on a POSIX host.
  it.skipIf(process.platform === 'win32')('ignores files without the executable bit', () => {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'claude'), '');
    fs.chmodSync(path.join(binDir, 'claude'), 0o644);
    expect(resolveCommandPath('claude', { PATH: binDir }, 'linux')).toBeNull();
  });
});
