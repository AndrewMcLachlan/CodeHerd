import { describe, expect, it, vi } from 'vitest';
import { handleSquirrelEvent, type SquirrelSpawn } from './squirrel-startup';

const EXE = 'C:\\Users\\u\\AppData\\Local\\codeherd\\app-1.0.0\\codeherd.exe';
const UPDATE = 'C:\\Users\\u\\AppData\\Local\\codeherd\\Update.exe';

const run = (argv: string[], platform: NodeJS.Platform = 'win32') => {
  const spawnFn = vi.fn<SquirrelSpawn>();
  const handled = handleSquirrelEvent(['exe', ...argv], platform, EXE, spawnFn);
  return { handled, spawnFn };
};

describe('handleSquirrelEvent', () => {
  it('ignores normal launches', () => {
    const spawnFn = vi.fn<SquirrelSpawn>();
    expect(handleSquirrelEvent(['exe'], 'win32', EXE, spawnFn)).toBe(false);
    expect(run(['--live-state']).handled).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
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
