import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type { TabCreateRequest, PtyDataMessage, AppState, TabState, ClaudeSession, GitInfo, RecentlyClosedTab, Preferences } from '../shared/types';

contextBridge.exposeInMainWorld('codeherd', {
  // Invoke (request/response)
  createTab: (request: TabCreateRequest): Promise<TabState> =>
    ipcRenderer.invoke(IPC.TAB_CREATE, request),
  closeTab: (tabId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_CLOSE, { tabId }),
  resizeTab: (tabId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_RESIZE, { tabId, cols, rows }),
  inputToTab: (tabId: string, data: string): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_INPUT, { tabId, data }),
  getAllTabs: (): Promise<TabState[]> =>
    ipcRenderer.invoke(IPC.TAB_GET_ALL),
  reorderTabs: (tabIds: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_REORDER, tabIds),
  listSessions: (folder: string): Promise<ClaudeSession[]> =>
    ipcRenderer.invoke(IPC.SESSION_LIST, { folder }),
  pickFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.FOLDER_PICK),
  getState: (): Promise<AppState> =>
    ipcRenderer.invoke(IPC.STATE_GET),
  clipboardWrite: (text: string): Promise<void> =>
    ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, text),
  clipboardRead: (): Promise<string> =>
    ipcRenderer.invoke(IPC.CLIPBOARD_READ),
  getGitInfo: (folder: string): Promise<GitInfo> =>
    ipcRenderer.invoke(IPC.GIT_INFO, { folder }),
  saveSidebarState: (sidebar: { width: number; collapsed: boolean }): Promise<void> =>
    ipcRenderer.invoke(IPC.SIDEBAR_STATE, sidebar),
  saveRecentlyClosed: (items: RecentlyClosedTab[]): Promise<void> =>
    ipcRenderer.invoke(IPC.RECENTLY_CLOSED, items),
  menuAction: (action: string): Promise<void> =>
    ipcRenderer.invoke(IPC.MENU_ACTION, action),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, url),

  // Event listeners (main -> renderer)
  onPtyData: (callback: (msg: PtyDataMessage) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: PtyDataMessage) => callback(msg);
    ipcRenderer.on(IPC.PTY_DATA, listener);
    return () => { ipcRenderer.removeListener(IPC.PTY_DATA, listener); };
  },
  onPtyExit: (callback: (msg: { tabId: string; exitCode: number }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: { tabId: string; exitCode: number }) => callback(msg);
    ipcRenderer.on(IPC.PTY_EXIT, listener);
    return () => { ipcRenderer.removeListener(IPC.PTY_EXIT, listener); };
  },
  onTabStatus: (callback: (msg: { tabId: string; status: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: { tabId: string; status: string }) => callback(msg);
    ipcRenderer.on(IPC.TAB_STATUS, listener);
    return () => { ipcRenderer.removeListener(IPC.TAB_STATUS, listener); };
  },

  // Menu events (main -> renderer)
  onMenuOpenFolder: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:open-folder', listener);
    return () => { ipcRenderer.removeListener('menu:open-folder', listener); };
  },
  onMenuCloseTab: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:close-tab', listener);
    return () => { ipcRenderer.removeListener('menu:close-tab', listener); };
  },
  onMenuToggleSidebar: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:toggle-sidebar', listener);
    return () => { ipcRenderer.removeListener('menu:toggle-sidebar', listener); };
  },
  onMenuPreferences: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:preferences', listener);
    return () => { ipcRenderer.removeListener('menu:preferences', listener); };
  },
  onPreferencesChanged: (callback: (prefs: Preferences) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, prefs: Preferences) => callback(prefs);
    ipcRenderer.on('preferences:changed', listener);
    return () => { ipcRenderer.removeListener('preferences:changed', listener); };
  },
  onThemeChanged: (callback: (resolvedTheme: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, resolvedTheme: string) => callback(resolvedTheme);
    ipcRenderer.on(IPC.THEME_CHANGED, listener);
    return () => { ipcRenderer.removeListener(IPC.THEME_CHANGED, listener); };
  },
  getResolvedTheme: (): Promise<string> =>
    ipcRenderer.invoke(IPC.THEME_GET_RESOLVED),
  isDev: !ipcRenderer.sendSync('app:is-packaged'),
});
