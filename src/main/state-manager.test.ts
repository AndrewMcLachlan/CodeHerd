import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from './state-manager';
import { DEFAULT_APP_STATE, DEFAULT_PREFERENCES } from '../shared/constants';
import type { AppState, TabState } from '../shared/types';

let dir: string;
const stateFile = () => path.join(dir, 'state.json');
const backupFile = () => path.join(dir, 'state.json.bak');
const corruptFile = () => path.join(dir, 'state.json.corrupt');

const tab = (overrides: Partial<TabState> = {}): TabState => ({
  id: 'tab-1',
  agent: 'claude',
  launchFolder: 'K:\\Dev\\Apps\\CodeHerd',
  currentFolder: 'K:\\Dev\\Apps\\CodeHerd',
  sessionId: 'session-1',
  label: 'CodeHerd',
  isActive: true,
  createdAt: 1000,
  lastActivityAt: 2000,
  status: 'running',
  ...overrides,
});

const validState = (overrides: Partial<AppState> = {}): AppState => ({
  ...DEFAULT_APP_STATE,
  tabs: [tab()],
  activeTabId: 'tab-1',
  ...overrides,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeherd-state-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('load', () => {
  it('returns defaults when no state file exists', () => {
    const sm = new StateManager(dir);
    expect(sm.getState()).toEqual(DEFAULT_APP_STATE);
  });

  it('round-trips state through save and a fresh instance', () => {
    const sm = new StateManager(dir);
    sm.setTabs([tab(), tab({ id: 'tab-2', sessionId: 'session-2', status: 'waiting', color: '#f38ba8' })]);
    sm.setActiveTabId('tab-2');
    sm.setRecentlyClosed([
      { agent: 'codex', folder: 'K:\\Dev', sessionId: 'session-9', label: 'Old', closedAt: 3000 },
    ]);
    sm.setCodexSessionColor('session-9', 'red');
    sm.setPreferences({ ...DEFAULT_PREFERENCES, fontSize: 14 });
    sm.save();

    const reloaded = new StateManager(dir);
    expect(reloaded.getState()).toEqual(sm.getState());
  });

  it('defaults the agent to claude for tabs saved before multi-agent support', () => {
    const { agent: _a, ...preAgentTab } = tab();
    const preAgent = validState({ tabs: [preAgentTab as TabState] });
    const { agent: _b, ...preAgentClosed } = {
      agent: undefined,
      folder: 'K:\\Dev',
      sessionId: 'session-9',
      label: 'Old',
      closedAt: 3000,
    };
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({ ...preAgent, recentlyClosed: [preAgentClosed] }),
    );

    const sm = new StateManager(dir);
    expect(sm.getState().tabs[0].agent).toBe('claude');
    expect(sm.getState().recentlyClosed[0].agent).toBe('claude');
  });

  it('merges defaults for preference fields added after the file was written', () => {
    const oldPrefs = { warnBeforeClosingTabs: false };
    fs.writeFileSync(stateFile(), JSON.stringify({ ...validState(), preferences: oldPrefs }));

    const prefs = new StateManager(dir).getPreferences();
    expect(prefs.warnBeforeClosingTabs).toBe(false);
    expect(prefs.fontSize).toBe(DEFAULT_PREFERENCES.fontSize);
    expect(prefs.newTabShortcut).toBe(DEFAULT_PREFERENCES.newTabShortcut);
  });

  it('merges defaults for top-level fields missing from older files', () => {
    const { codexSessionColors: _c, dismissedUpdateVersion: _d, ...older } = validState();
    fs.writeFileSync(stateFile(), JSON.stringify(older));

    const state = new StateManager(dir).getState();
    expect(state.codexSessionColors).toEqual({});
    expect(state.dismissedUpdateVersion).toBeNull();
    expect(state.tabs).toHaveLength(1);
  });

  it('falls back to defaults for an unknown state version', () => {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...validState(), version: 99 }));
    expect(new StateManager(dir).getState()).toEqual(DEFAULT_APP_STATE);
  });
});

describe('corruption recovery', () => {
  it('recovers from the backup when state.json is corrupt', () => {
    const good = validState();
    fs.writeFileSync(backupFile(), JSON.stringify(good));
    fs.writeFileSync(stateFile(), '{"version":1,"tabs":[{"id"');

    const sm = new StateManager(dir);
    expect(sm.getState().tabs).toHaveLength(1);
    expect(sm.getState().activeTabId).toBe('tab-1');
  });

  it('preserves the corrupt file for diagnostics before falling back', () => {
    fs.writeFileSync(stateFile(), 'not json at all');
    new StateManager(dir);
    expect(fs.readFileSync(corruptFile(), 'utf-8')).toBe('not json at all');
  });

  it('uses defaults when both the state file and backup are corrupt', () => {
    fs.writeFileSync(stateFile(), '{broken');
    fs.writeFileSync(backupFile(), '{also broken');
    expect(new StateManager(dir).getState()).toEqual(DEFAULT_APP_STATE);
  });

  it('does not create a corrupt copy on a fresh install', () => {
    new StateManager(dir);
    expect(fs.existsSync(corruptFile())).toBe(false);
  });
});

describe('save', () => {
  it('backs up the previous valid state file before overwriting it', () => {
    const sm = new StateManager(dir);
    sm.setTabs([tab()]);
    sm.save();
    sm.setTabs([tab(), tab({ id: 'tab-2', sessionId: 'session-2' })]);
    sm.save();

    const backup = JSON.parse(fs.readFileSync(backupFile(), 'utf-8'));
    expect(backup.tabs).toHaveLength(1);
    const current = JSON.parse(fs.readFileSync(stateFile(), 'utf-8'));
    expect(current.tabs).toHaveLength(2);
  });

  it('does not replace a good backup with a corrupt current file', () => {
    const good = validState();
    fs.writeFileSync(backupFile(), JSON.stringify(good));
    fs.writeFileSync(stateFile(), '{broken');

    const sm = new StateManager(dir); // recovers from backup
    sm.save();

    const backup = JSON.parse(fs.readFileSync(backupFile(), 'utf-8'));
    expect(backup.tabs).toHaveLength(1); // still the good state, not "{broken"
  });

  it('ignores a leftover tmp file from an interrupted write', () => {
    const sm = new StateManager(dir);
    sm.setTabs([tab()]);
    sm.save();
    fs.writeFileSync(stateFile() + '.tmp', '{"version":1,"tabs":[{"id'); // simulated crash mid-write

    const reloaded = new StateManager(dir);
    expect(reloaded.getState().tabs).toHaveLength(1);
  });
});

describe('getRestoredTabs', () => {
  it('excludes stopped tabs', () => {
    const sm = new StateManager(dir);
    sm.setTabs([tab(), tab({ id: 'tab-2', sessionId: 'session-2', status: 'stopped' })]);
    expect(sm.getRestoredTabs().map((t) => t.id)).toEqual(['tab-1']);
  });
});

describe('codex session colours', () => {
  it('moves a colour between session ids', () => {
    const sm = new StateManager(dir);
    sm.setCodexSessionColor('session-a', 'red');
    sm.moveCodexSessionColor('session-a', 'session-b');
    expect(sm.getCodexSessionColor('session-b')).toBe('red');
    expect(sm.getCodexSessionColor('session-a')).toBeUndefined();
  });

  it('keeps the existing colour when moving from a session without one', () => {
    const sm = new StateManager(dir);
    sm.setCodexSessionColor('session-b', 'blue');
    sm.moveCodexSessionColor('session-a', 'session-b');
    expect(sm.getCodexSessionColor('session-b')).toBe('blue');
  });
});
