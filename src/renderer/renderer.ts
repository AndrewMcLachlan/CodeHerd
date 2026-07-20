import type { AgentAvailability, AgentSession, AgentType, PtyDataMessage, TabState, AppState, GitInfo, Preferences, NewTabShortcut, RecentlyClosedTab, TabMetadataMessage, TabSessionMessage, UpdateInfo } from '../shared/types';
import { DEFAULT_NEW_TAB_SHORTCUT, formatShortcut, matchesShortcut } from '../shared/shortcut';
import { DEFAULT_TERMINAL_FONT_SIZE_POINTS, TerminalManager } from './terminal-manager';
import { TabManager } from './tab-manager';
import { Sidebar } from './sidebar';
import { StatusBar } from './status-bar';
import { AppMenu } from './menu-bar';
import type { MenuItem } from './menu-bar';

// Declare the API exposed by preload
declare global {
  interface Window {
    codeherd: {
      createTab: (request: { tabId: string; agent: AgentType; folder: string; resumeSessionId?: string; cols?: number; rows?: number }) => Promise<TabState>;
      closeTab: (tabId: string) => Promise<void>;
      resizeTab: (tabId: string, cols: number, rows: number) => Promise<void>;
      inputToTab: (tabId: string, data: string) => Promise<void>;
      reorderTabs: (tabIds: string[]) => Promise<void>;
      getAllTabs: () => Promise<TabState[]>;
      listSessions: (folder: string, agent: AgentType) => Promise<AgentSession[]>;
      getAvailableAgents: () => Promise<AgentAvailability>;
      pickFolder: () => Promise<string | null>;
      getState: () => Promise<AppState>;
      clipboardWrite: (text: string) => Promise<void>;
      clipboardRead: () => Promise<string>;
      clipboardHasImage: () => Promise<boolean>;
      getGitInfo: (folder: string) => Promise<GitInfo>;
      saveSidebarState: (sidebar: { width: number; collapsed: boolean }) => Promise<void>;
      saveRecentlyClosed: (items: RecentlyClosedTab[]) => Promise<void>;
      menuAction: (action: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      dismissUpdate: (version: string) => Promise<void>;
      onUpdateAvailable: (cb: (info: UpdateInfo) => void) => () => void;
      onPtyData: (cb: (msg: PtyDataMessage) => void) => () => void;
      onPtyExit: (cb: (msg: { tabId: string; exitCode: number }) => void) => () => void;
      onTabStatus: (cb: (msg: { tabId: string; status: string }) => void) => () => void;
      onTabMetadata: (cb: (msg: TabMetadataMessage) => void) => () => void;
      onTabSession: (cb: (msg: TabSessionMessage) => void) => () => void;
      onMenuOpenFolder: (cb: (agent?: AgentType) => void) => () => void;
      onMenuCloseTab: (cb: () => void) => () => void;
      onMenuToggleSidebar: (cb: () => void) => () => void;
      onMenuRestoreRecent: (cb: (msg: { agent: AgentType; folder: string; sessionId: string; index: number }) => void) => () => void;
      onMenuPreferences: (cb: () => void) => () => void;
      onPreferencesChanged: (cb: (prefs: Preferences) => void) => () => void;
      onThemeChanged: (cb: (resolvedTheme: string) => void) => () => void;
      getResolvedTheme: () => Promise<string>;
      isDev: boolean;
    };
  }
}

function getNotificationStack(): HTMLDivElement {
  const existing = document.getElementById('notification-stack');
  if (existing instanceof HTMLDivElement) return existing;

  const stack = document.createElement('div');
  stack.id = 'notification-stack';
  stack.setAttribute('aria-live', 'polite');
  document.body.appendChild(stack);
  return stack;
}

function createDismissButton(label: string, onDismiss: () => void): HTMLButtonElement {
  const dismiss = document.createElement('button');
  dismiss.title = 'Dismiss';
  dismiss.setAttribute('aria-label', label);
  dismiss.textContent = '×';
  dismiss.addEventListener('click', onDismiss);
  return dismiss;
}

/** Dismissible toast shown when a newer release is available. */
function showUpdateBanner(info: UpdateInfo): void {
  if (document.getElementById('update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.className = 'notification-banner';

  const text = document.createElement('span');
  text.textContent = `New version ${info.version} available`;

  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'Download';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    window.codeherd.openExternal(info.url);
  });

  const dismiss = createDismissButton('Dismiss update notification', () => {
    window.codeherd.dismissUpdate(info.version);
    banner.remove();
  });

  banner.append(text, link, dismiss);
  getNotificationStack().appendChild(banner);
}

/** Friendly warning shown when CodeHerd cannot find a supported CLI agent. */
function showNoAgentsWarning(): void {
  if (document.getElementById('no-agents-warning')) return;

  const banner = document.createElement('div');
  banner.id = 'no-agents-warning';
  banner.className = 'notification-banner warning';
  banner.setAttribute('role', 'alert');

  const text = document.createElement('span');
  text.textContent = 'No supported CLI agents found. Install Claude Code or Codex, then restart CodeHerd.';

  const dismiss = createDismissButton('Dismiss agent warning', () => banner.remove());
  banner.append(text, dismiss);
  getNotificationStack().appendChild(banner);
}

function formatRecentDetail(agent: AgentType, folder: string, closedAt?: number): string {
  const parts: string[] = [agent === 'codex' ? 'Codex' : 'Claude'];
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
  const [state, availableAgents] = await Promise.all([
    window.codeherd.getState(),
    window.codeherd.getAvailableAgents(),
  ]);
  const sidebarState = state.sidebar || { width: 260, collapsed: true };
  const prefs = state.preferences ?? {
    warnBeforeClosingTabs: true,
    fontFamily: '',
    fontSize: DEFAULT_TERMINAL_FONT_SIZE_POINTS,
    terminalForeground: '',
    terminalBackground: '',
    theme: 'dark' as const,
    tabSwitchMode: 'mru' as const,
    newTabShortcut: 'Ctrl+T' as const,
    defaultAgent: 'claude' as const,
  };

  const terminalManager = new TerminalManager();
  const tabManager = new TabManager(terminalManager, availableAgents, prefs.defaultAgent ?? 'claude');
  const sidebar = new Sidebar(sidebarState.width, sidebarState.collapsed);
  const statusBar = new StatusBar();

  // Set app icon
  (document.getElementById('app-menu-icon') as HTMLImageElement).src = './menu-icon.png';

  const isMac = navigator.platform.startsWith('Mac');
  if (isMac) document.documentElement.dataset.platform = 'mac';
  const mod = isMac ? '\u2318' : 'Ctrl+';

  // Configurable New Tab shortcut (#69). 'none' leaves Ctrl+T for Claude Code.
  let newTabShortcut: NewTabShortcut = DEFAULT_NEW_TAB_SHORTCUT;
  const newTabShortcutLabel = (): string | undefined => formatShortcut(newTabShortcut, isMac);
  const updateNewTabButtonTitle = () => {
    const label = newTabShortcutLabel();
    const action = tabManager.getNewTabMenuOptions()[0].label;
    document.getElementById('new-tab-btn')!.title = label ? `${action} (${label})` : action;
  };
  const applyNewTabShortcut = (shortcut: NewTabShortcut | undefined) => {
    newTabShortcut = shortcut ?? DEFAULT_NEW_TAB_SHORTCUT;
    terminalManager.setNewTabShortcut(newTabShortcut);
    updateNewTabButtonTitle();
  };
  const matchesNewTabShortcut = (e: KeyboardEvent): boolean => matchesShortcut(newTabShortcut, e);

  // Track recently closed tabs (loaded from persisted state)
  const recentlyClosed: RecentlyClosedTab[] = [...(state.recentlyClosed || [])];
  const MAX_RECENT = 10;

  const saveRecent = () => window.codeherd.saveRecentlyClosed(recentlyClosed);

  tabManager.setOnTabClose((tab) => {
    recentlyClosed.unshift({
      agent: tab.agent,
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

  tabManager.setOnTabReorder(() => {
    const tabIds = tabManager.getAllTabs().map(t => t.id);
    window.codeherd.reorderTabs(tabIds);
  });

  tabManager.setOnAllTabsClosed(() => {
    sidebar.clear();
    statusBar.update(null, null);
  });

  new AppMenu(() => {
    const items: MenuItem[] = tabManager.getNewTabMenuOptions().map((option, index) => ({
      label: option.label,
      shortcut: index === 0 ? newTabShortcutLabel() : undefined,
      disabled: !option.agent,
      action: () => option.agent && tabManager.openNewTab(option.agent),
    }));
    items.push(
      { label: 'Close Tab', shortcut: `${mod}W`, action: () => {
        const active = tabManager.getActiveTab();
        if (active) tabManager.closeTab(active.id);
      }},
      { separator: true },
    );

    items.push({
      label: 'Recently Closed',
      disabled: recentlyClosed.length === 0,
      submenu: recentlyClosed.length > 0
        ? recentlyClosed.map(recent => ({
            label: formatRecentDetail(recent.agent, recent.folder, recent.closedAt),
            action: () => {
              tabManager.createTab(recent.folder, recent.agent, recent.sessionId);
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
      ...(window.codeherd.isDev ? [
        { separator: true } as MenuItem,
        { label: 'Developer Tools', shortcut: 'F12', action: () => window.codeherd.menuAction('toggleDevTools') } as MenuItem,
      ] : []),
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
    await tabManager.createTab(session.project, session.agent, session.sessionId);
  });

  // When switching tabs, update sidebar and status bar
  tabManager.setOnTabSwitch((tab) => {
    sidebar.loadSessionsForFolder(tab.launchFolder, tab.agent);
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

  window.codeherd.onTabMetadata((msg) => {
    tabManager.applyMetadata(msg);
  });

  window.codeherd.onTabSession((msg) => {
    tabManager.updateSession(msg);
  });

  window.codeherd.onUpdateAvailable((info) => {
    showUpdateBanner(info);
  });

  if (!availableAgents.claude && !availableAgents.codex) showNoAgentsWarning();

  // New tab button
  document.getElementById('new-tab-btn')!.addEventListener('click', () => {
    tabManager.openNewTab();
  });

  // Empty state button
  document.getElementById('open-first-tab')?.addEventListener('click', () => {
    tabManager.openNewTab();
  });

  // Menu events from main process
  window.codeherd.onMenuOpenFolder((agent) => {
    tabManager.openNewTab(agent);
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

  window.codeherd.onMenuRestoreRecent((msg) => {
    tabManager.createTab(msg.folder, msg.agent, msg.sessionId);
    recentlyClosed.splice(msg.index, 1);
    saveRecent();
  });

  window.codeherd.onMenuPreferences(() => {
    window.codeherd.menuAction('preferences');
  });

  // Apply preferences
  if (prefs.fontFamily) {
    terminalManager.setFontFamily(prefs.fontFamily);
  }
  terminalManager.setFontSize(prefs.fontSize);
  terminalManager.setColors(prefs.terminalForeground, prefs.terminalBackground);
  tabManager.setWarnBeforeClose(prefs.warnBeforeClosingTabs);
  tabManager.setTabSwitchMode(prefs.tabSwitchMode ?? 'mru');
  tabManager.setDefaultAgent(prefs.defaultAgent ?? 'claude');
  applyNewTabShortcut(prefs.newTabShortcut);

  // Apply initial theme
  const resolvedTheme = await window.codeherd.getResolvedTheme();
  document.documentElement.dataset.theme = resolvedTheme;
  terminalManager.setTheme(resolvedTheme as 'light' | 'dark');

  window.codeherd.onPreferencesChanged((newPrefs) => {
    terminalManager.setFontFamily(newPrefs.fontFamily);
    terminalManager.setFontSize(newPrefs.fontSize);
    terminalManager.setColors(newPrefs.terminalForeground, newPrefs.terminalBackground);
    tabManager.setWarnBeforeClose(newPrefs.warnBeforeClosingTabs);
    tabManager.setTabSwitchMode(newPrefs.tabSwitchMode ?? 'mru');
    tabManager.setDefaultAgent(newPrefs.defaultAgent ?? 'claude');
    applyNewTabShortcut(newPrefs.newTabShortcut);
  });

  // Listen for theme changes (from preferences save or OS theme change)
  window.codeherd.onThemeChanged((newTheme) => {
    document.documentElement.dataset.theme = newTheme;
    terminalManager.setTheme(newTheme as 'light' | 'dark');
  });

  // Keyboard shortcuts (fallback for when menu accelerators don't fire)
  const modKey = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
  document.addEventListener('keydown', (e) => {
    // New tab (configurable, default Ctrl/Cmd+T — see #69)
    if (matchesNewTabShortcut(e)) {
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
    // Ctrl+Tab / Ctrl+Shift+Tab: cycle through tabs
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        tabManager.switchToPrevious();
      } else {
        tabManager.switchToNext();
      }
    }
    // Alt+1 through Alt+9: switch to tab by index
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      tabManager.switchToIndex(parseInt(e.key, 10));
    }
    // F12: toggle dev tools (dev only)
    if (e.key === 'F12' && window.codeherd.isDev) {
      e.preventDefault();
      window.codeherd.menuAction('toggleDevTools');
    }
  });

  // Styling mode: show dummy tabs for each status, no PTY or state interaction
  const isStylingMode = new URLSearchParams(window.location.search).has('styling');

  if (isStylingMode) {
    const statuses: TabState['status'][] = ['running', 'waiting', 'attention', 'resuming', 'stopped'];
    for (const status of statuses) {
      tabManager.addStylingTab(status);
    }
    return;
  }

  // Restore tabs from previous session
  const tabsToRestore = state.tabs.filter(t => t.status !== 'stopped');

  if (tabsToRestore.length > 0) {
    for (const savedTab of tabsToRestore) {
      try {
        await tabManager.createTab(savedTab.launchFolder, savedTab.agent, savedTab.sessionId);
      } catch (err) {
        console.error('Failed to restore tab:', savedTab.label, err);
      }
    }
    // Switch to the previously active tab
    if (state.activeTabId) {
      const activeOriginal = state.tabs.find(t => t.id === state.activeTabId);
      if (activeOriginal) {
        const match = tabManager.getAllTabs().find(
          t => t.agent === activeOriginal.agent
            && t.launchFolder === activeOriginal.launchFolder
            && t.sessionId === activeOriginal.sessionId
        );
        if (match) {
          tabManager.switchTo(match.id);
        }
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
