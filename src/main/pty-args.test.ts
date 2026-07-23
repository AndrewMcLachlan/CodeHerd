import { describe, expect, it, vi } from 'vitest';

// pty-manager imports the node-pty native addon, which is rebuilt for Electron's
// ABI and won't load under plain Node — stub it; buildAgentArgs never touches it.
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const { buildAgentArgs } = await import('./pty-manager');

describe('buildAgentArgs', () => {
  it('starts a fresh Claude session with an explicit --session-id', () => {
    expect(buildAgentArgs('claude', 'sid-1', {})).toEqual(['--session-id', 'sid-1']);
  });

  it('resumes a Claude session with --resume', () => {
    expect(buildAgentArgs('claude', 'sid-1', { resumeSessionId: 'sid-1' }))
      .toEqual(['--resume', 'sid-1']);
  });

  it('attaches to a live background agent instead of resuming', () => {
    expect(buildAgentArgs('claude', 'sid-1', { resumeSessionId: 'sid-1', attachAgentId: 'job-7' }))
      .toEqual(['attach', 'job-7']);
  });

  it('starts a fresh Codex session with no arguments', () => {
    expect(buildAgentArgs('codex', 'sid-1', {})).toEqual([]);
  });

  it('resumes a Codex session with the resume subcommand', () => {
    expect(buildAgentArgs('codex', 'sid-1', { resumeSessionId: 'sid-1' }))
      .toEqual(['resume', 'sid-1']);
  });
});
