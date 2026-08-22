import { describe, it, expect } from 'vitest';
import { parseAgentVersion } from './agent-version';

describe('parseAgentVersion', () => {
  it('reads the version out of the real CLI banners', () => {
    // Captured from the installed CLIs.
    expect(parseAgentVersion('2.1.233 (Claude Code)')).toBe('2.1.233');
    expect(parseAgentVersion('codex-cli 0.55.0')).toBe('0.55.0');
  });

  it('copes with a bare version and surrounding whitespace', () => {
    expect(parseAgentVersion('  1.0.0\n')).toBe('1.0.0');
    expect(parseAgentVersion('v3.2.1')).toBe('3.2.1');
  });

  it('keeps prerelease and build detail', () => {
    expect(parseAgentVersion('2.0.0-beta.4 (Claude Code)')).toBe('2.0.0-beta.4');
  });

  it('takes only the first line, since --version may print more', () => {
    expect(parseAgentVersion('1.2.3 (Claude Code)\nnode v24.0.0')).toBe('1.2.3');
  });

  it('returns null rather than guessing', () => {
    // An unknown banner must not become a fake version in a bug report.
    expect(parseAgentVersion('command not found')).toBeNull();
    expect(parseAgentVersion('')).toBeNull();
    expect(parseAgentVersion('   ')).toBeNull();
  });
});
