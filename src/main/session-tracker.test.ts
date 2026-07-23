import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionTracker } from './session-tracker';
import type { AgentRegistry, LiveSession } from './agent-registry';
import type { SessionId } from '../shared/types';

const FOLDER = 'K:\\Dev\\Apps\\Sample';
const ENCODED = FOLDER.replace(/[^a-zA-Z0-9]/g, '-');

let dir: string;
let historyFile: string;
let projectsDir: string;

const registryStub = (live: Map<SessionId, LiveSession> = new Map()) =>
  ({ snapshot: async () => live }) as unknown as AgentRegistry;

const tracker = (registry: AgentRegistry = registryStub()) =>
  new SessionTracker(registry, historyFile, projectsDir);

/** Append a Claude history.jsonl entry. */
const history = (sessionId: string, display: string, timestamp: number, project = FOLDER) => {
  fs.appendFileSync(historyFile, JSON.stringify({ project, sessionId, display, timestamp }) + '\n');
};

/** Write a transcript; a resumable one needs at least one user message. */
const transcript = (sessionId: string, { resumable = true, project = FOLDER } = {}) => {
  const encoded = project.replace(/[^a-zA-Z0-9]/g, '-');
  const transcriptDir = path.join(projectsDir, encoded);
  fs.mkdirSync(transcriptDir, { recursive: true });
  const lines = [JSON.stringify({ type: 'agent-name', agentName: 'Bob', sessionId })];
  if (resumable) lines.push(JSON.stringify({ type: 'user', message: { content: 'hi' }, sessionId }));
  fs.writeFileSync(path.join(transcriptDir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeherd-sessions-'));
  historyFile = path.join(dir, 'history.jsonl');
  projectsDir = path.join(dir, 'projects');
  fs.mkdirSync(projectsDir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('getSessionsForFolder (claude)', () => {
  it('returns an empty list when no history file exists', async () => {
    fs.rmSync(historyFile, { force: true });
    expect(await tracker().getSessionsForFolder(FOLDER, 'claude')).toEqual([]);
  });

  it('lists sessions for the folder, most recent first', async () => {
    history('s-old', 'first task', 1000);
    history('s-new', 'second task', 2000);
    transcript('s-old');
    transcript('s-new');

    const sessions = await tracker().getSessionsForFolder(FOLDER, 'claude');
    expect(sessions.map((s) => s.sessionId)).toEqual(['s-new', 's-old']);
    expect(sessions[0]).toMatchObject({ agent: 'claude', lastPrompt: 'second task', project: FOLDER });
  });

  it('matches folders across slash direction and case', async () => {
    history('s-1', 'task', 1000);
    transcript('s-1');
    const sessions = await tracker().getSessionsForFolder('k:/dev/apps/sample', 'claude');
    expect(sessions).toHaveLength(1);
  });

  it('excludes sessions from other folders', async () => {
    history('s-elsewhere', 'task', 1000, 'K:\\Dev\\Apps\\Other');
    transcript('s-elsewhere', { project: 'K:\\Dev\\Apps\\Other' });
    expect(await tracker().getSessionsForFolder(FOLDER, 'claude')).toEqual([]);
  });

  it('prefers the last real prompt over trailing slash commands (#70)', async () => {
    history('s-1', 'do the thing', 1000);
    history('s-1', '/compact', 2000);
    history('s-1', '/exit', 3000);
    transcript('s-1');

    const [session] = await tracker().getSessionsForFolder(FOLDER, 'claude');
    expect(session.lastPrompt).toBe('do the thing');
    expect(session.timestamp).toBe(3000);
  });

  it('falls back to a slash command label when no real prompt exists', async () => {
    history('s-1', '/resume', 1000);
    transcript('s-1');
    const [session] = await tracker().getSessionsForFolder(FOLDER, 'claude');
    expect(session.lastPrompt).toBe('/resume');
  });

  it('drops sessions whose transcript is gone (#70)', async () => {
    history('s-cleaned', 'task', 1000);
    expect(await tracker().getSessionsForFolder(FOLDER, 'claude')).toEqual([]);
  });

  it('drops sessions whose transcript holds no conversation (#70)', async () => {
    history('s-metadata-only', 'task', 1000);
    transcript('s-metadata-only', { resumable: false });
    expect(await tracker().getSessionsForFolder(FOLDER, 'claude')).toEqual([]);
  });

  it('skips malformed history lines without losing surrounding sessions', async () => {
    history('s-1', 'task', 1000);
    fs.appendFileSync(historyFile, 'not json\n');
    history('s-2', 'other task', 2000);
    transcript('s-1');
    transcript('s-2');
    expect(await tracker().getSessionsForFolder(FOLDER, 'claude')).toHaveLength(2);
  });

  it('tags sessions that belong to live background agents', async () => {
    history('s-bg', 'background task', 1000);
    history('s-fg', 'foreground task', 2000);
    transcript('s-bg');
    transcript('s-fg');
    const live = new Map<SessionId, LiveSession>([
      ['s-bg', { sessionId: 's-bg', agentId: 'agent-7', kind: 'background', pid: 123, cwd: FOLDER }],
      ['s-fg', { sessionId: 's-fg', kind: 'interactive', pid: 456, cwd: FOLDER }],
    ]);

    const sessions = await tracker(registryStub(live)).getSessionsForFolder(FOLDER, 'claude');
    expect(sessions.find((s) => s.sessionId === 's-bg')?.agentId).toBe('agent-7');
    expect(sessions.find((s) => s.sessionId === 's-fg')?.agentId).toBeUndefined();
  });
});

describe('canResume', () => {
  it('is true for a transcript with a user message', async () => {
    transcript('s-1');
    expect(await tracker().canResume(FOLDER, 's-1')).toBe(true);
  });

  it('is false when the transcript is missing', async () => {
    expect(await tracker().canResume(FOLDER, 's-none')).toBe(false);
  });

  it('is false for a metadata-only transcript', async () => {
    transcript('s-1', { resumable: false });
    expect(await tracker().canResume(FOLDER, 's-1')).toBe(false);
  });

  it('finds the user message even when it sits deep in a large transcript', async () => {
    // Larger than one 64 KiB read chunk, so the needle must survive chunked scanning.
    const transcriptDir = path.join(projectsDir, ENCODED);
    fs.mkdirSync(transcriptDir, { recursive: true });
    const filler = JSON.stringify({ type: 'assistant', message: { content: 'x'.repeat(1000) } });
    const lines = Array(100).fill(filler);
    lines.push(JSON.stringify({ type: 'user', message: { content: 'hi' } }));
    fs.writeFileSync(path.join(transcriptDir, 's-big.jsonl'), lines.join('\n') + '\n');

    expect(await tracker().canResume(FOLDER, 's-big')).toBe(true);
  });
});
