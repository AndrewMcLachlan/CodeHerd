import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_PROJECTS_DIR } from '../shared/constants';
import type { SessionId, TabId, TabMetadataMessage } from '../shared/types';

interface MetadataState {
  name: string | null;
  color: string | null;
  model: string | null;
}

/**
 * Watches Claude Code's per-session JSONL transcripts at `~/.claude/projects/<folder>/<sessionId>.jsonl`
 * for entries written by `/rename` and `/color` slash commands, plus the model recorded on each
 * assistant turn:
 *
 *   {"type":"custom-title","customTitle":"Bob","sessionId":"..."}
 *   {"type":"agent-name","agentName":"Bob","sessionId":"..."}
 *   {"type":"agent-color","agentColor":"red","sessionId":"..."}
 *   {"type":"assistant","message":{"model":"claude-opus-4-8"},"sessionId":"..."}
 *
 * Correlates by sessionId, only re-reads bytes appended since the last event, and emits a
 * TabMetadataMessage when the resolved name, color, or model changes.
 */
export class SessionMetadataWatcher {
  private rootWatcher: fs.FSWatcher | null = null;
  private dirWatchers = new Map<string, fs.FSWatcher>();
  private sessionToTab = new Map<SessionId, TabId>();
  private lastSeen = new Map<SessionId, MetadataState>();
  private offsets = new Map<SessionId, number>();
  private pending = new Map<string, NodeJS.Timeout>();

  constructor(private onChange: (msg: TabMetadataMessage) => void) {}

  start(): void {
    if (this.rootWatcher) return;
    try {
      fs.mkdirSync(CLAUDE_PROJECTS_DIR, { recursive: true });
    } catch {
      // best-effort
    }

    // Watch every existing project subdirectory now, and the projects dir itself so we pick up
    // newly-created project folders.
    try {
      for (const entry of fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          this.watchProjectDir(path.join(CLAUDE_PROJECTS_DIR, entry.name));
        }
      }
    } catch {
      // dir doesn't exist yet
    }

    try {
      this.rootWatcher = fs.watch(CLAUDE_PROJECTS_DIR, (_event, filename) => {
        if (!filename) return;
        const dir = path.join(CLAUDE_PROJECTS_DIR, filename.toString());
        try {
          if (fs.statSync(dir).isDirectory()) this.watchProjectDir(dir);
        } catch {
          // entry no longer exists
        }
      });
    } catch {
      // some filesystems disallow watching the parent; we just won't pick up new project dirs live
    }
  }

  stop(): void {
    this.rootWatcher?.close();
    this.rootWatcher = null;
    for (const w of this.dirWatchers.values()) w.close();
    this.dirWatchers.clear();
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }

  registerTab(tabId: TabId, sessionId: SessionId): void {
    this.sessionToTab.set(sessionId, tabId);
    // Resumed sessions may already have a transcript on disk — do an initial read so
    // getKnownMetadata() can synchronously seed the tab's first render.
    const jsonl = this.findTranscript(sessionId);
    if (jsonl) this.processFile(sessionId, jsonl);
  }

  unregisterTab(sessionId: SessionId): void {
    this.sessionToTab.delete(sessionId);
    // Keep lastSeen and offsets — if the same sessionId is resumed later we still have the state.
  }

  /** Metadata observed so far for this session, or null if nothing has been read yet. */
  getKnownMetadata(sessionId: SessionId): MetadataState | null {
    const seen = this.lastSeen.get(sessionId);
    if (!seen || (seen.name === null && seen.color === null && seen.model === null)) return null;
    return seen;
  }

  private watchProjectDir(dir: string): void {
    if (this.dirWatchers.has(dir)) return;
    try {
      const watcher = fs.watch(dir, (_event, filename) => {
        if (!filename) return;
        const name = filename.toString();
        if (!name.endsWith('.jsonl')) return;
        const sessionId = name.slice(0, -'.jsonl'.length);
        if (!this.sessionToTab.has(sessionId)) return;
        this.scheduleProcess(sessionId, path.join(dir, name));
      });
      this.dirWatchers.set(dir, watcher);
    } catch {
      // ignore — we just won't react to changes in this dir
    }
  }

  private findTranscript(sessionId: SessionId): string | null {
    try {
      for (const entry of fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(CLAUDE_PROJECTS_DIR, entry.name, `${sessionId}.jsonl`);
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private scheduleProcess(sessionId: SessionId, file: string): void {
    const key = `${sessionId}::${file}`;
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing);
    this.pending.set(key, setTimeout(() => {
      this.pending.delete(key);
      this.processFile(sessionId, file);
    }, 50));
  }

  /**
   * Read whatever has been appended since the last call, scan the new lines for slash-command
   * markers, and emit a TabMetadataMessage if name or color actually changed.
   */
  private processFile(sessionId: SessionId, file: string): void {
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }

    let start = this.offsets.get(sessionId) ?? 0;
    // Truncation / rotation: re-read from scratch.
    if (size < start) start = 0;
    if (size === start) return;

    let chunk: string;
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const len = size - start;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, start);
        chunk = buf.toString('utf-8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return;
    }

    // Only process up to the last newline — anything after may be a partial write.
    const lastNl = chunk.lastIndexOf('\n');
    if (lastNl === -1) {
      // No complete new lines yet — wait for the next event.
      return;
    }
    const toScan = chunk.slice(0, lastNl);
    this.offsets.set(sessionId, start + lastNl + 1);

    const prev = this.lastSeen.get(sessionId) ?? { name: null, color: null, model: null };
    let name = prev.name;
    let color = prev.color;
    let model = prev.model;

    for (const line of toScan.split('\n')) {
      if (!line.trim()) continue;
      let entry: {
        type?: string;
        sessionId?: string;
        customTitle?: unknown;
        agentName?: unknown;
        agentColor?: unknown;
        message?: { model?: unknown };
      };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.sessionId && entry.sessionId !== sessionId) continue;
      switch (entry.type) {
        case 'custom-title':
          if (typeof entry.customTitle === 'string') name = entry.customTitle;
          break;
        case 'agent-name':
          if (typeof entry.agentName === 'string') name = entry.agentName;
          break;
        case 'agent-color':
          if (typeof entry.agentColor === 'string') color = entry.agentColor;
          break;
        case 'assistant': {
          // Sidechain/injected turns are logged with a "<synthetic>" model — ignore those
          // so the indicator keeps showing the real model the user is talking to.
          const m = entry.message?.model;
          if (typeof m === 'string' && m && m !== '<synthetic>') model = m;
          break;
        }
      }
    }

    this.lastSeen.set(sessionId, { name, color, model });

    const tabId = this.sessionToTab.get(sessionId);
    if (!tabId) return;
    if (name === prev.name && color === prev.color && model === prev.model) return;

    const msg: TabMetadataMessage = { tabId };
    if (name !== prev.name) msg.name = name;
    if (color !== prev.color) msg.color = color;
    if (model !== prev.model && model !== null) msg.model = model;
    this.onChange(msg);
  }
}
