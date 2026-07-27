import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_DIR, CLAUDE_PROJECTS_DIR } from '../shared/constants';
import type { SessionId, TabId, TabMetadataMessage } from '../shared/types';

interface MetadataState {
  name: string | null;
  color: string | null;
  model: string | null;
  contextTokens: number | null;
  contextLimit: number | null;
  effort: string | null;
}

/** Below this a session is assumed 200k; a turn exceeding it can only be a 1M-context session. */
const STANDARD_CONTEXT_LIMIT = 200_000;
const LARGE_CONTEXT_LIMIT = 1_000_000;

const asNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Watches Claude Code's per-session JSONL transcripts at `~/.claude/projects/<folder>/<sessionId>.jsonl`
 * for entries written by `/rename` and `/color` slash commands, plus the model, token usage, and
 * reasoning effort recorded on each assistant turn:
 *
 *   {"type":"custom-title","customTitle":"Bob","sessionId":"..."}
 *   {"type":"agent-name","agentName":"Bob","sessionId":"..."}
 *   {"type":"agent-color","agentColor":"red","sessionId":"..."}
 *   {"type":"assistant","effort":"high","message":{"model":"claude-opus-4-8","usage":{...}},"sessionId":"..."}
 *
 * Correlates by sessionId, only re-reads bytes appended since the last event, and emits a
 * TabMetadataMessage when the resolved name, color, model, context fill, or effort changes.
 */
export class SessionMetadataWatcher {
  private rootWatcher: fs.FSWatcher | null = null;
  private dirWatchers = new Map<string, fs.FSWatcher>();
  private sessionToTab = new Map<SessionId, TabId>();
  private lastSeen = new Map<SessionId, MetadataState>();
  private offsets = new Map<SessionId, number>();
  private pending = new Map<string, NodeJS.Timeout>();
  private cachedDefaultLimit: number | null = null;
  private cachedDefaultLimitAt = 0;

  /**
   * Path parameters exist for tests; production callers use the defaults.
   * `onFullRead` reports whole-file re-reads (bytes, milliseconds) for diagnostics.
   */
  constructor(
    private onChange: (msg: TabMetadataMessage) => void,
    private projectsDir: string = CLAUDE_PROJECTS_DIR,
    private claudeDir: string = CLAUDE_DIR,
    private onFullRead?: (bytes: number, ms: number) => void,
  ) {}

  /**
   * The context window to measure fill against for a session on the user's default model. The
   * transcript records only the model *family* (e.g. "claude-opus-4-8"), not whether the
   * 1M-context variant is active — but `~/.claude/settings.json` `model` does (e.g. "opus[1m]").
   * Read it (cached briefly) so a 1M user sees fill against 1M from the first turn, instead of
   * the 200k default until a turn happens to exceed 200k. Re-read cheaply to pick up /model changes.
   */
  private defaultContextLimit(): number {
    const now = Date.now();
    if (this.cachedDefaultLimit !== null && now - this.cachedDefaultLimitAt < 10_000) {
      return this.cachedDefaultLimit;
    }
    let limit = STANDARD_CONTEXT_LIMIT;
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(this.claudeDir, 'settings.json'), 'utf-8'));
      if (typeof settings?.model === 'string' && settings.model.includes('[1m]')) {
        limit = LARGE_CONTEXT_LIMIT;
      }
    } catch {
      // no settings / unreadable — fall back to the standard window
    }
    this.cachedDefaultLimit = limit;
    this.cachedDefaultLimitAt = now;
    return limit;
  }

  start(): void {
    if (this.rootWatcher) return;
    try {
      fs.mkdirSync(this.projectsDir, { recursive: true });
    } catch {
      // best-effort
    }

    // Watch every existing project subdirectory now, and the projects dir itself so we pick up
    // newly-created project folders.
    try {
      for (const entry of fs.readdirSync(this.projectsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          this.watchProjectDir(path.join(this.projectsDir, entry.name));
        }
      }
    } catch {
      // dir doesn't exist yet
    }

    try {
      this.rootWatcher = fs.watch(this.projectsDir, (_event, filename) => {
        if (!filename) return;
        const dir = path.join(this.projectsDir, filename.toString());
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
    if (!seen || (seen.name === null && seen.color === null && seen.model === null
        && seen.contextTokens === null && seen.effort === null)) return null;
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
      for (const entry of fs.readdirSync(this.projectsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(this.projectsDir, entry.name, `${sessionId}.jsonl`);
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

    // A full re-read (start === 0) parses the whole transcript synchronously on the
    // main thread, so a large file stalls every tab in this window. Time it: a long
    // stall logged here, with little PTY output around it, means a blocking read
    // rather than output saturation.
    const readStartedAt = start === 0 ? Date.now() : 0;

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

    const prev = this.lastSeen.get(sessionId)
      ?? { name: null, color: null, model: null, contextTokens: null, contextLimit: null, effort: null };
    let name = prev.name;
    let color = prev.color;
    let model = prev.model;
    let contextTokens = prev.contextTokens;
    let contextLimit = prev.contextLimit;
    let effort = prev.effort;

    for (const line of toScan.split('\n')) {
      if (!line.trim()) continue;
      let entry: {
        type?: string;
        sessionId?: string;
        customTitle?: unknown;
        agentName?: unknown;
        agentColor?: unknown;
        effort?: unknown;
        message?: { model?: unknown; usage?: Record<string, unknown> };
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
          // Sidechain/injected turns are logged with a "<synthetic>" model — skip the whole
          // entry so model, context, and effort keep reflecting the real conversation.
          const m = entry.message?.model;
          if (typeof m !== 'string' || !m || m === '<synthetic>') break;
          model = m;
          if (typeof entry.effort === 'string' && entry.effort) effort = entry.effort;
          const usage = entry.message?.usage;
          if (usage) {
            // The prompt sent for this turn — the whole context window — is input plus both
            // cache tiers. This is the current fill and self-corrects after an auto-compact.
            const total = asNumber(usage.input_tokens)
              + asNumber(usage.cache_read_input_tokens)
              + asNumber(usage.cache_creation_input_tokens);
            if (total > 0) {
              contextTokens = total;
              // Measure against the user's configured window (1M for opus[1m]), and latch upward
              // if a turn ever exceeds it — the denominator never understates the real window.
              const observed = total > STANDARD_CONTEXT_LIMIT ? LARGE_CONTEXT_LIMIT : STANDARD_CONTEXT_LIMIT;
              contextLimit = Math.max(contextLimit ?? 0, this.defaultContextLimit(), observed);
            }
          }
          break;
        }
      }
    }

    if (readStartedAt) {
      this.onFullRead?.(size, Date.now() - readStartedAt);
    }

    this.lastSeen.set(sessionId, { name, color, model, contextTokens, contextLimit, effort });

    const tabId = this.sessionToTab.get(sessionId);
    if (!tabId) return;
    if (name === prev.name && color === prev.color && model === prev.model
        && contextTokens === prev.contextTokens && contextLimit === prev.contextLimit
        && effort === prev.effort) return;

    const msg: TabMetadataMessage = { tabId };
    if (name !== prev.name) msg.name = name;
    if (color !== prev.color) msg.color = color;
    if (model !== prev.model && model !== null) msg.model = model;
    if (contextTokens !== prev.contextTokens && contextTokens !== null) msg.contextTokens = contextTokens;
    if (contextLimit !== prev.contextLimit && contextLimit !== null) msg.contextLimit = contextLimit;
    if (effort !== prev.effort && effort !== null) msg.effort = effort;
    this.onChange(msg);
  }
}
