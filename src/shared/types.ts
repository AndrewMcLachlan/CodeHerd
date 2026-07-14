export type TabId = string;
export type SessionId = string;
export type FolderPath = string;

export interface TabState {
  id: TabId;
  launchFolder: FolderPath;
  currentFolder: FolderPath;
  sessionId: SessionId;
  label: string;
  /** Optional CSS color (hex like #f38ba8, or any valid CSS color). Drawn as the tab's top border. */
  color?: string;
  isActive: boolean;
  createdAt: number;
  lastActivityAt: number;
  status: 'running' | 'stopped' | 'resuming' | 'waiting' | 'attention';
}

export interface RecentlyClosedTab {
  folder: FolderPath;
  sessionId: SessionId;
  label: string;
  closedAt: number;
}

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export type TabSwitchMode = 'mru' | 'sequential';

/**
 * Configurable New Tab shortcut. Ctrl+T has meaning inside Claude Code
 * (show/hide sub-agent tasks), so users can remap or disable it ('none'),
 * in which case Ctrl+T is sent to the terminal instead (#69).
 */
// Canonical shortcut string (e.g. 'Ctrl+T', 'Ctrl+Alt+K', 'F5') or the
// sentinel 'none' (disabled). See src/shared/shortcut.ts. #69
export type NewTabShortcut = string;

export interface Preferences {
  warnBeforeClosingTabs: boolean;
  fontFamily: string;
  theme: ThemePreference;
  tabSwitchMode: TabSwitchMode;
  newTabShortcut: NewTabShortcut;
}

export interface AppState {
  version: 1;
  tabs: TabState[];
  activeTabId: TabId | null;
  windowBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    isMaximized: boolean;
  };
  sidebar: {
    width: number;
    collapsed: boolean;
  };
  recentlyClosed: RecentlyClosedTab[];
  preferences: Preferences;
  /** Latest release version the user dismissed the update notification for. */
  dismissedUpdateVersion: string | null;
}

/** A newer release discovered on GitHub. */
export interface UpdateInfo {
  /** Version number of the latest release (tag with any leading 'v' stripped). */
  version: string;
  /** URL of the release page. */
  url: string;
}

export interface ClaudeSession {
  sessionId: SessionId;
  /**
   * Set only when this session is a *live* background agent, and holds the job id that
   * `claude attach` takes. Such sessions can't be resumed while the agent is running.
   */
  agentId?: string;
  project: FolderPath;
  lastPrompt: string;
  timestamp: number;
}

export interface TabCreateRequest {
  tabId: TabId;
  folder: FolderPath;
  resumeSessionId?: SessionId;
  cols?: number;
  rows?: number;
}

export interface PtyDataMessage {
  tabId: TabId;
  data: string;
}

export interface PtyResizeMessage {
  tabId: TabId;
  cols: number;
  rows: number;
}

/** Pushed from main → renderer when Claude Code updates a session's name or color. */
export interface TabMetadataMessage {
  tabId: TabId;
  /** Present when Claude has set or cleared a name. `null` means cleared. */
  name?: string | null;
  /** Present when Claude has set or cleared a color. `null` means cleared. */
  color?: string | null;
}

export interface GitInfo {
  isRepo: boolean;
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  worktree: string | null;
}
