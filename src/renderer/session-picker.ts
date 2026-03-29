import type { ClaudeSession } from '../shared/types';

export interface SessionPickerResult {
  action: 'resume' | 'new' | 'cancel';
  sessionId?: string;
}

export class SessionPicker {
  /**
   * Shows a modal dialog to choose between resuming an existing session or starting a new one.
   * Returns the user's choice. Only call this when sessions.length > 0.
   */
  show(sessions: ClaudeSession[], folderName: string): Promise<SessionPickerResult> {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'session-picker-backdrop';

      const dialog = document.createElement('div');
      dialog.className = 'session-picker';

      const title = document.createElement('h3');
      title.className = 'session-picker-title';
      title.textContent = `Open ${folderName}`;
      dialog.appendChild(title);

      const subtitle = document.createElement('p');
      subtitle.className = 'session-picker-subtitle';
      subtitle.textContent = 'Resume a session or start fresh';
      dialog.appendChild(subtitle);

      const list = document.createElement('div');
      list.className = 'session-picker-list';

      for (const session of sessions) {
        const item = document.createElement('div');
        item.className = 'session-picker-item';

        const prompt = document.createElement('span');
        prompt.className = 'session-picker-prompt';
        prompt.textContent = session.lastPrompt.length > 80
          ? session.lastPrompt.slice(0, 80) + '\u2026'
          : session.lastPrompt;
        prompt.title = session.lastPrompt;

        const time = document.createElement('span');
        time.className = 'session-picker-time';
        time.textContent = this.formatTime(session.timestamp);

        item.appendChild(prompt);
        item.appendChild(time);

        item.addEventListener('click', () => {
          cleanup();
          resolve({ action: 'resume', sessionId: session.sessionId });
        });

        list.appendChild(item);
      }

      dialog.appendChild(list);

      const newBtn = document.createElement('button');
      newBtn.className = 'session-picker-new';
      newBtn.textContent = 'Start New Session';
      newBtn.addEventListener('click', () => {
        cleanup();
        resolve({ action: 'new' });
      });
      dialog.appendChild(newBtn);

      backdrop.appendChild(dialog);

      const cleanup = () => {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
      };

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          cleanup();
          resolve({ action: 'cancel' });
        }
      };

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          cleanup();
          resolve({ action: 'cancel' });
        }
      });

      document.addEventListener('keydown', onKey);
      document.body.appendChild(backdrop);
    });
  }

  private formatTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    const days = Math.floor(diff / 86_400_000);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
  }
}
