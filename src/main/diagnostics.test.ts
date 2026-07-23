import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanPtyDebugLogs, isPtyDebugEnabled } from './diagnostics';

describe('isPtyDebugEnabled', () => {
  it('is off by default', () => {
    expect(isPtyDebugEnabled({}, [])).toBe(false);
  });

  it('turns on via CODEHERD_PTY_DEBUG', () => {
    expect(isPtyDebugEnabled({ CODEHERD_PTY_DEBUG: '1' }, [])).toBe(true);
    expect(isPtyDebugEnabled({ CODEHERD_PTY_DEBUG: 'yes' }, [])).toBe(true);
  });

  it('treats 0/false/empty as off', () => {
    expect(isPtyDebugEnabled({ CODEHERD_PTY_DEBUG: '0' }, [])).toBe(false);
    expect(isPtyDebugEnabled({ CODEHERD_PTY_DEBUG: 'false' }, [])).toBe(false);
    expect(isPtyDebugEnabled({ CODEHERD_PTY_DEBUG: '' }, [])).toBe(false);
  });

  it('turns on via the --pty-debug argument', () => {
    expect(isPtyDebugEnabled({}, ['electron', '.', '--pty-debug'])).toBe(true);
  });
});

describe('cleanPtyDebugLogs', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeherd-diag-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes only pty-debug logs and reports the count', () => {
    fs.writeFileSync(path.join(dir, 'pty-debug-tab-1.log'), 'x');
    fs.writeFileSync(path.join(dir, 'pty-debug-tab-2.log'), 'x');
    fs.writeFileSync(path.join(dir, 'state.json'), '{}');
    fs.writeFileSync(path.join(dir, 'other.log'), 'x');

    expect(cleanPtyDebugLogs(dir)).toBe(2);
    expect(fs.readdirSync(dir).sort()).toEqual(['other.log', 'state.json']);
  });

  it('returns 0 for an empty or missing directory', () => {
    expect(cleanPtyDebugLogs(dir)).toBe(0);
    expect(cleanPtyDebugLogs(path.join(dir, 'nope'))).toBe(0);
  });
});
