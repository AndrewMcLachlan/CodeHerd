import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { parseOpenRequest } from './open-request';

const cwd = path.resolve('/work');
const anyFolder = () => true;
const sessionId = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('parseOpenRequest', () => {
  it('resolves a relative folder against the working directory', () => {
    expect(parseOpenRequest(['codeherd.exe', 'repo'], cwd, 0, anyFolder)).toEqual({ folder: path.join(cwd, 'repo') });
  });

  it('opens the working directory for "."', () => {
    expect(parseOpenRequest(['codeherd.exe', '.'], cwd, 0, anyFolder)).toEqual({ folder: cwd });
  });

  it('resolves against --cwd when the launcher passes one', () => {
    const elsewhere = path.resolve('/elsewhere');
    expect(parseOpenRequest(['codeherd.exe', `--cwd=${elsewhere}${path.sep}.`, 'repo'], cwd, 0, anyFolder)).toEqual({ folder: path.join(elsewhere, 'repo') });
    expect(parseOpenRequest(['codeherd.exe', '--cwd', elsewhere, '.'], cwd, 0, anyFolder)).toEqual({ folder: elsewhere });
  });

  it('reads the agent in either flag form', () => {
    expect(parseOpenRequest(['codeherd.exe', '--agent', 'codex', 'repo'], cwd, 0, anyFolder)).toEqual({ folder: path.join(cwd, 'repo'), agent: 'codex' });
    expect(parseOpenRequest(['codeherd.exe', 'repo', '--agent=Claude'], cwd, 0, anyFolder)).toEqual({ folder: path.join(cwd, 'repo'), agent: 'claude' });
  });

  it('ignores an unknown agent', () => {
    expect(parseOpenRequest(['codeherd.exe', 'repo', '--agent', 'gpt'], cwd, 0, anyFolder)).toEqual({ folder: path.join(cwd, 'repo') });
  });

  it('reads a session to resume in any flag form and position', () => {
    const expected = { folder: path.join(cwd, 'repo'), resumeSessionId: sessionId };
    expect(parseOpenRequest(['codeherd.exe', 'repo', '--resume', sessionId], cwd, 0, anyFolder)).toEqual(expected);
    expect(parseOpenRequest(['codeherd.exe', '--resume', sessionId, 'repo'], cwd, 0, anyFolder)).toEqual(expected);
    expect(parseOpenRequest(['codeherd.exe', `--resume=${sessionId}`, 'repo'], cwd, 0, anyFolder)).toEqual(expected);
    expect(parseOpenRequest(['codeherd.exe', '-r', sessionId, 'repo'], cwd, 0, anyFolder)).toEqual(expected);
  });

  it('keeps the agent alongside a resumed session', () => {
    expect(parseOpenRequest(['codeherd.exe', 'repo', '--agent', 'codex', '--resume', sessionId], cwd, 0, anyFolder)).toEqual({ folder: path.join(cwd, 'repo'), agent: 'codex', resumeSessionId: sessionId });
  });

  it('resumes in the working directory when no folder is given', () => {
    expect(parseOpenRequest(['codeherd.exe', '--resume', sessionId], cwd, 0, anyFolder)).toEqual({ folder: cwd, resumeSessionId: sessionId });
    expect(parseOpenRequest(['electron.exe', '.', '--resume', sessionId], cwd, 1, anyFolder)).toEqual({ folder: cwd, resumeSessionId: sessionId });
  });

  it('treats --resume without an id as a request for the folder', () => {
    expect(parseOpenRequest(['codeherd.exe', '--resume'], cwd, 0, anyFolder)).toEqual({ folder: cwd });
    expect(parseOpenRequest(['codeherd.exe', '--resume', 'repo'], cwd, 0, anyFolder)).toEqual({ folder: path.join(cwd, 'repo') });
  });

  it('ignores a resume value that is not a session id', () => {
    expect(parseOpenRequest(['codeherd.exe', 'repo', '--resume=latest'], cwd, 0, anyFolder)).toEqual({ folder: path.join(cwd, 'repo') });
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
