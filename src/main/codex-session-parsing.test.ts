import { describe, expect, it } from 'vitest';
import {
  detectCodexSessionStatus,
  parseCodexSessionRuntime,
} from './codex-session-tracker';

const line = (obj: unknown) => JSON.stringify(obj);
const event = (type: string, extra: Record<string, unknown> = {}) =>
  line({ type: 'event_msg', payload: { type, ...extra } });

describe('detectCodexSessionStatus', () => {
  it('reports running after task_started', () => {
    expect(detectCodexSessionStatus(event('task_started'))).toBe('running');
  });

  it('reports waiting after task_complete', () => {
    expect(detectCodexSessionStatus(event('task_complete'))).toBe('waiting');
  });

  it('reports waiting after turn_aborted', () => {
    expect(detectCodexSessionStatus(event('turn_aborted'))).toBe('waiting');
  });

  it('uses the most recent lifecycle event', () => {
    const jsonl = [event('task_started'), event('task_complete'), event('task_started')].join('\n');
    expect(detectCodexSessionStatus(jsonl)).toBe('running');
  });

  it('skips non-lifecycle rows between lifecycle events', () => {
    const jsonl = [
      event('task_started'),
      line({ type: 'response_item', payload: { type: 'message' } }),
      event('agent_message', { message: 'hi' }),
    ].join('\n');
    expect(detectCodexSessionStatus(jsonl)).toBe('running');
  });

  it('ignores a concurrently written partial final row', () => {
    const jsonl = event('task_complete') + '\n{"type":"event_msg","payl';
    expect(detectCodexSessionStatus(jsonl)).toBe('waiting');
  });

  it('returns null when no lifecycle event is present', () => {
    expect(detectCodexSessionStatus('')).toBeNull();
    expect(detectCodexSessionStatus(line({ type: 'session_meta', payload: {} }))).toBeNull();
  });
});

describe('parseCodexSessionRuntime', () => {
  it('reads model and effort from turn_context rows', () => {
    const jsonl = line({ type: 'turn_context', payload: { model: 'gpt-5.2-codex', effort: 'high' } });
    expect(parseCodexSessionRuntime(jsonl)).toMatchObject({ model: 'gpt-5.2-codex', effort: 'high' });
  });

  it('reads model and effort from thread_settings_applied events', () => {
    const jsonl = event('thread_settings_applied', {
      thread_settings: { model: 'gpt-5.2-codex', reasoning_effort: 'medium' },
    });
    expect(parseCodexSessionRuntime(jsonl)).toMatchObject({ model: 'gpt-5.2-codex', effort: 'medium' });
  });

  it('tracks status and context window through a turn lifecycle', () => {
    const jsonl = [
      event('task_started', { model_context_window: 272_000 }),
      event('token_count', {
        info: { last_token_usage: { total_tokens: 12_345 }, model_context_window: 272_000 },
      }),
      event('task_complete'),
    ].join('\n');
    expect(parseCodexSessionRuntime(jsonl)).toEqual({
      status: 'waiting',
      contextTokens: 12_345,
      contextLimit: 272_000,
    });
  });

  it('carries forward earlier state when new rows say nothing about it', () => {
    const initial = { status: 'running' as const, model: 'gpt-5.2-codex', contextTokens: 500 };
    const jsonl = event('token_count', { info: { last_token_usage: { total_tokens: 900 } } });
    expect(parseCodexSessionRuntime(jsonl, initial)).toEqual({
      status: 'running',
      model: 'gpt-5.2-codex',
      contextTokens: 900,
    });
  });

  it('ignores zero and non-numeric token counts', () => {
    const jsonl = [
      event('token_count', { info: { last_token_usage: { total_tokens: 0 } } }),
      event('token_count', { info: { last_token_usage: { total_tokens: 'lots' } } }),
    ].join('\n');
    expect(parseCodexSessionRuntime(jsonl)).toEqual({ status: null });
  });

  it('survives malformed rows without losing surrounding data', () => {
    const jsonl = ['not json', event('task_started'), '{"broken'].join('\n');
    expect(parseCodexSessionRuntime(jsonl).status).toBe('running');
  });
});
