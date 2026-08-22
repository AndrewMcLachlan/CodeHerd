import { describe, it, expect } from 'vitest';
import { diagnoseSessionListing, describeSessionProblem } from './session-diagnosis';

describe('diagnoseSessionListing', () => {
  it('reports nothing when sessions were found', () => {
    expect(diagnoseSessionListing({ storeExists: true, linesRead: 40, linesParsed: 40, sessions: 3 })).toBeNull();
  });

  it('reports nothing for a genuinely empty store', () => {
    // A folder you have simply never used an agent in is not a fault.
    expect(diagnoseSessionListing({ storeExists: true, linesRead: 120, linesParsed: 120, sessions: 0 })).toBeNull();
  });

  it('reports a missing store separately from an empty one', () => {
    // The CLI has not run yet, or it moved where it keeps its history.
    expect(diagnoseSessionListing({ storeExists: false, linesRead: 0, linesParsed: 0, sessions: 0 }))
      .toBe('store-missing');
  });

  it('reports an unreadable store', () => {
    expect(diagnoseSessionListing({ storeExists: true, linesRead: 0, linesParsed: 0, sessions: 0, readFailed: true }))
      .toBe('unreadable');
  });

  it('reports a format change when nothing at all parsed', () => {
    // Lines are there and none of them are anything we recognise: the shape the
    // CLI writes has moved out from under us.
    expect(diagnoseSessionListing({ storeExists: true, linesRead: 500, linesParsed: 0, sessions: 0 }))
      .toBe('unrecognised-format');
  });

  it('reports a format change when most lines fail to parse', () => {
    // A partial break still loses sessions, so it must not pass as success.
    expect(diagnoseSessionListing({ storeExists: true, linesRead: 500, linesParsed: 40, sessions: 2 }))
      .toBe('unrecognised-format');
  });

  it('tolerates a few malformed lines', () => {
    // Interrupted writes leave the odd truncated line; that is normal wear, not a
    // format change, and must not cry wolf.
    expect(diagnoseSessionListing({ storeExists: true, linesRead: 500, linesParsed: 495, sessions: 9 })).toBeNull();
  });
});

describe('describeSessionProblem', () => {
  it('names the agent and its version so a bug report can be acted on', () => {
    const msg = describeSessionProblem('unrecognised-format', 'claude', '2.1.233');
    expect(msg).toContain('Claude Code');
    expect(msg).toContain('2.1.233');
  });

  it('copes with an unknown version', () => {
    const msg = describeSessionProblem('unrecognised-format', 'codex', null);
    expect(msg).toContain('Codex');
    expect(msg).not.toContain('null');
  });

  it('has wording for every problem', () => {
    for (const problem of ['store-missing', 'unreadable', 'unrecognised-format'] as const) {
      expect(describeSessionProblem(problem, 'claude', null).length).toBeGreaterThan(0);
    }
  });
});
