import * as fs from 'fs';
import * as path from 'path';
import { STATE_DIR, STATE_FILE, DEFAULT_APP_STATE, DEFAULT_PREFERENCES } from '../shared/constants';
import type { AppState, TabState, TabId, RecentlyClosedTab, Preferences } from '../shared/types';

export class StateManager {
  private state: AppState;

  constructor() {
    this.state = this.load();
  }

  private load(): AppState {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.version === 1) {
          // Merge in defaults for any fields added after the state file was created
          return {
            ...DEFAULT_APP_STATE,
            ...parsed,
            preferences: { ...DEFAULT_PREFERENCES, ...parsed.preferences },
          };
        }
      }
    } catch {
      // Corrupt or missing file, use defaults
    }
    return { ...DEFAULT_APP_STATE };
  }

  save(): void {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      const tmpFile = STATE_FILE + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), 'utf-8');
      fs.renameSync(tmpFile, STATE_FILE);
    } catch (err) {
      console.error('Failed to save state:', err);
    }
  }

  getState(): AppState {
    return this.state;
  }

  setTabs(tabs: TabState[]): void {
    this.state.tabs = tabs;
  }

  setActiveTabId(tabId: TabId | null): void {
    this.state.activeTabId = tabId;
  }

  setWindowBounds(bounds: AppState['windowBounds']): void {
    this.state.windowBounds = bounds;
  }

  setSidebar(sidebar: AppState['sidebar']): void {
    this.state.sidebar = sidebar;
  }

  setRecentlyClosed(items: RecentlyClosedTab[]): void {
    this.state.recentlyClosed = items;
  }

  getPreferences(): Preferences {
    return this.state.preferences ?? { warnBeforeClosingTabs: true, fontFamily: '' };
  }

  setPreferences(prefs: Preferences): void {
    this.state.preferences = prefs;
  }

  getRestoredTabs(): TabState[] {
    return this.state.tabs.filter(t => t.status === 'running' || t.status === 'resuming');
  }
}
