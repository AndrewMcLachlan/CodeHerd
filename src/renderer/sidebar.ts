import type { AgentSession, AgentType } from '../shared/types';

const MIN_WIDTH = 150;
const MAX_WIDTH = 500;

export class Sidebar {
  private element: HTMLElement;
  private sessionList: HTMLElement;
  private header: HTMLElement;
  private resizeHandle: HTMLElement;
  private onResumeSession: ((session: AgentSession) => void) | null = null;
  private width: number;
  private collapsed: boolean;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loadSequence = 0;

  constructor(initialWidth: number, initialCollapsed: boolean) {
    this.element = document.getElementById('sidebar')!;
    this.sessionList = document.getElementById('session-list')!;
    this.header = document.getElementById('sidebar-header')!;
    this.resizeHandle = document.getElementById('sidebar-resize')!;
    this.width = initialWidth;
    this.collapsed = initialCollapsed;

    // Apply initial state
    this.applyState();

    // Toggle button
    document.getElementById('sidebar-toggle')!.addEventListener('click', () => {
      this.toggle();
    });

    // Drag to resize
    this.initResize();
  }

  setOnResumeSession(callback: (session: AgentSession) => void): void {
    this.onResumeSession = callback;
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    this.applyState();
    this.persistState();
  }

  private applyState(): void {
    if (this.collapsed) {
      this.element.classList.add('collapsed');
      this.element.style.width = '';
    } else {
      this.element.classList.remove('collapsed');
      this.element.style.width = `${this.width}px`;
    }
  }

  private initResize(): void {
    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
      this.width = newWidth;
      this.element.style.width = `${newWidth}px`;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this.persistState();
    };

    this.resizeHandle.addEventListener('mousedown', (e) => {
      if (this.collapsed) return;
      e.preventDefault();
      startX = e.clientX;
      startWidth = this.width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  private persistState(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      window.codeherd.saveSidebarState({ width: this.width, collapsed: this.collapsed });
    }, 500);
  }

  clear(): void {
    this.loadSequence++;
    this.sessionList.innerHTML = '';
  }

  async loadSessionsForFolder(folder: string, agent: AgentType): Promise<void> {
    const sequence = ++this.loadSequence;
    this.header.textContent = agent === 'codex' ? 'Codex Sessions' : 'Claude Sessions';
    const { sessions, problem, problemDetail } = await window.codeherd.listSessions(folder, agent);
    if (sequence !== this.loadSequence) return;
    this.sessionList.innerHTML = '';

    if (sessions.length === 0) {
      const empty = document.createElement('div');
      // An empty list used to say the same thing whether you had never used an agent
      // here or CodeHerd could no longer read your sessions. Say which.
      empty.className = problem ? 'session-empty session-problem' : 'session-empty';
      empty.textContent = problem ? (problemDetail ?? 'Sessions unavailable') : 'No sessions found';
      this.sessionList.appendChild(empty);
      return;
    }

    if (problem) {
      // Some sessions came back, but not all of them: say so above the list rather
      // than letting a partial result pass as the whole picture.
      const warning = document.createElement('div');
      warning.className = 'session-empty session-problem';
      warning.textContent = problemDetail ?? 'Some sessions could not be read';
      this.sessionList.appendChild(warning);
    }

    for (const session of sessions) {
      const el = document.createElement('div');
      el.className = 'session-item';

      const prompt = document.createElement('span');
      prompt.className = 'session-prompt';
      const display = session.name || session.lastPrompt;
      prompt.textContent = this.truncate(display, 60);
      prompt.title = session.name && session.name !== session.lastPrompt
        ? `${session.name}\n${session.lastPrompt}`
        : session.lastPrompt;

      const time = document.createElement('span');
      time.className = 'session-time';
      time.textContent = this.formatTime(session.timestamp);

      el.appendChild(prompt);
      el.appendChild(time);

      // A running background agent opens by attaching rather than resuming — say so, so
      // it's clear why this one behaves differently from the rest of the list.
      if (session.agentId) {
        const badge = document.createElement('span');
        badge.className = 'session-badge';
        badge.textContent = 'background';
        badge.title = 'Running as a background agent — opens by attaching to it';
        time.appendChild(badge);
      }

      el.addEventListener('click', () => {
        if (this.onResumeSession) {
          this.onResumeSession(session);
        }
      });

      this.sessionList.appendChild(el);
    }
  }

  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '\u2026';
  }

  private formatTime(timestamp: number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;

    const dayDiff = Math.floor(diff / 86_400_000);
    if (dayDiff === 1) return 'yesterday';
    if (dayDiff < 7) return `${dayDiff}d ago`;

    return date.toLocaleDateString();
  }
}
