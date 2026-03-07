import type { TabId, TabState } from '../shared/types';
import { TerminalManager } from './terminal-manager';

export class TabManager {
  private tabs = new Map<TabId, TabState>();
  private activeTabId: TabId | null = null;
  private tabBar: HTMLElement;
  private terminalManager: TerminalManager;
  private onTabSwitch: ((tab: TabState) => void) | null = null;
  private onTabClose: ((tab: TabState) => void) | null = null;
  private onAllTabsClosed: (() => void) | null = null;
  private warnBeforeClose = true;

  constructor(terminalManager: TerminalManager) {
    this.tabBar = document.getElementById('tab-bar')!;
    this.terminalManager = terminalManager;
  }

  setOnTabSwitch(callback: (tab: TabState) => void): void {
    this.onTabSwitch = callback;
  }

  setOnTabClose(callback: (tab: TabState) => void): void {
    this.onTabClose = callback;
  }

  setOnAllTabsClosed(callback: () => void): void {
    this.onAllTabsClosed = callback;
  }

  setWarnBeforeClose(warn: boolean): void {
    this.warnBeforeClose = warn;
  }

  async createTab(folder: string, resumeSessionId?: string): Promise<TabState> {
    // Generate the tab ID here so the terminal is ready before the PTY spawns
    const tabId = crypto.randomUUID();

    // Create and show the xterm terminal to get real dimensions
    this.terminalManager.create(tabId);
    this.terminalManager.show(tabId);

    // Allow layout to settle (show() uses rAF + 100ms setTimeout for fitting)
    await new Promise(r => setTimeout(r, 150));
    const dims = this.terminalManager.getDimensions(tabId);

    // Spawn the PTY with the same tabId and correct dimensions
    const tab = await window.codeherd.createTab({
      tabId,
      folder,
      resumeSessionId,
      cols: dims?.cols,
      rows: dims?.rows,
    });

    this.tabs.set(tab.id, tab);
    this.renderTab(tab);
    this.switchTo(tab.id);
    this.hideEmptyState();
    return tab;
  }

  switchTo(tabId: TabId): void {
    // Update previous active tab
    if (this.activeTabId) {
      const prev = this.tabs.get(this.activeTabId);
      if (prev) prev.isActive = false;
    }

    this.activeTabId = tabId;
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.isActive = true;
      tab.lastActivityAt = Date.now();
    }

    this.terminalManager.show(tabId);

    // Update tab bar visual state
    this.tabBar.querySelectorAll('.tab').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset.tabId === tabId);
    });

    if (tab && this.onTabSwitch) {
      this.onTabSwitch(tab);
    }
  }

  async closeTab(tabId: TabId): Promise<void> {
    const closedTab = this.tabs.get(tabId);

    // Confirm if the tab is still running and the preference is enabled
    if (this.warnBeforeClose && closedTab && closedTab.status === 'running') {
      if (!confirm(`Close "${closedTab.label}"? The Claude session will be stopped.`)) {
        return;
      }
    }

    // Notify before removing
    if (closedTab && this.onTabClose) {
      this.onTabClose(closedTab);
    }

    // Remove from UI immediately so it feels instant
    this.terminalManager.dispose(tabId);
    this.tabs.delete(tabId);
    this.tabBar.querySelector(`[data-tab-id="${tabId}"]`)?.remove();

    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length > 0) {
        this.switchTo(remaining[remaining.length - 1]);
      } else {
        this.activeTabId = null;
        this.showEmptyState();
        this.onAllTabsClosed?.();
      }
    }

    // Graceful shutdown happens in the background
    window.codeherd.closeTab(tabId);
  }

  updateStatus(tabId: TabId, status: TabState['status']): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.status = status;
    }
    const tabEl = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabEl) {
      tabEl.classList.toggle('waiting', status === 'waiting');
      tabEl.classList.toggle('attention', status === 'attention');
    }
  }

  markExited(tabId: TabId, exitCode: number): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.status = 'stopped';
    }
    const tabEl = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabEl) {
      tabEl.classList.add('exited');
      tabEl.classList.remove('waiting', 'attention');
    }
  }

  getActiveTab(): TabState | undefined {
    if (this.activeTabId) {
      return this.tabs.get(this.activeTabId);
    }
    return undefined;
  }

  getAllTabs(): TabState[] {
    return Array.from(this.tabs.values());
  }

  private renderTab(tab: TabState): void {
    const el = document.createElement('div');
    el.className = 'tab';
    el.dataset.tabId = tab.id;

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = tab.label;

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '\u00d7';
    close.title = 'Close';

    el.appendChild(label);
    el.appendChild(close);

    el.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).classList.contains('tab-close')) {
        this.switchTo(tab.id);
      }
    });

    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tab.id);
    });

    this.tabBar.appendChild(el);
  }

  private hideEmptyState(): void {
    const empty = document.getElementById('empty-state');
    if (empty) empty.remove();
  }

  private showEmptyState(): void {
    const container = document.getElementById('terminal-container')!;
    if (!document.getElementById('empty-state')) {
      container.innerHTML = `
        <div id="empty-state">
          <h2>CodeHerd</h2>
          <p>Click + or press Ctrl+T to open a new Claude Code session</p>
          <button id="open-first-tab">Open a Folder</button>
        </div>
      `;
      document.getElementById('open-first-tab')?.addEventListener('click', () => {
        this.openNewTab();
      });
    }
  }

  async openNewTab(): Promise<void> {
    const folder = await window.codeherd.pickFolder();
    if (folder) {
      await this.createTab(folder);
    }
  }
}
