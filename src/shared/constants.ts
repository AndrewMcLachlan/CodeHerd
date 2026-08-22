import * as path from 'path';
import * as os from 'os';

// Base settings dir for the packaged app; dev runs append '-dev'
// (see state-manager.ts) so they never touch real settings
export const STATE_DIR = path.join(os.homedir(), '.codeherd');
export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const CLAUDE_HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl');
export const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

export const DEFAULT_WINDOW_BOUNDS = {
  x: 100,
  y: 100,
  width: 1400,
  height: 900,
  isMaximized: false,
};

export const DEFAULT_SIDEBAR = {
  width: 260,
  collapsed: true,
};

export const DEFAULT_PREFERENCES = {
  warnBeforeClosingTabs: true,
  fontFamily: '',
  fontSize: 12,
  terminalForeground: '',
  terminalBackground: '',
  theme: 'dark' as const,
  tabSwitchMode: 'mru' as const,
  newTabShortcut: 'Ctrl+T' as const,
  defaultAgent: 'claude' as const,
  newTabFolderMode: 'last' as const,
  newTabFolder: '',
};

export const DEFAULT_APP_STATE = {
  version: 1 as const,
  tabs: [],
  activeTabId: null,
  windowBounds: DEFAULT_WINDOW_BOUNDS,
  sidebar: DEFAULT_SIDEBAR,
  recentlyClosed: [],
  codexSessionColors: {},
  preferences: DEFAULT_PREFERENCES,
  dismissedUpdateVersion: null as string | null,
  lastFolder: null as string | null,
};
