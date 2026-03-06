export type TabId = string;
export type SessionId = string;
export type FolderPath = string;

export interface TabState {
  id: TabId;
  launchFolder: FolderPath;
  currentFolder: FolderPath;
  sessionId: SessionId;
  label: string;
  isActive: boolean;
  createdAt: number;
  lastActivityAt: number;
  status: 'running' | 'stopped' | 'resuming';
}

export interface RecentlyClosedTab {
  folder: FolderPath;
  sessionId: SessionId;
  label: string;
  closedAt: number;
}

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface Preferences {
  warnBeforeClosingTabs: boolean;
  fontFamily: string;
  theme: ThemePreference;
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
}

export interface ClaudeSession {
  sessionId: SessionId;
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

export interface GitInfo {
  isRepo: boolean;
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  worktree: string | null;
}
