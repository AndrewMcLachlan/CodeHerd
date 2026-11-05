import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { parseOpenRequest } from './open-request';

const cwd = path.resolve('/work');
const anyFolder = () => true;

describe('parseOpenRequest', () => {
  it('resolves a relative folder against the working directory', () => {
    expect(parseOpenRequest(['codeherd.exe', 'repo'], cwd, 0, anyFolder)).toEqual({ folder: path.join(cwd, 'repo') });
  });

  it('opens the working directory for "."', () => {
    expect(parseOpenRequest(['codeherd.exe', '.'], cwd, 0, anyFolder)).toEqual({ folder: cwd });
  });

  it('reads the agent in either flag form', () => {
    expect(parseOpenRequest(['codeherd.exe', '--agent', 'codex', 'repo'], cwd, 0, anyFolder)).toEqual({ folder: path.join(cwd, 'repo'), agent: 'codex' });
    expect(parseOpenRequest(['codeherd.exe', 'repo', '--agent=Claude'], cwd, 0, anyFolder)).toEqual({ folder: path.join(cwd, 'repo'), agent: 'claude' });
  });

  it('ignores an unknown agent', () => {
    expect(parseOpenRequest(['codeherd.exe', 'repo', '--agent', 'gpt'], cwd, 0, anyFolder)).toEqual({ folder: path.join(cwd, 'repo') });
  });

  it('ignores Chromium and app flags', () => {
    expect(parseOpenRequest(['codeherd.exe', '--diagnostics', '--allow-file-access-from-files', 'repo'], cwd, 0, anyFolder)).toEqual({ folder: path.join(cwd, 'repo') });
  });

  it('skips the app path an unpackaged run receives', () => {
    expect(parseOpenRequest(['electron.exe', '.', 'repo'], cwd, 1, anyFolder)).toEqual({ folder: path.join(cwd, 'repo') });
    expect(parseOpenRequest(['electron.exe', '.'], cwd, 1, anyFolder)).toBeNull();
  });

  it('returns null without a folder, or for one that does not exist', () => {
    expect(parseOpenRequest(['codeherd.exe', '--diagnostics'], cwd, 0, anyFolder)).toBeNull();
    expect(parseOpenRequest(['codeherd.exe', 'missing'], cwd, 0, () => false)).toBeNull();
  });
});
