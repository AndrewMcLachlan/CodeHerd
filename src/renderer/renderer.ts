import type { PtyDataMessage, TabState, ClaudeSession, AppState, GitInfo, Preferences } from '../shared/types';
import { TerminalManager } from './terminal-manager';
import { TabManager } from './tab-manager';
import { Sidebar } from './sidebar';
import { StatusBar } from './status-bar';
import { AppMenu } from './menu-bar';
import type { MenuItem } from './menu-bar';

// Declare the API exposed by preload
declare global {
  interface Window {
    codeherd: {
      createTab: (request: { tabId: string; folder: string; resumeSessionId?: string; cols?: number; rows?: number }) => Promise<TabState>;
      closeTab: (tabId: string) => Promise<void>;
      resizeTab: (tabId: string, cols: number, rows: number) => Promise<void>;
      inputToTab: (tabId: string, data: string) => Promise<void>;
      getAllTabs: () => Promise<TabState[]>;
      listSessions: (folder: string) => Promise<ClaudeSession[]>;
      pickFolder: () => Promise<string | null>;
      getState: () => Promise<AppState>;
      clipboardWrite: (text: string) => Promise<void>;
      clipboardRead: () => Promise<string>;
      getGitInfo: (folder: string) => Promise<GitInfo>;
      saveSidebarState: (sidebar: { width: number; collapsed: boolean }) => Promise<void>;
      saveRecentlyClosed: (items: { folder: string; sessionId: string; label: string; closedAt: number }[]) => Promise<void>;
      menuAction: (action: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      onPtyData: (cb: (msg: PtyDataMessage) => void) => () => void;
      onPtyExit: (cb: (msg: { tabId: string; exitCode: number }) => void) => () => void;
      onTabStatus: (cb: (msg: { tabId: string; status: string }) => void) => () => void;
      onMenuOpenFolder: (cb: () => void) => () => void;
      onMenuCloseTab: (cb: () => void) => () => void;
      onMenuToggleSidebar: (cb: () => void) => () => void;
      onMenuPreferences: (cb: () => void) => () => void;
      onPreferencesChanged: (cb: (prefs: Preferences) => void) => () => void;
      onThemeChanged: (cb: (resolvedTheme: string) => void) => () => void;
      getResolvedTheme: () => Promise<string>;
    };
  }
}

function formatRecentDetail(folder: string, closedAt?: number): string {
  const parts: string[] = [];
  if (closedAt) {
    const diff = Date.now() - closedAt;
    if (diff < 60_000) parts.push('just now');
    else if (diff < 3_600_000) parts.push(`${Math.floor(diff / 60_000)}m ago`);
    else if (diff < 86_400_000) parts.push(`${Math.floor(diff / 3_600_000)}h ago`);
    else {
      const days = Math.floor(diff / 86_400_000);
      if (days === 1) parts.push('yesterday');
      else if (days < 7) parts.push(`${days}d ago`);
      else parts.push(new Date(closedAt).toLocaleDateString());
    }
  }
  parts.push(folder);
  return parts.join(' \u2022 ');
}

async function init(): Promise<void> {
  // Load persisted state for sidebar
  const state = await window.codeherd.getState();
  const sidebarState = state.sidebar || { width: 260, collapsed: true };

  const terminalManager = new TerminalManager();
  const tabManager = new TabManager(terminalManager);
  const sidebar = new Sidebar(sidebarState.width, sidebarState.collapsed);
  const statusBar = new StatusBar();

  // Set app icon
  (document.getElementById('app-menu-icon') as HTMLImageElement).src = './menu-icon.png';

  const isMac = navigator.platform.startsWith('Mac');
  const mod = isMac ? '\u2318' : 'Ctrl+';

  // Track recently closed tabs (loaded from persisted state)
  const recentlyClosed: { folder: string; sessionId: string; label: string; closedAt: number }[] =
    [...(state.recentlyClosed || [])];
  const MAX_RECENT = 10;

  const saveRecent = () => window.codeherd.saveRecentlyClosed(recentlyClosed);

  tabManager.setOnTabClose((tab) => {
    recentlyClosed.unshift({
      folder: tab.launchFolder,
      sessionId: tab.sessionId,
      label: tab.label,
      closedAt: Date.now(),
    });
    if (recentlyClosed.length > MAX_RECENT) {
      recentlyClosed.length = MAX_RECENT;
    }
    saveRecent();
  });

  tabManager.setOnAllTabsClosed(() => {
    sidebar.clear();
    statusBar.update(null, null);
  });

  new AppMenu(() => {
    const items: MenuItem[] = [
      { label: 'New Tab', shortcut: `${mod}T`, action: () => tabManager.openNewTab() },
      { label: 'Close Tab', shortcut: `${mod}W`, action: () => {
        const active = tabManager.getActiveTab();
        if (active) tabManager.closeTab(active.id);
      }},
      { separator: true },
    ];

    items.push({
      label: 'Recently Closed',
      disabled: recentlyClosed.length === 0,
      submenu: recentlyClosed.length > 0
        ? recentlyClosed.map(recent => ({
            label: recent.label,
            detail: formatRecentDetail(recent.folder, recent.closedAt),
            action: () => {
              tabManager.createTab(recent.folder, recent.sessionId);
              const idx = recentlyClosed.indexOf(recent);
              if (idx >= 0) recentlyClosed.splice(idx, 1);
              saveRecent();
            },
          }))
        : undefined,
    });
    items.push({ separator: true });

    items.push(
      { label: 'Toggle Sidebar', shortcut: `${mod}B`, action: () => sidebar.toggle() },
      { label: 'Toggle Fullscreen', shortcut: 'F11', action: () => window.codeherd.menuAction('toggleFullscreen') },
      { separator: true },
      { label: 'Zoom In', shortcut: `${mod}+`, action: () => window.codeherd.menuAction('zoomIn') },
      { label: 'Zoom Out', shortcut: `${mod}-`, action: () => window.codeherd.menuAction('zoomOut') },
      { label: 'Reset Zoom', shortcut: `${mod}0`, action: () => window.codeherd.menuAction('zoomReset') },
      { separator: true },
      { label: 'Developer Tools', shortcut: 'F12', action: () => window.codeherd.menuAction('toggleDevTools') },
      { separator: true },
      { label: 'Preferences', shortcut: `${mod},`, action: () => window.codeherd.menuAction('preferences') },
      { label: 'About CodeHerd', action: () => window.codeherd.menuAction('about') },
      { separator: true },
      { label: 'Exit', shortcut: 'Alt+F4', action: () => window.codeherd.menuAction('quit') },
    );

    return items;
  });

  // When terminal title changes, update status bar
  terminalManager.setOnTitleChange((tabId, title) => {
    statusBar.setTerminalTitle(tabId, title);
    const active = tabManager.getActiveTab();
    if (active && active.id === tabId) {
      statusBar.update(active.launchFolder, active.id);
    }
  });

  // When a session is clicked in the sidebar, open it in a new tab
  sidebar.setOnResumeSession(async (session) => {
    await tabManager.createTab(session.project, session.sessionId);
  });

  // When switching tabs, update sidebar and status bar
  tabManager.setOnTabSwitch((tab) => {
    sidebar.loadSessionsForFolder(tab.launchFolder);
    statusBar.update(tab.launchFolder, tab.id);
  });

  // Wire PTY data to the correct terminal
  window.codeherd.onPtyData((msg) => {
    terminalManager.write(msg.tabId, msg.data);
  });

  window.codeherd.onPtyExit((msg) => {
    tabManager.markExited(msg.tabId, msg.exitCode);
  });

  window.codeherd.onTabStatus((msg) => {
    tabManager.updateStatus(msg.tabId, msg.status as TabState['status']);
  });

  // New tab button
  document.getElementById('new-tab-btn')!.addEventListener('click', () => {
    tabManager.openNewTab();
  });

  // Empty state button
  document.getElementById('open-first-tab')?.addEventListener('click', () => {
    tabManager.openNewTab();
  });

  // Menu events from main process
  window.codeherd.onMenuOpenFolder(() => {
    tabManager.openNewTab();
  });

  window.codeherd.onMenuCloseTab(() => {
    const active = tabManager.getActiveTab();
    if (active) {
      tabManager.closeTab(active.id);
    }
  });

  window.codeherd.onMenuToggleSidebar(() => {
    sidebar.toggle();
  });

  window.codeherd.onMenuPreferences(() => {
    window.codeherd.menuAction('preferences');
  });

  // Apply preferences
  const prefs = state.preferences ?? { warnBeforeClosingTabs: true, fontFamily: '', theme: 'dark' as const };
  if (prefs.fontFamily) {
    terminalManager.setFontFamily(prefs.fontFamily);
  }
  tabManager.setWarnBeforeClose(prefs.warnBeforeClosingTabs);

  // Apply initial theme
  const resolvedTheme = await window.codeherd.getResolvedTheme();
  document.documentElement.dataset.theme = resolvedTheme;
  terminalManager.setTheme(resolvedTheme as 'light' | 'dark');

  window.codeherd.onPreferencesChanged((newPrefs) => {
    terminalManager.setFontFamily(newPrefs.fontFamily);
    tabManager.setWarnBeforeClose(newPrefs.warnBeforeClosingTabs);
  });

  // Listen for theme changes (from preferences save or OS theme change)
  window.codeherd.onThemeChanged((newTheme) => {
    document.documentElement.dataset.theme = newTheme;
    terminalManager.setTheme(newTheme as 'light' | 'dark');
  });

  // Keyboard shortcuts (fallback for when menu accelerators don't fire)
  const modKey = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+T: new tab
    if (modKey(e) && e.key === 't') {
      e.preventDefault();
      tabManager.openNewTab();
    }
    // Ctrl/Cmd+W: close current tab
    if (modKey(e) && e.key === 'w') {
      e.preventDefault();
      const active = tabManager.getActiveTab();
      if (active) {
        tabManager.closeTab(active.id);
      }
    }
    // Ctrl/Cmd+B: toggle sidebar
    if (modKey(e) && e.key === 'b') {
      e.preventDefault();
      sidebar.toggle();
    }
  });

  // Restore tabs from previous session
  const tabsToRestore = state.tabs.filter(t => t.status === 'running' || t.status === 'resuming');

  if (tabsToRestore.length > 0) {
    for (const savedTab of tabsToRestore) {
      try {
        await tabManager.createTab(savedTab.launchFolder, savedTab.sessionId);
      } catch (err) {
        console.error('Failed to restore tab:', savedTab.label, err);
      }
    }
    // Switch to the previously active tab
    if (state.activeTabId) {
      const activeOriginal = state.tabs.find(t => t.id === state.activeTabId);
      if (activeOriginal) {
        const match = tabManager.getAllTabs().find(
          t => t.launchFolder === activeOriginal.launchFolder && t.sessionId === activeOriginal.sessionId
        );
        if (match) {
          tabManager.switchTo(match.id);
        }
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
