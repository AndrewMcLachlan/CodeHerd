import { describe, expect, it } from 'vitest';
import { changePath, launcherScript, parseRegQuery } from './command-line-install';

const bin = 'C:\\Users\\u\\AppData\\Local\\codeherd\\bin';

describe('launcherScript', () => {
  it('starts the Squirrel stub with the caller\'s directory and arguments', () => {
    expect(launcherScript).toContain('start "" "%~dp0..\\codeherd.exe" --cwd="%CD%\\." %*');
  });
});

describe('changePath', () => {
  it('appends the folder, leaving other entries unexpanded', () => {
    expect(changePath('%USERPROFILE%\\tools;C:\\x', bin, 'add')).toBe(`%USERPROFILE%\\tools;C:\\x;${bin}`);
  });

  it('leaves a PATH that already has the folder alone, whatever its case or trailing slash', () => {
    expect(changePath(`C:\\x;${bin.toUpperCase()}\\`, bin, 'add')).toBeNull();
  });

  it('starts an empty PATH with the folder', () => {
    expect(changePath('', bin, 'add')).toBe(bin);
  });

  it('removes the folder and drops empty entries', () => {
    expect(changePath(`C:\\x;;${bin};%USERPROFILE%\\tools`, bin, 'remove')).toBe('C:\\x;%USERPROFILE%\\tools');
  });

  it('has nothing to remove when the folder is absent', () => {
    expect(changePath('C:\\x', bin, 'remove')).toBeNull();
  });
});

describe('parseRegQuery', () => {
  it('reads the raw value and its type', () => {
    const output = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\tools;C:\\Program Files\\x\\\r\n\r\n';
    expect(parseRegQuery(output)).toEqual({ value: '%USERPROFILE%\\tools;C:\\Program Files\\x\\', type: 'REG_EXPAND_SZ' });
  });

  it('reads an empty value', () => {
    expect(parseRegQuery('\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_SZ    \r\n')).toEqual({ value: '', type: 'REG_SZ' });
  });

  it('treats missing output as no PATH', () => {
    expect(parseRegQuery('')).toEqual({ value: '', type: 'REG_EXPAND_SZ' });
  });
});
