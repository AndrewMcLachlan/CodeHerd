import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type { AgentAvailability, AgentSession, AgentType, TabCreateRequest, PtyDataMessage, AppState, TabState, GitInfo, RecentlyClosedTab, Preferences, TabColorPickerMessage, TabMetadataMessage, TabSessionMessage, UpdateInfo } from '../shared/types';

contextBridge.exposeInMainWorld('codeherd', {
  // Invoke (request/response)
  createTab: (request: TabCreateRequest): Promise<TabState> =>
    ipcRenderer.invoke(IPC.TAB_CREATE, request),
  closeTab: (tabId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_CLOSE, { tabId }),
  resizeTab: (tabId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_RESIZE, { tabId, cols, rows }),
  // sentAt is stamped here rather than in the renderer so every existing caller gets
  // it for free. Main logs the delta when diagnostics are on, which distinguishes a
  // blocked main process from input that reached the PTY promptly.
  inputToTab: (tabId: string, data: string): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_INPUT, { tabId, data, sentAt: Date.now() }),
  setTabColor: (tabId: string, color: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_SET_COLOR, { tabId, color }),
  getAllTabs: (): Promise<TabState[]> =>
    ipcRenderer.invoke(IPC.TAB_GET_ALL),
  reorderTabs: (tabIds: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_REORDER, tabIds),
  listSessions: (folder: string, agent: AgentType): Promise<AgentSession[]> =>
    ipcRenderer.invoke(IPC.SESSION_LIST, { folder, agent }),
  getAvailableAgents: (): Promise<AgentAvailability> =>
    ipcRenderer.invoke(IPC.AGENT_GET_AVAILABLE),
  pickFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.FOLDER_PICK),
  getState: (): Promise<AppState> =>
    ipcRenderer.invoke(IPC.STATE_GET),
  clipboardWrite: (text: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, text),
  clipboardRead: (): Promise<string> =>
    ipcRenderer.invoke(IPC.CLIPBOARD_READ),
  clipboardHasImage: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CLIPBOARD_HAS_IMAGE),
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
  dismissUpdate: (version: string): Promise<void> =>
    ipcRenderer.invoke(IPC.UPDATE_DISMISS, version),

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
  onTabMetadata: (callback: (msg: TabMetadataMessage) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: TabMetadataMessage) => callback(msg);
    ipcRenderer.on(IPC.TAB_METADATA, listener);
    return () => { ipcRenderer.removeListener(IPC.TAB_METADATA, listener); };
  },
  onTabSession: (callback: (msg: TabSessionMessage) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: TabSessionMessage) => callback(msg);
    ipcRenderer.on(IPC.TAB_SESSION, listener);
    return () => { ipcRenderer.removeListener(IPC.TAB_SESSION, listener); };
  },
  onTabColorPicker: (callback: (msg: TabColorPickerMessage) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: TabColorPickerMessage) => callback(msg);
    ipcRenderer.on(IPC.TAB_COLOR_PICKER, listener);
    return () => { ipcRenderer.removeListener(IPC.TAB_COLOR_PICKER, listener); };
  },
  onUpdateAvailable: (callback: (info: UpdateInfo) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: UpdateInfo) => callback(info);
    ipcRenderer.on(IPC.UPDATE_AVAILABLE, listener);
    return () => { ipcRenderer.removeListener(IPC.UPDATE_AVAILABLE, listener); };
  },

  // Menu events (main -> renderer)
  onMenuOpenFolder: (callback: (agent?: AgentType) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, agent?: AgentType) => callback(agent);
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
  onMenuRestoreRecent: (callback: (msg: { folder: string; sessionId: string; index: number }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: { folder: string; sessionId: string; index: number }) => callback(msg);
    ipcRenderer.on(IPC.MENU_RESTORE_RECENT, listener);
    return () => { ipcRenderer.removeListener(IPC.MENU_RESTORE_RECENT, listener); };
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
