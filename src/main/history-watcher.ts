import * as fs from 'fs';
import { CLAUDE_DIR, CLAUDE_HISTORY_FILE } from '../shared/constants';
import type { FolderPath, SessionId } from '../shared/types';

export interface HistoryEntry {
  project: FolderPath;
  sessionId: SessionId;
  timestamp: number;
}

/**
 * Tails Claude Code's `~/.claude/history.jsonl`, which gets one appended entry per
 * submitted prompt:
 *
 *   {"display":"...","timestamp":...,"project":"K:\\Dev\\Apps\\CodeHerd","sessionId":"..."}
 *
 * CodeHerd captures a tab's sessionId once, at spawn. But Claude rolls the session id
 * forward mid-tab (e.g. `/clear` starts a new conversation under a new id), and there's
 * no other channel to learn about it — so on restart the stale id gets resumed. This
 * watcher surfaces the *current* session id per project folder so a tab can be kept in
 * sync. Only entries appended after start() are reported (we seed past the existing
 * end), so loading the app doesn't replay history.
 */
export class HistoryWatcher {
  private watcher: fs.FSWatcher | null = null;
  private offset = 0;
  private pending: NodeJS.Timeout | null = null;
  // Reads run in turn, after the offset is seeded, so no entry is reported twice or replayed from history.
  private reads: Promise<void> = Promise.resolve();

  constructor(private onEntry: (entry: HistoryEntry) => void | Promise<void>) {}

  start(): void {
    if (this.watcher) return;

    // Seed the offset to the current end of file so we only react to NEW prompts.
    this.reads = fs.promises.stat(CLAUDE_HISTORY_FILE).then(
      stat => { this.offset = stat.size; },
      () => { this.offset = 0; },
    );

    // Watch the .claude dir (rather than the file directly) so we still react if the
    // history file is created or rotated after we start.
    try {
      this.watcher = fs.watch(CLAUDE_DIR, (_event, filename) => {
        if (filename && filename.toString() === 'history.jsonl') this.schedule();
      });
    } catch {
      // Can't watch — we just won't pick up live session-id changes.
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.reads = this.reads.then(() => this.process());
    }, 50);
  }

  /** Read whatever has been appended since the last call and emit each complete entry. */
  private async process(): Promise<void> {
    let size: number;
    try {
      size = (await fs.promises.stat(CLAUDE_HISTORY_FILE)).size;
    } catch {
      return;
    }

    // Truncation / rotation: re-read from the start.
    if (size < this.offset) this.offset = 0;
    if (size === this.offset) return;

    let chunk: string;
    try {
      const handle = await fs.promises.open(CLAUDE_HISTORY_FILE, 'r');
      try {
        const len = size - this.offset;
        const buf = Buffer.alloc(len);
        await handle.read(buf, 0, len, this.offset);
        chunk = buf.toString('utf-8');
      } finally {
        await handle.close();
      }
    } catch {
      return;
    }

    // Only process up to the last newline — anything after may be a partial write.
    const lastNl = chunk.lastIndexOf('\n');
    if (lastNl === -1) return;
    const toScan = chunk.slice(0, lastNl);
    this.offset += lastNl + 1;

    for (const line of toScan.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry && typeof entry.sessionId === 'string' && typeof entry.project === 'string') {
          this.onEntry({
            project: entry.project,
            sessionId: entry.sessionId,
            timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : 0,
          });
        }
      } catch {
        // Skip malformed lines
      }
    }
  }
}
