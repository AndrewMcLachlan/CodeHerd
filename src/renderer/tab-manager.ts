import type { TabId, TabState } from '../shared/types';
import { TerminalManager } from './terminal-manager';
import { SessionPicker } from './session-picker';

export class TabManager {
  private tabs = new Map<TabId, TabState>();
  private activeTabId: TabId | null = null;
  private tabBar: HTMLElement;
  private terminalManager: TerminalManager;
  private onTabSwitch: ((tab: TabState) => void) | null = null;
  private onTabClose: ((tab: TabState) => void) | null = null;
  private onAllTabsClosed: (() => void) | null = null;
  private onTabReorder: (() => void) | null = null;
  private warnBeforeClose = true;
  private dragState: { tabId: TabId; el: HTMLElement; ghost: HTMLElement; startX: number } | null = null;
  private sessionPicker = new SessionPicker();

  constructor(terminalManager: TerminalManager) {
    this.tabBar = document.getElementById('tab-bar')!;
    this.terminalManager = terminalManager;
    this.initDragListeners();
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

  setOnTabReorder(callback: () => void): void {
    this.onTabReorder = callback;
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
      tabEl.classList.toggle('running', status === 'running');
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
      tabEl.classList.remove('running', 'waiting', 'attention');
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

  private initDragListeners(): void {
    const onMouseMove = (e: MouseEvent) => {
      if (!this.dragState) return;
      e.preventDefault();

      this.dragState.ghost.style.left = `${e.clientX}px`;
      this.dragState.ghost.style.top = `${e.clientY}px`;

      this.tabBar.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));
      const target = this.getTabAtX(e.clientX);
      if (target && target.dataset.tabId !== this.dragState.tabId) {
        const rect = target.getBoundingClientRect();
        const isLeft = e.clientX < rect.left + rect.width / 2;
        target.classList.add(isLeft ? 'drag-over-left' : 'drag-over-right');
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!this.dragState) return;
      const { tabId, el, ghost } = this.dragState;

      ghost.remove();
      el.classList.remove('dragging');
      this.tabBar.classList.remove('dragging-active');
      this.tabBar.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));
      document.body.style.cursor = '';

      const target = this.getTabAtX(e.clientX);
      if (target && target.dataset.tabId !== tabId) {
        const draggedEl = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
        if (draggedEl) {
          const rect = target.getBoundingClientRect();
          if (e.clientX < rect.left + rect.width / 2) {
            this.tabBar.insertBefore(draggedEl, target);
          } else {
            this.tabBar.insertBefore(draggedEl, target.nextSibling);
          }
          this.syncTabOrder();
        }
      } else if (!target) {
        const draggedEl = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
        const lastTab = this.tabBar.querySelector('.tab:last-child');
        if (draggedEl && lastTab !== draggedEl) {
          this.tabBar.appendChild(draggedEl);
          this.syncTabOrder();
        }
      }

      this.dragState = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    this.tabBar.addEventListener('mousedown', (e) => {
      const tabEl = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
      if (!tabEl || (e.target as HTMLElement).classList.contains('tab-close')) return;

      const tabId = tabEl.dataset.tabId as TabId;
      const startX = e.clientX;
      const startY = e.clientY;

      const onDragStart = (me: MouseEvent) => {
        if (Math.abs(me.clientX - startX) < 5 && Math.abs(me.clientY - startY) < 5) return;
        document.removeEventListener('mousemove', onDragStart);
        document.removeEventListener('mouseup', cancelDragStart);

        const ghost = tabEl.cloneNode(true) as HTMLElement;
        ghost.classList.add('tab-ghost');
        ghost.style.left = `${me.clientX}px`;
        ghost.style.top = `${me.clientY}px`;
        document.body.appendChild(ghost);

        tabEl.classList.add('dragging');
        this.tabBar.classList.add('dragging-active');
        document.body.style.cursor = 'grabbing';

        this.dragState = { tabId, el: tabEl, ghost, startX };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      };

      const cancelDragStart = () => {
        document.removeEventListener('mousemove', onDragStart);
        document.removeEventListener('mouseup', cancelDragStart);
      };

      document.addEventListener('mousemove', onDragStart);
      document.addEventListener('mouseup', cancelDragStart);
    });
  }

  private getTabAtX(clientX: number): HTMLElement | null {
    const tabs = this.tabBar.querySelectorAll<HTMLElement>('.tab:not(.dragging)');
    for (const tab of tabs) {
      const rect = tab.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return tab;
    }
    return null;
  }

  private syncTabOrder(): void {
    const ordered = new Map<TabId, TabState>();
    this.tabBar.querySelectorAll<HTMLElement>('.tab').forEach(el => {
      const id = el.dataset.tabId as TabId;
      const state = this.tabs.get(id);
      if (state) ordered.set(id, state);
    });
    this.tabs = ordered;
    this.onTabReorder?.();
  }

  private renderTab(tab: TabState): void {
    const el = document.createElement('div');
    el.className = 'tab';
    el.dataset.tabId = tab.id;
    el.title = tab.launchFolder;

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

  addStylingTab(status: TabState['status']): void {
    const tabId = crypto.randomUUID();
    const tab: TabState = {
      id: tabId,
      launchFolder: '/mock',
      currentFolder: '/mock',
      sessionId: 'mock',
      label: status.charAt(0).toUpperCase() + status.substring(1),
      isActive: false,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      status,
    };
    this.tabs.set(tabId, tab);
    this.renderTab(tab);
    this.updateStatus(tabId, status);
    if (status === 'stopped') {
      this.markExited(tabId, 0);
    }
    // Make the first tab active
    if (this.tabs.size === 1) {
      this.switchTo(tabId);
    }
    this.hideEmptyState();
  }

  async openNewTab(): Promise<void> {
    const folder = await window.codeherd.pickFolder();
    if (!folder) return;

    const sessions = await window.codeherd.listSessions(folder);
    if (sessions.length === 0) {
      await this.createTab(folder);
      return;
    }

    const folderName = folder.replace(/\\/g, '/').split('/').pop() || folder;
    const result = await this.sessionPicker.show(sessions, folderName);

    if (result.action === 'resume' && result.sessionId) {
      await this.createTab(folder, result.sessionId);
    } else if (result.action === 'new') {
      await this.createTab(folder);
    }
    // 'cancel' — do nothing
  }
}
