import { ipcMain, BrowserWindow, dialog, clipboard, app, shell, nativeTheme } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { IPC } from '../shared/ipc-channels';
import type { TabState, TabCreateRequest, RecentlyClosedTab, Preferences, ThemePreference, ResolvedTheme, TabMetadataMessage } from '../shared/types';
import { PtyManager } from './pty-manager';
import { StateManager } from './state-manager';
import { SessionTracker } from './session-tracker';
import { SessionMetadataWatcher } from './session-metadata-watcher';
import { HistoryWatcher } from './history-watcher';
import { AgentRegistry } from './agent-registry';
import { getGitInfo } from './git-info';
import { detectStatus } from './status-detection';
import { getAvailableUpdate } from './update-checker';

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
  isQuitting: () => boolean,
  rebuildMenu?: (items?: RecentlyClosedTab[]) => void,
): void {
  const tabs = new Map<string, TabState>();
  const agentRegistry = new AgentRegistry();
  const sessionTracker = new SessionTracker(agentRegistry);

  // Restoring tabs is the first thing the renderer does, and each one needs to know
  // whether its session is a live background agent — warm the cache now so it doesn't
  // wait on the lookup.
  agentRegistry.prime();

  function safeSend(channel: string, ...args: unknown[]): void {
    const win = getMainWindow();
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }

  // React to /rename and /color slash commands executed inside Claude Code by watching the
  // per-session metadata file Claude writes to ~/.claude/sessions/<pid>.json.
  const metadataWatcher = new SessionMetadataWatcher((msg: TabMetadataMessage) => {
    const tab = tabs.get(msg.tabId);
    if (!tab) return;
    // `durable` = a change worth writing to state.json; `changed` = anything worth painting.
    // Context fill updates every assistant turn, so it forwards to the renderer but doesn't
    // trigger a disk write each time — it's re-derived from the transcript on restore anyway.
    let durable = false;
    let changed = false;
    if (msg.name !== undefined) {
      const next = msg.name && msg.name.trim().length > 0 ? msg.name.trim() : path.basename(tab.launchFolder);
      if (tab.label !== next) { tab.label = next; durable = true; changed = true; }
    }
    if (msg.color !== undefined) {
      if (msg.color) {
        if (tab.color !== msg.color) { tab.color = msg.color; durable = true; changed = true; }
      } else if (tab.color !== undefined) {
        delete tab.color;
        durable = true;
        changed = true;
      }
    }
    if (msg.model !== undefined && tab.model !== msg.model) { tab.model = msg.model; durable = true; changed = true; }
    if (msg.contextTokens !== undefined && tab.contextTokens !== msg.contextTokens) { tab.contextTokens = msg.contextTokens; changed = true; }
    if (msg.contextLimit !== undefined && tab.contextLimit !== msg.contextLimit) { tab.contextLimit = msg.contextLimit; changed = true; }
    if (msg.effort !== undefined && tab.effort !== msg.effort) { tab.effort = msg.effort; changed = true; }
    if (durable) saveTabState();
    if (changed) safeSend(IPC.TAB_METADATA, msg);
  });
  metadataWatcher.start();

  const normalizeFolder = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

  // A tab's sessionId is captured once, at spawn. But Claude rolls it forward mid-tab
  // (notably `/clear`, which starts a new conversation under a new id), and nothing
  // else tells us. Without this, restart resumes the stale session. history.jsonl gets
  // one entry per submitted prompt tagged with the *current* session id for its folder,
  // so we use it to keep the owning tab in sync.
  const historyWatcher = new HistoryWatcher(async ({ project, sessionId }) => {
    const target = normalizeFolder(project);
    const candidates = Array.from(tabs.values()).filter(t => normalizeFolder(t.launchFolder) === target);
    if (candidates.length === 0) return;

    // With multiple tabs on the same folder, the prompt that produced this entry came
    // from whichever the user is interacting with — prefer the active tab, else the
    // most recently active one.
    const tab = candidates.find(t => t.isActive)
      ?? candidates.sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
    if (!tab || tab.sessionId === sessionId) return;

    // A background agent logs prompts against the same project folder as the tab it was
    // launched from, but it's a separate conversation the user drives elsewhere. Adopting
    // its id would hand the tab a session that can't be resumed on restart.
    if (await agentRegistry.getBackgroundAgent(sessionId)) return;

    // The tab may have been closed while we were checking.
    if (!tabs.has(tab.id) || tab.sessionId === sessionId) return;

    // Re-point the metadata watcher at the new session so /rename and /color keep working.
    metadataWatcher.unregisterTab(tab.sessionId);
    tab.sessionId = sessionId;
    tab.lastActivityAt = Date.now();
    metadataWatcher.registerTab(tab.id, sessionId);
    saveTabState();
  });
  historyWatcher.start();

  function saveTabState(): void {
    stateManager.setTabs(Array.from(tabs.values()));
    const activeTab = Array.from(tabs.values()).find(t => t.isActive);
    stateManager.setActiveTabId(activeTab?.id ?? null);
    stateManager.save();
  }

  ipcMain.handle(IPC.TAB_CREATE, async (_event, request: TabCreateRequest): Promise<TabState> => {
    const tabId = request.tabId;

    // A background agent's session can't be resumed while its process is alive — the CLI
    // refuses and points you at `claude agents`. Every path that reopens a session (tab
    // restore, sidebar click, recently-closed) lands here, so resolve it once, here:
    // attach to a live agent, and resume anything else (including agents that have exited).
    const agent = request.resumeSessionId
      ? await agentRegistry.getBackgroundAgent(request.resumeSessionId)
      : undefined;

    // A session Claude never persisted — e.g. a tab opened but never used before the app
    // was closed — has no transcript, so `claude --resume` prints "No conversation found"
    // into the tab. Fall back to a fresh session so the tab reopens cleanly. Live
    // background agents are exempt: they attach, and needn't have a transcript yet.
    let resumeSessionId = request.resumeSessionId;
    if (resumeSessionId && !agent && !(await sessionTracker.canResume(request.folder, resumeSessionId))) {
      resumeSessionId = undefined;
    }

    const { sessionId } = ptyManager.spawn(tabId, request.folder, {
      resumeSessionId,
      attachAgentId: agent?.agentId,
      cols: request.cols,
      rows: request.rows,
    });

    const logPath = path.join(app.getPath('userData'), `pty-debug-${tabId}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    ptyManager.onData(tabId, (data) => {
      // Log raw data with control codes visible
      const escaped = data.replace(/[\x00-\x1f\x7f]/g, (ch) => {
        const code = ch.charCodeAt(0);
        const names: Record<number, string> = { 3: 'ETX', 4: 'EOT', 7: 'BEL', 8: 'BS', 9: 'TAB', 10: 'LF', 13: 'CR', 27: 'ESC' };
        return `<${names[code] ?? `0x${code.toString(16).padStart(2, '0')}`}>`;
      });
      logStream.write(`[${new Date().toISOString()}] ${escaped}\n`);

      const currentTab = tabs.get(tabId);
      if (currentTab && currentTab.status !== 'stopped') {
        const newStatus = detectStatus(data, currentTab.status);
        if (newStatus) {
          currentTab.status = newStatus;
          safeSend(IPC.TAB_STATUS, { tabId, status: newStatus });
        }
      }

      safeSend(IPC.PTY_DATA, { tabId, data });
    });

    ptyManager.onExit(tabId, (exitCode) => {
      safeSend(IPC.PTY_EXIT, { tabId, exitCode });
      const currentTab = tabs.get(tabId);
      if (currentTab) {
        currentTab.status = 'stopped';
        // Don't save 'stopped' state during shutdown — we want tabs to restore on restart
        if (!isQuitting()) {
          saveTabState();
        }
      }
    });

    // Register with the metadata watcher *first* so its initial transcript read populates
    // lastSeen — then the seed below can carry the name, colour, and model Claude has already
    // written, painting them on first render rather than waiting for a later IPC event (which
    // for a resumed session may never come, since the model only re-emits when it changes).
    metadataWatcher.registerTab(tabId, sessionId);

    const known = metadataWatcher.getKnownMetadata(sessionId);
    const initialLabel = known?.name?.trim() || path.basename(request.folder);

    const tab: TabState = {
      id: tabId,
      launchFolder: request.folder,
      currentFolder: request.folder,
      sessionId,
      label: initialLabel,
      ...(known?.color ? { color: known.color } : {}),
      ...(known?.model ? { model: known.model } : {}),
      ...(known?.contextTokens != null ? { contextTokens: known.contextTokens } : {}),
      ...(known?.contextLimit != null ? { contextLimit: known.contextLimit } : {}),
      ...(known?.effort ? { effort: known.effort } : {}),
      isActive: true,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      status: resumeSessionId ? 'resuming' : 'running',
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
    const tab = tabs.get(tabId);
    if (tab) metadataWatcher.unregisterTab(tab.sessionId);
    await ptyManager.gracefulKill(tabId);
    tabs.delete(tabId);
    saveTabState();
  });

  ipcMain.handle(IPC.TAB_REORDER, async (_event, tabIds: string[]): Promise<void> => {
    const reordered = new Map<string, TabState>();
    for (const id of tabIds) {
      const tab = tabs.get(id);
      if (tab) reordered.set(id, tab);
    }
    tabs.clear();
    for (const [id, tab] of reordered) {
      tabs.set(id, tab);
    }
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
      } else if (tab.status === 'attention') {
        // Ignore cursor sequences (arrow-key navigation in selection prompts),
        // both CSI (ESC[A) and SS3 (ESC OA) forms. A bare Escape is not
        // navigation — it dismisses the prompt or screen (e.g. /usage),
        // so it must clear the attention status (#56)
        const isNavKey = /^\x1b[\[O]./.test(data);
        if (!isNavKey) {
          tab.status = 'waiting';
          safeSend(IPC.TAB_STATUS, { tabId, status: 'waiting' });
        }
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
    // The Win32 clipboard is a global lock, and writes silently fail when a
    // clipboard listener (Windows clipboard history, Ditto, PowerToys, ...)
    // happens to hold it. Verify the write landed and retry briefly (#59)
    for (let attempt = 0; attempt < 5; attempt++) {
      clipboard.writeText(text);
      if (clipboard.readText() === text) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.warn('clipboard write failed after retries');
  });

  ipcMain.handle(IPC.CLIPBOARD_READ, async (): Promise<string> => {
    return clipboard.readText();
  });

  ipcMain.handle(IPC.CLIPBOARD_HAS_IMAGE, async (): Promise<boolean> => {
    // readImage (not availableFormats) so Windows delayed clipboard
    // rendering is forced to resolve
    return !clipboard.readImage().isEmpty();
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
    rebuildMenu?.(items);
  });

  ipcMain.handle(IPC.THEME_GET_RESOLVED, async () => {
    const prefs = stateManager.getPreferences();
    return resolveTheme(prefs.theme);
  });

  ipcMain.on('theme:get-resolved-sync', (event) => {
    const prefs = stateManager.getPreferences();
    event.returnValue = resolveTheme(prefs.theme);
  });

  ipcMain.on('app:is-packaged', (event) => {
    event.returnValue = app.isPackaged;
  });

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, async (_event, url: string) => {
    // Only allow http/https URLs
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });

  ipcMain.on('about:get-version', (event) => {
    event.returnValue = app.getVersion();
  });

  ipcMain.handle(IPC.UPDATE_DISMISS, async (_event, version: string) => {
    stateManager.setDismissedUpdateVersion(version);
    stateManager.save();
  });

  // Used by the About window (sendSync) to show any known update
  ipcMain.on(IPC.UPDATE_GET_SYNC, (event) => {
    event.returnValue = getAvailableUpdate();
  });

  ipcMain.on(IPC.UPDATE_OPEN, () => {
    const update = getAvailableUpdate();
    if (update) shell.openExternal(update.url);
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

    if (prefs.newTabShortcut !== oldPrefs.newTabShortcut) {
      // Re-register the New Tab accelerator with the new binding
      rebuildMenu?.();
    }

    if (prefs.theme !== oldPrefs.theme) {
      nativeTheme.themeSource = prefs.theme === 'system' ? 'system' : prefs.theme;
      const resolved = resolveTheme(prefs.theme);
      const colors = getThemeColors(resolved);
      safeSend(IPC.THEME_CHANGED, resolved);

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
          height: 540,
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
