import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { STATE_DIR, DEFAULT_APP_STATE, DEFAULT_PREFERENCES } from '../shared/constants';
import type { AppState, TabState, TabId, SessionId, RecentlyClosedTab, Preferences } from '../shared/types';

// Dev runs use ~/.codeherd-dev so they never touch the installed app's settings
// (parallel to the userData split in main.ts). Pass --live-state (npm run dev:live) to
// point a dev run at the real ~/.codeherd instead — useful for reproducing a bug against
// your actual tabs. Quit the installed app first: both write state.json, last one wins.
const useLiveState = app.isPackaged || process.argv.includes('--live-state');
const stateDir = useLiveState ? STATE_DIR : `${STATE_DIR}-dev`;
const stateFile = path.join(stateDir, 'state.json');

export class StateManager {
  private state: AppState;

  constructor() {
    this.state = this.load();
  }

  private load(): AppState {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      if (fs.existsSync(stateFile)) {
        const raw = fs.readFileSync(stateFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.version === 1) {
          // Merge in defaults for any fields added after the state file was created
          return {
            ...DEFAULT_APP_STATE,
            ...parsed,
            // Tabs saved before multi-agent support are all Claude Code tabs.
            tabs: (parsed.tabs ?? []).map((tab: TabState) => ({
              ...tab,
              agent: tab.agent ?? 'claude',
            })),
            recentlyClosed: (parsed.recentlyClosed ?? []).map((tab: RecentlyClosedTab) => ({
              ...tab,
              agent: tab.agent ?? 'claude',
            })),
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
      fs.mkdirSync(stateDir, { recursive: true });
      const tmpFile = stateFile + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), 'utf-8');
      fs.renameSync(tmpFile, stateFile);
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

  getCodexSessionColor(sessionId: SessionId): string | undefined {
    return this.state.codexSessionColors?.[sessionId];
  }

  setCodexSessionColor(sessionId: SessionId, color: string | null): void {
    this.state.codexSessionColors ??= {};
    if (color) this.state.codexSessionColors[sessionId] = color;
    else delete this.state.codexSessionColors[sessionId];
  }

  moveCodexSessionColor(fromSessionId: SessionId, toSessionId: SessionId): void {
    if (fromSessionId === toSessionId) return;
    const color = this.getCodexSessionColor(fromSessionId);
    if (!color) return;
    this.setCodexSessionColor(toSessionId, color);
    this.setCodexSessionColor(fromSessionId, null);
  }

  setDismissedUpdateVersion(version: string | null): void {
    this.state.dismissedUpdateVersion = version;
  }

  getPreferences(): Preferences {
    return this.state.preferences ?? DEFAULT_PREFERENCES;
  }

  setPreferences(prefs: Preferences): void {
    this.state.preferences = prefs;
  }

  getRestoredTabs(): TabState[] {
    return this.state.tabs.filter(t => t.status !== 'stopped');
  }
}
