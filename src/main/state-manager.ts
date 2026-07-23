import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_APP_STATE, DEFAULT_PREFERENCES } from '../shared/constants';
import type { AppState, TabState, TabId, SessionId, RecentlyClosedTab, Preferences } from '../shared/types';

export class StateManager {
  private state: AppState;
  private readonly stateFile: string;
  private readonly backupFile: string;

  /** The caller picks the directory (see main.ts for the live/dev split). */
  constructor(private readonly stateDir: string) {
    this.stateFile = path.join(stateDir, 'state.json');
    this.backupFile = this.stateFile + '.bak';
    this.state = this.load();
  }

  private load(): AppState {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
    } catch {
      // best-effort; reads below will fall back to defaults
    }

    const primary = this.tryRead(this.stateFile);
    if (primary) return primary;

    // The state file is missing, corrupt, or an unknown version. Keep a copy for
    // diagnostics, then fall back to the last-known-good backup before giving up
    // and resetting to defaults.
    this.preserveCorrupt();
    const backup = this.tryRead(this.backupFile);
    if (backup) {
      console.warn('state.json missing or unreadable; recovered from last-known-good backup');
      return backup;
    }
    return structuredClone(DEFAULT_APP_STATE);
  }

  /** Read and migrate a state file, or null if it's missing, corrupt, or an unknown version. */
  private tryRead(file: string): AppState | null {
    try {
      if (!fs.existsSync(file)) return null;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (parsed.version !== 1) return null;
      // Merge in defaults for any fields added after the state file was created.
      // Deep-clone the defaults so later in-place mutation (e.g. codexSessionColors)
      // can never write through to the shared DEFAULT_APP_STATE object.
      return {
        ...structuredClone(DEFAULT_APP_STATE),
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
    } catch {
      return null;
    }
  }

  private preserveCorrupt(): void {
    try {
      if (fs.existsSync(this.stateFile)) {
        fs.copyFileSync(this.stateFile, this.stateFile + '.corrupt');
      }
    } catch {
      // best-effort
    }
  }

  save(): void {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      this.backUpCurrentIfValid();
      // Write-then-rename so an interrupted write never truncates state.json itself.
      const tmpFile = this.stateFile + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), 'utf-8');
      fs.renameSync(tmpFile, this.stateFile);
    } catch (err) {
      console.error('Failed to save state:', err);
    }
  }

  /**
   * Keep the outgoing state file as the last-known-good backup — but only if it
   * actually parses, so a corrupt file never replaces an older good backup.
   */
  private backUpCurrentIfValid(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
      if (parsed.version === 1) fs.copyFileSync(this.stateFile, this.backupFile);
    } catch {
      // missing or corrupt — leave any existing backup in place
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
