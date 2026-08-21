import { describe, it, expect } from 'vitest';
import { resolveNewTabFolder } from './new-tab-folder';
import type { Preferences } from '../shared/types';

const prefs = (over: Partial<Preferences>): Preferences => ({
  warnBeforeClosingTabs: true,
  fontFamily: '',
  fontSize: 12,
  terminalForeground: '',
  terminalBackground: '',
  theme: 'dark',
  tabSwitchMode: 'mru',
  newTabShortcut: 'Ctrl+T',
  defaultAgent: 'claude',
  newTabFolderMode: 'last',
  newTabFolder: '',
  ...over,
});

const always = () => true;
const never = () => false;

describe('resolveNewTabFolder', () => {
  it('opens at the last folder used', () => {
    const p = prefs({ newTabFolderMode: 'last' });
    expect(resolveNewTabFolder(p, 'K:\Dev\Apps\CodeHerd', always)).toBe('K:\Dev\Apps\CodeHerd');
  });

  it('opens at the configured folder when one is pinned', () => {
    const p = prefs({ newTabFolderMode: 'fixed', newTabFolder: 'K:\Dev\Apps' });
    // The pinned folder wins outright: the setting exists to override history.
    expect(resolveNewTabFolder(p, 'K:\Dev\Apps\CodeHerd', always)).toBe('K:\Dev\Apps');
  });

  it('defers to the OS when there is nothing to open at', () => {
    // Undefined leaves showOpenDialog's defaultPath unset, which is the only way to
    // get the platform's own "sensible place" back.
    expect(resolveNewTabFolder(prefs({ newTabFolderMode: 'last' }), null, always)).toBeUndefined();
    expect(resolveNewTabFolder(prefs({ newTabFolderMode: 'fixed', newTabFolder: '' }), null, always)).toBeUndefined();
    expect(resolveNewTabFolder(prefs({ newTabFolderMode: 'fixed', newTabFolder: '   ' }), null, always)).toBeUndefined();
  });

  it('defers to the OS when the folder is no longer on disk', () => {
    // A renamed or deleted folder makes the dialog open somewhere unhelpful rather
    // than erroring, so a stale path must not reach it.
    const pinned = prefs({ newTabFolderMode: 'fixed', newTabFolder: 'K:\Gone' });
    expect(resolveNewTabFolder(pinned, null, never)).toBeUndefined();
    expect(resolveNewTabFolder(prefs({ newTabFolderMode: 'last' }), 'K:\Gone', never)).toBeUndefined();
  });

  it('treats a preferences file written before this setting existed as "last"', () => {
    // getPreferences() returns what was stored, without merging in new defaults.
    const legacy = { ...prefs({}) } as Preferences;
    delete (legacy as Partial<Preferences>).newTabFolderMode;
    expect(resolveNewTabFolder(legacy, 'K:\Dev\Apps\MooBank', always)).toBe('K:\Dev\Apps\MooBank');
  });
});
