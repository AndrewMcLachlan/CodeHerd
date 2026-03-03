import { ipcMain, BrowserWindow, dialog, clipboard, app, shell, nativeTheme } from 'electron';
import * as path from 'path';
import { IPC } from '../shared/ipc-channels';
import type { TabState, TabCreateRequest, RecentlyClosedTab, Preferences, ThemePreference, ResolvedTheme } from '../shared/types';
import { PtyManager } from './pty-manager';
import { StateManager } from './state-manager';
import { SessionTracker } from './session-tracker';
import { getGitInfo } from './git-info';

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return pref;
}

function getThemeColors(resolved: ResolvedTheme) {
  if (resolved === 'light') {
    return { bg: '#eff1f5', titleBar: '#dce0e8', symbolColor: '#4c4f69' };
  }
  return { bg: '#1e1e2e', titleBar: '#11111b', symbolColor: '#cdd6f4' };
}

export function registerIpcHandlers(
  ptyManager: PtyManager,
  stateManager: StateManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  const tabs = new Map<string, TabState>();
  const sessionTracker = new SessionTracker();

  function safeSend(channel: string, ...args: unknown[]): void {
    const win = getMainWindow();
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }

  function saveTabState(): void {
    stateManager.setTabs(Array.from(tabs.values()));
    const activeTab = Array.from(tabs.values()).find(t => t.isActive);
    stateManager.setActiveTabId(activeTab?.id ?? null);
    stateManager.save();
  }

  ipcMain.handle(IPC.TAB_CREATE, async (_event, request: TabCreateRequest): Promise<TabState> => {
    const tabId = request.tabId;
    const { sessionId } = ptyManager.spawn(tabId, request.folder, request.resumeSessionId, request.cols, request.rows);

    // Watch early output for resume failure, fall back to fresh session
    let earlyOutput = '';
    let resumeCheckDone = false;
    let respawning = false;

    ptyManager.onData(tabId, (data) => {
      // Check first ~2KB of output for resume failure
      if (!resumeCheckDone && request.resumeSessionId) {
        earlyOutput += data;
        if (earlyOutput.includes('No conversation found with session ID')) {
          resumeCheckDone = true;
          respawning = true;
          // Gracefully shut down the failed process, then respawn fresh
          ptyManager.gracefulKill(tabId).then(() => {
            const fresh = ptyManager.spawn(tabId, request.folder, undefined, request.cols, request.rows);
            tab.sessionId = fresh.sessionId;
            tab.status = 'running';
            respawning = false;
            // Re-wire data and exit handlers on the new process
            ptyManager.onData(tabId, (d) => {
              safeSend(IPC.PTY_DATA, { tabId, data: d });
            });
            ptyManager.onExit(tabId, (code) => {
              safeSend(IPC.PTY_EXIT, { tabId, exitCode: code });
              tab.status = 'stopped';
              saveTabState();
            });
            saveTabState();
          });
          return;
        }
        if (earlyOutput.length > 2048) {
          resumeCheckDone = true;
        }
      }
      safeSend(IPC.PTY_DATA, { tabId, data });
    });

    ptyManager.onExit(tabId, (exitCode) => {
      // Don't notify renderer if we're killing to respawn a fresh session
      if (respawning) return;
      safeSend(IPC.PTY_EXIT, { tabId, exitCode });
      const tab = tabs.get(tabId);
      if (tab) {
        tab.status = 'stopped';
        saveTabState();
      }
    });

    const tab: TabState = {
      id: tabId,
      launchFolder: request.folder,
      currentFolder: request.folder,
      sessionId,
      label: path.basename(request.folder),
      isActive: true,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      status: request.resumeSessionId ? 'resuming' : 'running',
    };

    // Mark all other tabs as not active
    for (const t of tabs.values()) {
      t.isActive = false;
    }

    tabs.set(tabId, tab);
    saveTabState();
    return tab;
  });

  ipcMain.handle(IPC.TAB_CLOSE, async (_event, { tabId }: { tabId: string }): Promise<void> => {
    await ptyManager.gracefulKill(tabId);
    tabs.delete(tabId);
    saveTabState();
  });

  ipcMain.handle(IPC.TAB_RESIZE, async (_event, { tabId, cols, rows }: { tabId: string; cols: number; rows: number }): Promise<void> => {
    ptyManager.resize(tabId, cols, rows);
  });

  ipcMain.handle(IPC.TAB_INPUT, async (_event, { tabId, data }: { tabId: string; data: string }): Promise<void> => {
    ptyManager.write(tabId, data);
    const tab = tabs.get(tabId);
    if (tab) {
      tab.lastActivityAt = Date.now();
      if (tab.status === 'resuming') {
        tab.status = 'running';
        safeSend(IPC.TAB_STATUS, { tabId, status: 'running' });
      }
    }
  });

  ipcMain.handle(IPC.TAB_GET_ALL, async (): Promise<TabState[]> => {
    return Array.from(tabs.values());
  });

  ipcMain.handle(IPC.FOLDER_PICK, async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select project folder for Claude Code',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.SESSION_LIST, async (_event, { folder }: { folder: string }) => {
    return sessionTracker.getSessionsForFolder(folder);
  });

  ipcMain.handle(IPC.STATE_GET, async () => {
    return stateManager.getState();
  });

  ipcMain.handle(IPC.CLIPBOARD_WRITE, async (_event, text: string): Promise<void> => {
    clipboard.writeText(text);
  });

  ipcMain.handle(IPC.CLIPBOARD_READ, async (): Promise<string> => {
    return clipboard.readText();
  });

  ipcMain.handle(IPC.GIT_INFO, async (_event, { folder }: { folder: string }) => {
    return getGitInfo(folder);
  });

  ipcMain.handle(IPC.SIDEBAR_STATE, async (_event, sidebar: { width: number; collapsed: boolean }) => {
    stateManager.setSidebar(sidebar);
    stateManager.save();
  });

  ipcMain.handle(IPC.RECENTLY_CLOSED, async (_event, items: RecentlyClosedTab[]) => {
    stateManager.setRecentlyClosed(items);
    stateManager.save();
  });

  ipcMain.handle(IPC.THEME_GET_RESOLVED, async () => {
    const prefs = stateManager.getPreferences();
    return resolveTheme(prefs.theme);
  });

  ipcMain.on('theme:get-resolved-sync', (event) => {
    const prefs = stateManager.getPreferences();
    event.returnValue = resolveTheme(prefs.theme);
  });

  ipcMain.on('about:get-version', (event) => {
    event.returnValue = app.getVersion();
  });

  ipcMain.on('about:open-github', () => {
    shell.openExternal('https://github.com/AndrewMcLachlan/CodeHerd');
  });

  let aboutWin: BrowserWindow | null = null;
  let prefsWin: BrowserWindow | null = null;

  ipcMain.handle(IPC.PREFERENCES_GET, async () => {
    return stateManager.getPreferences();
  });

  ipcMain.handle(IPC.PREFERENCES_SAVE, async (_event, prefs: Preferences) => {
    const oldPrefs = stateManager.getPreferences();
    stateManager.setPreferences(prefs);
    stateManager.save();
    safeSend('preferences:changed', prefs);

    // Handle theme change
    if (prefs.theme !== oldPrefs.theme) {
      nativeTheme.themeSource = prefs.theme === 'system' ? 'system' : prefs.theme;
      const resolved = resolveTheme(prefs.theme);
      const colors = getThemeColors(resolved);
      safeSend(IPC.THEME_CHANGED, resolved);

      // Update titlebar overlay colors on Windows/Linux
      const win = getMainWindow();
      if (win && !win.isDestroyed() && process.platform !== 'darwin') {
        win.setTitleBarOverlay({
          color: colors.titleBar,
          symbolColor: colors.symbolColor,
        });
      }
    }
  });

  ipcMain.on('preferences:close', () => {
    if (prefsWin && !prefsWin.isDestroyed()) {
      prefsWin.destroy();
      prefsWin = null;
    }
  });

  ipcMain.on('about:close', () => {
    if (aboutWin && !aboutWin.isDestroyed()) {
      aboutWin.destroy();
      aboutWin = null;
    }
  });

  ipcMain.handle(IPC.MENU_ACTION, async (_event, action: string) => {
    const win = getMainWindow();
    if (!win) return;
    switch (action) {
      case 'quit':
        app.quit();
        break;
      case 'about': {
        if (aboutWin && !aboutWin.isDestroyed()) {
          aboutWin.focus();
          break;
        }
        const aboutColors = getThemeColors(resolveTheme(stateManager.getPreferences().theme));
        aboutWin = new BrowserWindow({
          width: 420,
          height: 240,
          resizable: false,
          minimizable: false,
          maximizable: false,
          parent: win,
          modal: true,
          frame: false,
          backgroundColor: aboutColors.bg,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'about-preload.js'),
          },
        });
        aboutWin.on('closed', () => { aboutWin = null; });
        aboutWin.loadFile(path.join(__dirname, 'about.html'));
        break;
      }
      case 'preferences': {
        if (prefsWin && !prefsWin.isDestroyed()) {
          prefsWin.focus();
          break;
        }
        const prefsColors = getThemeColors(resolveTheme(stateManager.getPreferences().theme));
        prefsWin = new BrowserWindow({
          width: 480,
          height: 380,
          resizable: false,
          minimizable: false,
          maximizable: false,
          parent: win,
          modal: true,
          frame: false,
          backgroundColor: prefsColors.bg,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preferences-preload.js'),
          },
        });
        prefsWin.on('closed', () => { prefsWin = null; });
        prefsWin.loadFile(path.join(__dirname, 'preferences.html'));
        break;
      }
      case 'toggleDevTools':
        win.webContents.toggleDevTools();
        break;
      case 'toggleFullscreen':
        win.setFullScreen(!win.isFullScreen());
        break;
      case 'zoomIn':
        win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
        break;
      case 'zoomOut':
        win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
        break;
      case 'zoomReset':
        win.webContents.setZoomLevel(0);
        break;
    }
  });
}
