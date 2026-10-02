import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readLiveSessionIds } from './live-sessions';

let dir: string;

const write = (name: string, body: unknown): void => {
  fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeherd-sessions-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('readLiveSessionIds', () => {
  it('returns the session ids of running processes', () => {
    write('100.json', { pid: 100, sessionId: 'sid-a' });
    write('200.json', { pid: 200, sessionId: 'sid-b' });
    expect(readLiveSessionIds(dir, () => true)).toEqual(new Set(['sid-a', 'sid-b']));
  });

  it('drops session files whose process has exited', () => {
    write('100.json', { pid: 100, sessionId: 'sid-a' });
    write('200.json', { pid: 200, sessionId: 'sid-b' });
    expect(readLiveSessionIds(dir, (pid) => pid === 200)).toEqual(new Set(['sid-b']));
  });

  it('ignores the sibling .key files Claude writes', () => {
    write('100.json', { pid: 100, sessionId: 'sid-a' });
    write('100.abc123.key', 'not json');
    expect(readLiveSessionIds(dir, () => true)).toEqual(new Set(['sid-a']));
  });

  it('skips malformed or partially written files', () => {
    write('100.json', { pid: 100, sessionId: 'sid-a' });
    write('200.json', '{"pid":200,"sessi');
    write('300.json', { pid: 300 });
    write('400.json', { sessionId: 'sid-d' });
    expect(readLiveSessionIds(dir, () => true)).toEqual(new Set(['sid-a']));
  });

  it('returns an empty set when the directory does not exist', () => {
    expect(readLiveSessionIds(path.join(dir, 'missing'), () => true)).toEqual(new Set());
  });

  it('treats a live pid owned by another user as alive', () => {
    write('100.json', { pid: 100, sessionId: 'sid-a' });
    const isAlive = (pid: number): boolean => {
      try {
        const err: NodeJS.ErrnoException = new Error('EPERM');
        err.code = 'EPERM';
        throw err;
      } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM' && pid === 100;
      }
    };
    expect(readLiveSessionIds(dir, isAlive)).toEqual(new Set(['sid-a']));
  });
});
