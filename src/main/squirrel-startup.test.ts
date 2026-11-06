import { describe, expect, it, vi } from 'vitest';
import { handleSquirrelEvent, type SquirrelSpawn } from './squirrel-startup';
import type { CommandLineInstaller } from './command-line-install';

const ROOT = 'C:\\Users\\u\\AppData\\Local\\codeherd';
const EXE = `${ROOT}\\app-1.0.0\\codeherd.exe`;
const UPDATE = `${ROOT}\\Update.exe`;

const run = (argv: string[], platform: NodeJS.Platform = 'win32') => {
  const spawnFn = vi.fn<SquirrelSpawn>();
  const commandLine = vi.fn<CommandLineInstaller>();
  const handled = handleSquirrelEvent(['exe', ...argv], platform, EXE, spawnFn, commandLine);
  return { handled, spawnFn, commandLine };
};

describe('handleSquirrelEvent', () => {
  it('ignores normal launches', () => {
    const spawnFn = vi.fn<SquirrelSpawn>();
    const commandLine = vi.fn<CommandLineInstaller>();
    expect(handleSquirrelEvent(['exe'], 'win32', EXE, spawnFn, commandLine)).toBe(false);
    expect(run(['--live-state']).handled).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
    expect(commandLine).not.toHaveBeenCalled();
  });

  it.each(['--squirrel-install', '--squirrel-updated'])('puts the command on the PATH on %s', (flag) => {
    expect(run([flag]).commandLine).toHaveBeenCalledWith(ROOT, 'add', '1.0.0');
  });

  it('takes the command off the PATH on uninstall', () => {
    expect(run(['--squirrel-uninstall']).commandLine).toHaveBeenCalledWith(ROOT, 'remove', '1.0.0');
  });

  it('ignores squirrel flags off Windows', () => {
    const { handled, spawnFn } = run(['--squirrel-install'], 'linux');
    expect(handled).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it.each(['--squirrel-install', '--squirrel-updated'])(
    'creates a Start Menu shortcut only on %s',
    (flag) => {
      const { handled, spawnFn } = run([flag]);
      expect(handled).toBe(true);
      expect(spawnFn).toHaveBeenCalledWith(UPDATE, [
        '--createShortcut=codeherd.exe',
        '--shortcut-locations=StartMenu',
      ]);
      // The whole point: no desktop shortcut, ever.
      expect(JSON.stringify(spawnFn.mock.calls)).not.toContain('Desktop');
    },
  );

  it('removes the shortcut on uninstall', () => {
    const { handled, spawnFn } = run(['--squirrel-uninstall']);
    expect(handled).toBe(true);
    expect(spawnFn).toHaveBeenCalledWith(UPDATE, [
      '--removeShortcut=codeherd.exe',
      '--shortcut-locations=StartMenu',
    ]);
  });

  it('exits quietly when an obsolete version is cleaned up', () => {
    const { handled, spawnFn } = run(['--squirrel-obsolete']);
    expect(handled).toBe(true);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('treats the first post-install run as a normal launch', () => {
    const { handled, spawnFn } = run(['--squirrel-firstrun']);
    expect(handled).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
