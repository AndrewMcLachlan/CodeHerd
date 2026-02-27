import * as path from 'path';
import * as os from 'os';

export const STATE_DIR = path.join(os.homedir(), '.codeherd');
export const STATE_FILE = path.join(STATE_DIR, 'state.json');
export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const CLAUDE_HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl');

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

export const DEFAULT_APP_STATE = {
  version: 1 as const,
  tabs: [],
  activeTabId: null,
  windowBounds: DEFAULT_WINDOW_BOUNDS,
  sidebar: DEFAULT_SIDEBAR,
  recentlyClosed: [],
};
