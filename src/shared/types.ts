export type TabId = string;
export type SessionId = string;
export type FolderPath = string;

export type AgentType = 'claude' | 'codex';

/** CLI agents currently resolvable from the user's login-shell environment. */
export type AgentAvailability = Record<AgentType, boolean>;

export interface TabState {
  id: TabId;
  agent: AgentType;
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
  /** Raw id of the model last seen in this session's transcript (e.g. "claude-opus-4-8"). */
  model?: string;
  /** Tokens occupying the context window after the most recent agent turn. */
  contextTokens?: number;
  /** Effective context-window size reported or derived for the active model. */
  contextLimit?: number;
  /** Reasoning effort of the most recent assistant turn (e.g. "high"). */
  effort?: string;
}

export interface RecentlyClosedTab {
  agent: AgentType;
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
  /** Terminal font size in typographic points. */
  fontSize: number;
  /** Empty uses the active theme's terminal foreground. */
  terminalForeground: string;
  /** Empty uses the active theme's terminal background. */
  terminalBackground: string;
  theme: ThemePreference;
  tabSwitchMode: TabSwitchMode;
  newTabShortcut: NewTabShortcut;
  defaultAgent: AgentType;
  /** Where the new-tab folder dialog opens: your last session's folder, or a pinned one. */
  newTabFolderMode: NewTabFolderMode;
  /** The pinned folder, used when newTabFolderMode is 'fixed'. Empty defers to the OS. */
  newTabFolder: string;
}

export type NewTabFolderMode = 'last' | 'fixed';

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
  /** CodeHerd-owned colours for Codex sessions, which have no native /color metadata. */
  codexSessionColors: Record<SessionId, string>;
  preferences: Preferences;
  /** Latest release version the user dismissed the update notification for. */
  dismissedUpdateVersion: string | null;
  /** Folder of the most recently opened session, so the dialog can reopen there. */
  lastFolder: string | null;
}

/** A newer release discovered on GitHub. */
export interface UpdateInfo {
  /** Version number of the latest release (tag with any leading 'v' stripped). */
  version: string;
  /** URL of the release page. */
  url: string;
}

export interface AgentSession {
  agent: AgentType;
  sessionId: SessionId;
  /**
   * Set only when this session is a *live* background agent, and holds the job id that
   * `claude attach` takes. Such sessions can't be resumed while the agent is running.
   */
  agentId?: string;
  project: FolderPath;
  lastPrompt: string;
  timestamp: number;
  /** User-assigned or agent-generated session name, when available. */
  name?: string;
}

export interface TabCreateRequest {
  tabId: TabId;
  agent: AgentType;
  folder: FolderPath;
  resumeSessionId?: SessionId;
  /** Saved CodeHerd label to preserve while restoring an open tab. */
  label?: string;
  /**
   * Set only when replaying tabs saved from the last run. Restoring is not the user
   * opening a folder, so it must not overwrite the last-folder they actually chose.
   */
  restored?: boolean;
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

/** Pushed from main → renderer when an agent updates a session name or tab color. */
export interface TabMetadataMessage {
  tabId: TabId;
  /** Present when the agent has set or cleared a name. `null` means cleared. */
  name?: string | null;
  /** Present when /color sets or clears a color. `null` means cleared. */
  color?: string | null;
  /** Present when the session's active model changes. Raw model id; the renderer formats it for display. */
  model?: string;
  /** Present when the context fill changes. */
  contextTokens?: number;
  /** Present alongside contextTokens: the effective window size it is measured against. */
  contextLimit?: number;
  /** Present when the reasoning effort of the most recent assistant turn changes (e.g. "high"). */
  effort?: string;
}

/** Pushed when an agent assigns or switches the session backing a running tab. */
export interface TabSessionMessage {
  tabId: TabId;
  sessionId: SessionId;
}

/** Requests CodeHerd's simulated Codex /color palette for a tab. */
export interface TabColorPickerMessage {
  tabId: TabId;
  color?: string;
}

export interface GitInfo {
  isRepo: boolean;
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  worktree: string | null;
}
