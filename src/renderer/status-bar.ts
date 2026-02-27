import type { GitInfo, TabId } from '../shared/types';

export class StatusBar {
  private element: HTMLElement;
  private folderEl: HTMLElement;
  private gitEl: HTMLElement;
  private worktreeEl: HTMLElement;
  private titleEl: HTMLElement;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private currentFolder: string | null = null;
  private titles = new Map<TabId, string>();

  constructor() {
    this.element = document.getElementById('status-bar')!;
    this.folderEl = document.getElementById('status-folder')!;
    this.gitEl = document.getElementById('status-git')!;
    this.worktreeEl = document.getElementById('status-worktree')!;
    this.titleEl = document.getElementById('status-title')!;
  }

  setTerminalTitle(tabId: TabId, title: string): void {
    this.titles.set(tabId, title);
  }

  async update(folder: string | null, activeTabId: TabId | null): Promise<void> {
    if (!folder) {
      this.element.classList.add('hidden');
      this.stopPolling();
      return;
    }

    this.element.classList.remove('hidden');

    // Folder
    this.folderEl.textContent = this.shortenPath(folder);
    this.folderEl.title = folder;

    // Terminal title (right side)
    const title = activeTabId ? this.titles.get(activeTabId) : null;
    if (title) {
      this.titleEl.textContent = title;
      this.titleEl.classList.remove('hidden');
    } else {
      this.titleEl.classList.add('hidden');
    }

    // Git info
    await this.refreshGit(folder);

    // Start polling if folder changed
    if (folder !== this.currentFolder) {
      this.currentFolder = folder;
      this.startPolling(folder);
    }
  }

  private async refreshGit(folder: string): Promise<void> {
    try {
      const git = await window.codeherd.getGitInfo(folder);
      if (git.isRepo) {
        this.gitEl.classList.remove('hidden');
        this.gitEl.innerHTML = this.renderGit(git);
        this.gitEl.title = this.gitTooltip(git);
      } else {
        this.gitEl.classList.add('hidden');
      }

      if (git.worktree) {
        this.worktreeEl.classList.remove('hidden');
        this.worktreeEl.textContent = `worktree: ${git.worktree}`;
      } else {
        this.worktreeEl.classList.add('hidden');
      }
    } catch {
      this.gitEl.classList.add('hidden');
      this.worktreeEl.classList.add('hidden');
    }
  }

  private renderGit(git: GitInfo): string {
    let html = `<span class="status-git-branch">${this.escapeHtml(git.branch)}</span>`;

    if (git.dirty) {
      html += '<span class="status-git-dirty" title="Uncommitted changes">\u25CF</span>';
    } else {
      html += '<span class="status-git-clean" title="Clean">\u2713</span>';
    }

    if (git.ahead > 0) {
      html += `<span class="status-git-ahead" title="${git.ahead} ahead">\u2191${git.ahead}</span>`;
    }
    if (git.behind > 0) {
      html += `<span class="status-git-behind" title="${git.behind} behind">\u2193${git.behind}</span>`;
    }

    return html;
  }

  private gitTooltip(git: GitInfo): string {
    const parts = [`Branch: ${git.branch}`];
    if (git.dirty) parts.push('Uncommitted changes');
    if (git.ahead > 0) parts.push(`${git.ahead} commit(s) ahead`);
    if (git.behind > 0) parts.push(`${git.behind} commit(s) behind`);
    return parts.join('\n');
  }

  private startPolling(folder: string): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (this.currentFolder === folder) {
        this.refreshGit(folder);
      }
    }, 5000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private shortenPath(p: string): string {
    const home = this.getHome();
    if (home && p.toLowerCase().startsWith(home.toLowerCase())) {
      return '~' + p.slice(home.length);
    }
    return p;
  }

  private getHome(): string {
    // On Windows in Electron, both may be available
    return (typeof process !== 'undefined' && (process.env?.USERPROFILE || process.env?.HOME)) || '';
  }

  private escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  dispose(): void {
    this.stopPolling();
  }
}
