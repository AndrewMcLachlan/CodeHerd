import type { ClaudeSession } from '../shared/types';

const MIN_WIDTH = 150;
const MAX_WIDTH = 500;

export class Sidebar {
  private element: HTMLElement;
  private sessionList: HTMLElement;
  private resizeHandle: HTMLElement;
  private onResumeSession: ((session: ClaudeSession) => void) | null = null;
  private width: number;
  private collapsed: boolean;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(initialWidth: number, initialCollapsed: boolean) {
    this.element = document.getElementById('sidebar')!;
    this.sessionList = document.getElementById('session-list')!;
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

  setOnResumeSession(callback: (session: ClaudeSession) => void): void {
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
    this.sessionList.innerHTML = '';
  }

  async loadSessionsForFolder(folder: string): Promise<void> {
    const sessions = await window.codeherd.listSessions(folder);
    this.sessionList.innerHTML = '';

    if (sessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = 'No sessions found';
      this.sessionList.appendChild(empty);
      return;
    }

    for (const session of sessions) {
      const el = document.createElement('div');
      el.className = 'session-item';

      const prompt = document.createElement('span');
      prompt.className = 'session-prompt';
      prompt.textContent = this.truncate(session.lastPrompt, 60);
      prompt.title = session.lastPrompt;

      const time = document.createElement('span');
      time.className = 'session-time';
      time.textContent = this.formatTime(session.timestamp);

      el.appendChild(prompt);
      el.appendChild(time);

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
