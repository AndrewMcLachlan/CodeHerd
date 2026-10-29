import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionMetadataWatcher } from './session-metadata-watcher';
import type { TabMetadataMessage } from '../shared/types';

const SESSION = 'session-1';
const TAB = 'tab-1';

let dir: string;
let projectsDir: string;
let claudeDir: string;
let transcriptPath: string;
let emitted: TabMetadataMessage[];
let watcher: SessionMetadataWatcher;

const append = (...entries: unknown[]) => {
  fs.appendFileSync(transcriptPath, entries.map((e) => JSON.stringify(e) + '\n').join(''));
};

const assistant = (
  model: string,
  usage?: Record<string, number>,
  extra: Record<string, unknown> = {},
) => ({
  type: 'assistant',
  sessionId: SESSION,
  message: { model, ...(usage ? { usage } : {}) },
  ...extra,
});

/** registerTab re-reads appended bytes, standing in for the fs.watch pipeline. */
const process = () => watcher.registerTab(TAB, SESSION);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeherd-meta-'));
  projectsDir = path.join(dir, 'projects');
  claudeDir = path.join(dir, 'claude');
  const projectDir = path.join(projectsDir, 'K--Dev-Apps-Sample');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  transcriptPath = path.join(projectDir, `${SESSION}.jsonl`);
  fs.writeFileSync(transcriptPath, '');
  emitted = [];
  watcher = new SessionMetadataWatcher((msg) => emitted.push(msg), projectsDir, claudeDir);
});

afterEach(() => {
  watcher.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('slash-command metadata', () => {
  it('tracks name from custom-title and agent-name entries, and colour from agent-color', async () => {
    append(
      { type: 'custom-title', customTitle: 'Bob', sessionId: SESSION },
      { type: 'agent-color', agentColor: 'red', sessionId: SESSION },
    );
    await process();
    expect(watcher.getKnownMetadata(SESSION)).toMatchObject({ name: 'Bob', color: 'red' });

    append({ type: 'agent-name', agentName: 'Alice', sessionId: SESSION });
    await process();
    expect(watcher.getKnownMetadata(SESSION)).toMatchObject({ name: 'Alice', color: 'red' });
  });

  it('ignores entries for other sessions', async () => {
    append({ type: 'agent-name', agentName: 'Intruder', sessionId: 'other-session' });
    await process();
    expect(watcher.getKnownMetadata(SESSION)).toBeNull();
  });
});

describe('assistant-turn metadata', () => {
  it('extracts model, effort, and context fill from usage', async () => {
    append(
      assistant(
        'claude-opus-4-8',
        { input_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 80 },
        { effort: 'high' },
      ),
    );
    await process();
    expect(watcher.getKnownMetadata(SESSION)).toMatchObject({
      model: 'claude-opus-4-8',
      effort: 'high',
      contextTokens: 1000,
      contextLimit: 200_000,
    });
  });

  it('skips synthetic sidechain turns entirely', async () => {
    append(assistant('claude-opus-4-8', { input_tokens: 500 }, { effort: 'high' }));
    await process();
    append(assistant('<synthetic>', { input_tokens: 999_999 }, { effort: 'low' }));
    await process();
    expect(watcher.getKnownMetadata(SESSION)).toMatchObject({
      model: 'claude-opus-4-8',
      effort: 'high',
      contextTokens: 500,
    });
  });

  it('uses the 1M window when settings.json selects a [1m] model', async () => {
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ model: 'opus[1m]' }));
    append(assistant('claude-opus-4-8', { input_tokens: 30_000 }));
    await process();
    expect(watcher.getKnownMetadata(SESSION)).toMatchObject({
      contextTokens: 30_000,
      contextLimit: 1_000_000,
    });
  });

  it('latches the 1M window when a turn exceeds 200k without settings', async () => {
    append(assistant('claude-opus-4-8', { input_tokens: 250_000 }));
    await process();
    expect(watcher.getKnownMetadata(SESSION)).toMatchObject({ contextLimit: 1_000_000 });
  });

  it('keeps the previous fill when a turn reports no usage', async () => {
    append(assistant('claude-opus-4-8', { input_tokens: 700 }));
    await process();
    append(assistant('claude-opus-4-8'));
    await process();
    expect(watcher.getKnownMetadata(SESSION)).toMatchObject({ contextTokens: 700 });
  });
});

describe('emissions', () => {
  it('emits only the fields that changed, keyed by the registered tab', async () => {
    append({ type: 'agent-name', agentName: 'Bob', sessionId: SESSION });
    await process();
    expect(emitted).toEqual([{ tabId: TAB, name: 'Bob' }]);

    append(assistant('claude-opus-4-8', { input_tokens: 100 }, { effort: 'high' }));
    await process();
    expect(emitted[1]).toEqual({
      tabId: TAB,
      model: 'claude-opus-4-8',
      contextTokens: 100,
      contextLimit: 200_000,
      effort: 'high',
    });
  });

  it('does not emit when re-reading yields no change', async () => {
    append({ type: 'agent-name', agentName: 'Bob', sessionId: SESSION });
    await process();
    append({ type: 'agent-name', agentName: 'Bob', sessionId: SESSION });
    await process();
    expect(emitted).toHaveLength(1);
  });

  it('defers a partial trailing line until its newline arrives', async () => {
    append({ type: 'agent-name', agentName: 'Bob', sessionId: SESSION });
    fs.appendFileSync(transcriptPath, '{"type":"agent-name","agentName":"Par');
    await process();
    expect(watcher.getKnownMetadata(SESSION)).toMatchObject({ name: 'Bob' });

    fs.appendFileSync(transcriptPath, 'tial","sessionId":"' + SESSION + '"}\n');
    await process();
    expect(watcher.getKnownMetadata(SESSION)).toMatchObject({ name: 'Partial' });
  });

  it('re-reads from scratch after truncation', async () => {
    append(
      { type: 'agent-name', agentName: 'Bob', sessionId: SESSION },
      { type: 'agent-color', agentColor: 'red', sessionId: SESSION },
    );
    await process();
    // Shorter than the tracked offset, so the watcher must restart from byte 0.
    fs.writeFileSync(transcriptPath, JSON.stringify({ type: 'agent-name', agentName: 'New', sessionId: SESSION }) + '\n');
    await process();
    expect(watcher.getKnownMetadata(SESSION)).toMatchObject({ name: 'New' });
  });
});

describe('getKnownMetadata', () => {
  it('is null before anything has been read', async () => {
    expect(watcher.getKnownMetadata('never-seen')).toBeNull();
  });

  it('is null for an empty transcript', async () => {
    await process();
    expect(watcher.getKnownMetadata(SESSION)).toBeNull();
  });
});
