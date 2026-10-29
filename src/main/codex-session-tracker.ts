import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { Worker } from 'worker_threads';
import { isCustomCodexSessionName } from '../shared/agents';
import type { AgentSession, FolderPath, SessionId } from '../shared/types';
import { getLoginShellEnv } from './claude-cli';
import { diagnoseSessionListing } from './session-diagnosis';
import type { SessionListing } from './session-tracker';

interface CodexThreadRow {
  id: string;
  cwd: string;
  title: string | null;
  first_user_message: string | null;
  preview: string | null;
  updated_at_ms: number | null;
  created_at_ms: number | null;
  archived: number;
  rollout_path: string | null;
}

export interface CodexSessionRef {
  sessionId: SessionId;
  project: FolderPath;
  name?: string;
  /** True when the SQLite title differs from Codex's generated first-prompt title. */
  isCustomName?: boolean;
  lastPrompt: string;
  timestamp: number;
  /** Transcript backing this thread, used internally to observe turn lifecycle events. */
  rolloutPath?: string;
}

export type CodexSessionStatus = 'running' | 'waiting';

export interface CodexSessionRuntime {
  status: CodexSessionStatus | null;
  model?: string;
  effort?: string;
  contextTokens?: number;
  contextLimit?: number;
}

interface RuntimeCacheEntry {
  rolloutPath: string;
  offset: number;
  carry: Buffer;
  runtime: CodexSessionRuntime;
}

interface PromptSummary {
  lastMeaningful: string | null;
  lastPrompt: string | null;
  timestamp: number;
}

function normalizeFolder(folder: string): string {
  return folder
    .replace(/^\\\\\?\\/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function getEnvValue(env: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.promises.access(file);
    return true;
  } catch {
    return false;
  }
}

// Must stay inline: a worker script file can't be loaded from inside app.asar.
const threadQueryWorkerSource = `
const { parentPort } = require('worker_threads');
const { DatabaseSync } = require('node:sqlite');
let database = null;
let databasePath = null;
const close = () => {
  try { database?.close(); } catch {}
  database = null;
  databasePath = null;
};
parentPort.on('message', ({ id, path }) => {
  try {
    if (databasePath !== path) {
      close();
      database = new DatabaseSync(path, { readOnly: true });
      databasePath = path;
    }
    const rows = database.prepare(
      'SELECT id, cwd, title, first_user_message, preview, updated_at_ms, created_at_ms, archived, rollout_path FROM threads WHERE archived = 0'
    ).all();
    parentPort.postMessage({ id, rows });
  } catch (err) {
    close();
    parentPort.postMessage({ id, error: String(err) });
  }
});
`;

/** Runs Codex's thread query on a worker thread, since node:sqlite only blocks. */
class ThreadQueryWorker {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, { resolve: (rows: CodexThreadRow[]) => void; reject: (err: Error) => void }>();

  query(databasePath: string): Promise<CodexThreadRow[]> {
    const worker = this.worker ??= this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, path: databasePath });
    });
  }

  private start(): Worker {
    const worker = new Worker(threadQueryWorkerSource, { eval: true });
    worker.unref();
    worker.on('message', ({ id, rows, error }: { id: number; rows?: CodexThreadRow[]; error?: string }) => {
      const request = this.pending.get(id);
      this.pending.delete(id);
      if (error !== undefined) request?.reject(new Error(error));
      else request?.resolve(rows ?? []);
    });
    const fail = (err: Error) => {
      if (this.worker === worker) this.worker = null;
      for (const request of this.pending.values()) request.reject(err);
      this.pending.clear();
    };
    worker.on('error', fail);
    worker.on('exit', code => fail(new Error(`thread query worker exited (${code})`)));
    return worker;
  }
}

/** Reads Codex's saved interactive thread inventory without starting another CLI process. */
export class CodexSessionTracker {
  private threadQueries = new ThreadQueryWorker();
  private runtimeCache = new Map<SessionId, RuntimeCacheEntry>();
  private runtimeReads = new Map<SessionId, Promise<CodexSessionRuntime>>();
  private readonly codexHome: string;
  private readonly sqliteHome: string;

  constructor() {
    const env = getLoginShellEnv();
    this.codexHome = getEnvValue(env, 'CODEX_HOME') || path.join(os.homedir(), '.codex');
    this.sqliteHome = getEnvValue(env, 'CODEX_SQLITE_HOME') || this.codexHome;
  }

  /**
   * Sessions for a folder, plus why the list is empty when it is — so a missing or
   * unreadable Codex home is distinguishable from a folder you have never used.
   */
  async getSessionListingForFolder(folder: FolderPath): Promise<SessionListing> {
    const sessions = await this.getSessionsForFolder(folder);
    if (sessions.length > 0) return { sessions, problem: null };

    // Only worth diagnosing when the list came back empty. Both the SQLite database
    // and the transcript directory are optional individually, but neither present
    // means Codex has not run — or keeps its history somewhere new.
    const storeExists = await exists(path.join(this.codexHome, 'sessions'))
      || await exists(this.sqliteHome);
    return {
      sessions,
      problem: diagnoseSessionListing({ storeExists, linesRead: 0, linesParsed: 0, sessions: 0 }),
    };
  }

  async getSessionsForFolder(folder: FolderPath): Promise<AgentSession[]> {
    const refs = (await this.getAllSessionRefs())
      .filter(ref => normalizeFolder(ref.project) === normalizeFolder(folder));
    const prompts = await this.readPromptHistory(new Set(refs.map(ref => ref.sessionId)));

    return refs
      .map((ref): AgentSession => {
        const prompt = prompts.get(ref.sessionId);
        return {
          agent: 'codex',
          sessionId: ref.sessionId,
          project: ref.project,
          lastPrompt: prompt?.lastMeaningful || prompt?.lastPrompt || ref.lastPrompt || '(no prompt)',
          timestamp: Math.max(ref.timestamp, prompt?.timestamp ?? 0),
          ...(ref.name ? { name: ref.name } : {}),
        };
      })
      .filter(session => session.lastPrompt !== '(no prompt)' || !!session.name)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async getAllSessionRefs(): Promise<CodexSessionRef[]> {
    const databaseRows = await this.readDatabaseRows();
    if (databaseRows) return databaseRows;
    return this.readTranscriptRows();
  }

  async getSessionRef(sessionId: SessionId): Promise<CodexSessionRef | undefined> {
    return (await this.getAllSessionRefs()).find(ref => ref.sessionId === sessionId);
  }

  /**
   * Reads the most recent Codex turn lifecycle event without parsing prompt or response text.
   * A bounded tail read keeps the one-second inventory poll inexpensive for long sessions.
   */
  async getSessionStatus(ref: CodexSessionRef): Promise<CodexSessionStatus | null> {
    return (await this.getSessionRuntime(ref)).status;
  }

  /**
   * Incrementally reads structured rollout events for the status bar. The first call
   * seeds from the transcript; subsequent one-second polls parse appended bytes only.
   */
  getSessionRuntime(ref: CodexSessionRef): Promise<CodexSessionRuntime> {
    // Overlapping reads of one rollout would parse the same appended bytes twice.
    const inflight = this.runtimeReads.get(ref.sessionId);
    if (inflight) return inflight;
    const read = this.readSessionRuntime(ref).finally(() => this.runtimeReads.delete(ref.sessionId));
    this.runtimeReads.set(ref.sessionId, read);
    return read;
  }

  private async readSessionRuntime(ref: CodexSessionRef): Promise<CodexSessionRuntime> {
    if (!ref.rolloutPath) return { status: null };

    let handle: fs.promises.FileHandle | null = null;
    try {
      const stat = await fs.promises.stat(ref.rolloutPath);
      let cached = this.runtimeCache.get(ref.sessionId);
      if (!cached || cached.rolloutPath !== ref.rolloutPath || stat.size < cached.offset) {
        cached = {
          rolloutPath: ref.rolloutPath,
          offset: 0,
          carry: Buffer.alloc(0),
          runtime: { status: 'waiting' },
        };
      }

      if (stat.size > cached.offset) {
        const buffer = Buffer.alloc(stat.size - cached.offset);
        handle = await fs.promises.open(ref.rolloutPath, 'r');
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, cached.offset);
        const combined = Buffer.concat([cached.carry, buffer.subarray(0, bytesRead)]);
        const lastNewline = combined.lastIndexOf(10);
        if (lastNewline >= 0) {
          cached.runtime = parseCodexSessionRuntime(
            combined.subarray(0, lastNewline).toString('utf-8'),
            cached.runtime,
          );
          cached.carry = combined.subarray(lastNewline + 1);
        } else {
          cached.carry = combined;
        }
        cached.offset += bytesRead;
      }

      this.runtimeCache.set(ref.sessionId, cached);
      return { ...cached.runtime };
    } catch {
      return this.runtimeCache.get(ref.sessionId)?.runtime ?? { status: null };
    } finally {
      await handle?.close();
    }
  }

  private async readDatabaseRows(): Promise<CodexSessionRef[] | null> {
    const databasePath = await this.findDatabasePath();
    if (!databasePath) return null;

    try {
      const rows = (await this.threadQueries.query(databasePath))
        .filter(row => typeof row.id === 'string' && typeof row.cwd === 'string')
        .map(row => ({
          row,
          rolloutPath: row.rollout_path
            ? (path.isAbsolute(row.rollout_path) ? row.rollout_path : path.join(this.codexHome, row.rollout_path))
            : undefined,
        }));
      const present = await Promise.all(rows.map(({ rolloutPath }) => !rolloutPath || exists(rolloutPath)));

      return rows
        .filter((_, index) => present[index])
        .map(({ row, rolloutPath }) => {
          const name = row.title?.trim();
          return {
            sessionId: row.id,
            project: row.cwd.replace(/^\\\\\?\\/, ''),
            ...(name ? {
              name,
              isCustomName: isCustomCodexSessionName(name, row.first_user_message, row.preview),
            } : {}),
            lastPrompt: row.first_user_message?.trim() || row.preview?.trim() || '',
            timestamp: Number(row.updated_at_ms || row.created_at_ms || 0),
            ...(rolloutPath ? { rolloutPath } : {}),
          };
        });
    } catch {
      return null;
    }
  }

  private async findDatabasePath(): Promise<string | null> {
    try {
      const candidates = (await fs.promises.readdir(this.sqliteHome))
        .map(name => ({ name, match: /^state_(\d+)\.sqlite$/.exec(name) }))
        .filter((item): item is { name: string; match: RegExpExecArray } => !!item.match)
        .sort((a, b) => Number(b.match[1]) - Number(a.match[1]));
      return candidates.length > 0 ? path.join(this.sqliteHome, candidates[0].name) : null;
    } catch {
      return null;
    }
  }

  /** Fallback for older Codex releases without the SQLite thread inventory. */
  private async readTranscriptRows(): Promise<CodexSessionRef[]> {
    const sessionsDir = path.join(this.codexHome, 'sessions');
    const refs: CodexSessionRef[] = [];

    for (const file of await this.walkJsonlFiles(sessionsDir)) {
      const firstLine = await this.readFirstLine(file);
      if (!firstLine) continue;
      try {
        const row = JSON.parse(firstLine);
        if (row?.type !== 'session_meta' || !row.payload) continue;
        const sessionId = row.payload.id || row.payload.session_id;
        if (typeof sessionId !== 'string' || typeof row.payload.cwd !== 'string') continue;
        refs.push({
          sessionId,
          project: row.payload.cwd.replace(/^\\\\\?\\/, ''),
          lastPrompt: '',
          timestamp: Date.parse(row.payload.timestamp) || (await fs.promises.stat(file)).mtimeMs,
          rolloutPath: file,
        });
      } catch {
        // Ignore partially written or incompatible transcripts.
      }
    }

    return refs;
  }

  private async walkJsonlFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const pending = [root];
    while (pending.length > 0) {
      const dir = pending.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) pending.push(fullPath);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(fullPath);
      }
    }
    return files;
  }

  private async readFirstLine(file: string): Promise<string | null> {
    let handle: fs.promises.FileHandle | null = null;
    try {
      handle = await fs.promises.open(file, 'r');
      const chunks: Buffer[] = [];
      let position = 0;
      for (let i = 0; i < 8; i++) {
        const buffer = Buffer.alloc(64 * 1024);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) break;
        const chunk = buffer.subarray(0, bytesRead);
        const newline = chunk.indexOf(10);
        chunks.push(newline >= 0 ? chunk.subarray(0, newline) : chunk);
        if (newline >= 0) break;
        position += bytesRead;
      }
      return chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8') : null;
    } catch {
      return null;
    } finally {
      await handle?.close();
    }
  }

  private async readPromptHistory(sessionIds: Set<SessionId>): Promise<Map<SessionId, PromptSummary>> {
    const summaries = new Map<SessionId, PromptSummary>();
    if (sessionIds.size === 0) return summaries;

    const historyPath = path.join(this.codexHome, 'history.jsonl');
    if (!(await exists(historyPath))) return summaries;

    let stream: fs.ReadStream;
    try {
      stream = fs.createReadStream(historyPath, { encoding: 'utf-8' });
    } catch {
      return summaries;
    }
    stream.on('error', () => {});
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (!sessionIds.has(row.session_id) || typeof row.text !== 'string') continue;
          const text = row.text.trim();
          if (!text) continue;
          const summary = summaries.get(row.session_id) ?? {
            lastMeaningful: null,
            lastPrompt: null,
            timestamp: 0,
          };
          summary.lastPrompt = text;
          if (!text.startsWith('/')) summary.lastMeaningful = text;
          const timestamp = Number(row.ts || 0);
          summary.timestamp = timestamp > 0 && timestamp < 1_000_000_000_000
            ? timestamp * 1000
            : timestamp;
          summaries.set(row.session_id, summary);
        } catch {
          // Skip malformed history rows.
        }
      }
    } catch {
      // Missing or concurrently replaced history is non-fatal.
    }
    return summaries;
  }
}

/** Finds the last lifecycle event in a chunk of Codex JSONL transcript data. */
export function detectCodexSessionStatus(jsonl: string): CodexSessionStatus | null {
  const lines = jsonl.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (row?.type !== 'event_msg') continue;
      switch (row.payload?.type) {
        case 'task_started':
          return 'running';
        case 'task_complete':
        case 'turn_aborted':
          return 'waiting';
      }
    } catch {
      // Ignore a concurrently written final row or an incompatible transcript entry.
    }
  }
  return null;
}

/** Extract status-bar metadata from complete Codex rollout JSONL rows. */
export function parseCodexSessionRuntime(
  jsonl: string,
  initial: CodexSessionRuntime = { status: null },
): CodexSessionRuntime {
  const runtime = { ...initial };
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const payload = row?.payload;

      if (row?.type === 'turn_context') {
        if (typeof payload?.model === 'string' && payload.model) runtime.model = payload.model;
        if (typeof payload?.effort === 'string' && payload.effort) runtime.effort = payload.effort;
        continue;
      }

      if (row?.type !== 'event_msg') continue;
      switch (payload?.type) {
        case 'thread_settings_applied': {
          const settings = payload.thread_settings;
          if (typeof settings?.model === 'string' && settings.model) runtime.model = settings.model;
          if (typeof settings?.reasoning_effort === 'string' && settings.reasoning_effort) {
            runtime.effort = settings.reasoning_effort;
          }
          break;
        }
        case 'task_started':
          runtime.status = 'running';
          if (typeof payload.model_context_window === 'number' && payload.model_context_window > 0) {
            runtime.contextLimit = payload.model_context_window;
          }
          break;
        case 'task_complete':
        case 'turn_aborted':
          runtime.status = 'waiting';
          break;
        case 'token_count': {
          const info = payload.info;
          const used = info?.last_token_usage?.total_tokens;
          const limit = info?.model_context_window;
          if (typeof used === 'number' && Number.isFinite(used) && used > 0) {
            runtime.contextTokens = used;
          }
          if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
            runtime.contextLimit = limit;
          }
          break;
        }
      }
    } catch {
      // Ignore a concurrently written or incompatible row.
    }
  }
  return runtime;
}
