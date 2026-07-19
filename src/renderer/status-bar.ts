import type { GitInfo, TabId } from '../shared/types';

/** Per-tab session indicators the status bar renders (model, context fill, reasoning effort). */
export interface StatusMeta {
  model?: string;
  contextTokens?: number;
  contextLimit?: number;
  effort?: string;
}

export class StatusBar {
  private element: HTMLElement;
  private folderEl: HTMLElement;
  private gitEl: HTMLElement;
  private worktreeEl: HTMLElement;
  private titleEl: HTMLElement;
  private modelEl: HTMLElement;
  private contextEl: HTMLElement;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private currentFolder: string | null = null;
  private currentTabId: TabId | null = null;
  private titles = new Map<TabId, string>();
  /** Latest session indicators per tab, fed by both metadata events and tab seeds. */
  private meta = new Map<TabId, StatusMeta>();
  /** Last-known git info per folder, so switching back to a folder paints instantly. */
  private gitCache = new Map<string, GitInfo>();
  /** Monotonic token: a refresh only paints if it's still the most recent one issued. */
  private refreshSeq = 0;

  constructor() {
    this.element = document.getElementById('status-bar')!;
    this.folderEl = document.getElementById('status-folder')!;
    this.gitEl = document.getElementById('status-git')!;
    this.worktreeEl = document.getElementById('status-worktree')!;
    this.titleEl = document.getElementById('status-title')!;
    this.modelEl = document.getElementById('status-model')!;
    this.contextEl = document.getElementById('status-context')!;
  }

  setTerminalTitle(tabId: TabId, title: string): void {
    this.titles.set(tabId, title);
  }

  /** Record a tab's session indicators and repaint immediately if it's the one on screen. */
  setMeta(tabId: TabId, meta: StatusMeta): void {
    this.meta.set(tabId, meta);
    if (tabId === this.currentTabId) this.applyMeta(meta);
  }

  async update(folder: string | null, activeTabId: TabId | null, meta?: StatusMeta): Promise<void> {
    if (!folder) {
      this.element.classList.add('hidden');
      this.stopPolling();
      return;
    }

    this.element.classList.remove('hidden');
    this.currentTabId = activeTabId;

    // Folder
    this.folderEl.textContent = this.shortenPath(folder);
    this.folderEl.title = folder;

    // Session indicators (right side). A seed passed in from the tab keeps the map current on switches.
    if (activeTabId && meta) this.meta.set(activeTabId, meta);
    this.applyMeta(activeTabId ? this.meta.get(activeTabId) : undefined);

    // Terminal title (right side)
    const title = activeTabId ? this.titles.get(activeTabId) : null;
    if (title) {
      this.titleEl.textContent = title;
      this.titleEl.classList.remove('hidden');
    } else {
      this.titleEl.classList.add('hidden');
    }

    // On a folder change, repaint git immediately from cache (or blank it) so the
    // previous tab's branch never lingers while the fresh lookup is in flight.
    if (folder !== this.currentFolder) {
      this.currentFolder = folder;
      const cached = this.gitCache.get(folder);
      if (cached) this.applyGit(cached);
      else this.clearGit();
      this.startPolling(folder);
    }

    // Git info (async; may resolve after a later switch — guarded by refreshSeq)
    await this.refreshGit(folder);
  }

  private async refreshGit(folder: string): Promise<void> {
    const seq = ++this.refreshSeq;
    try {
      const git = await window.codeherd.getGitInfo(folder);
      this.gitCache.set(folder, git);
      // Drop stale resolutions: a newer refresh (e.g. the user switched tabs again)
      // has superseded this one, so don't let it overwrite the current display.
      if (seq !== this.refreshSeq) return;
      this.applyGit(git);
    } catch {
      if (seq !== this.refreshSeq) return;
      this.clearGit();
    }
  }

  private applyGit(git: GitInfo): void {
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
  }

  private clearGit(): void {
    this.gitEl.classList.add('hidden');
    this.worktreeEl.classList.add('hidden');
  }

  private applyMeta(meta: StatusMeta | undefined): void {
    // Model (+ reasoning effort), e.g. "Opus 4.8 · high"
    if (meta?.model) {
      const effort = meta.effort ? ` · ${meta.effort}` : '';
      this.modelEl.textContent = this.formatModelName(meta.model) + effort;
      this.modelEl.title = meta.effort ? `${meta.model} · ${meta.effort} effort` : meta.model;
      this.modelEl.classList.remove('hidden');
    } else {
      this.modelEl.classList.add('hidden');
    }

    // Context fill, e.g. "ctx 22%" — colour ramps as it approaches the window limit.
    if (meta?.contextTokens && meta.contextLimit) {
      const pct = Math.round((meta.contextTokens / meta.contextLimit) * 100);
      this.contextEl.textContent = `ctx ${pct}%`;
      this.contextEl.title = `Context: ${meta.contextTokens.toLocaleString()} / ${meta.contextLimit.toLocaleString()} tokens`;
      this.contextEl.classList.toggle('status-context-warn', pct >= 75 && pct < 90);
      this.contextEl.classList.toggle('status-context-danger', pct >= 90);
      this.contextEl.classList.remove('hidden');
    } else {
      this.contextEl.classList.add('hidden');
    }
  }

  /**
   * Turn a raw transcript model id into a compact label:
   *   claude-opus-4-8            -> Opus 4.8
   *   claude-haiku-4-5-20251001  -> Haiku 4.5   (trailing release date dropped)
   *   claude-sonnet-5            -> Sonnet 5
   * Derives the label generically so new models need no lookup table.
   */
  private formatModelName(id: string): string {
    const core = id.replace(/^claude-/, '').replace(/-\d{6,}$/, '');
    const [family, ...version] = core.split('-');
    if (!family) return id;
    const name = family.charAt(0).toUpperCase() + family.slice(1);
    return version.length ? `${name} ${version.join('.')}` : name;
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
