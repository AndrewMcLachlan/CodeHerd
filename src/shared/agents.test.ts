import { describe, expect, it } from 'vitest';
import { getNewTabMenuOptions, isCustomCodexSessionName, resolveDefaultAgent } from './agents';

describe('resolveDefaultAgent', () => {
  it('honours the configured default when it is installed', () => {
    expect(resolveDefaultAgent({ claude: true, codex: true }, 'codex')).toBe('codex');
  });

  it('falls back to the first available agent when the default is missing', () => {
    expect(resolveDefaultAgent({ claude: false, codex: true }, 'claude')).toBe('codex');
  });

  it('returns null when nothing is installed', () => {
    expect(resolveDefaultAgent({ claude: false, codex: false }, 'claude')).toBeNull();
  });
});

describe('getNewTabMenuOptions', () => {
  it('offers a generic new tab when no agent is detected', () => {
    expect(getNewTabMenuOptions({ claude: false, codex: false }, 'claude'))
      .toEqual([{ label: 'New Tab', agent: null }]);
  });

  it('keeps a single detected agent generic', () => {
    expect(getNewTabMenuOptions({ claude: false, codex: true }, 'claude'))
      .toEqual([{ label: 'New Tab', agent: 'codex' }]);
  });

  it('lists both agents with the configured default first', () => {
    expect(getNewTabMenuOptions({ claude: true, codex: true }, 'codex')).toEqual([
      { label: 'New Codex Tab', agent: 'codex' },
      { label: 'New Claude Tab', agent: 'claude' },
    ]);
  });
});

describe('isCustomCodexSessionName', () => {
  it('treats a title matching the first user message or preview as generated', () => {
    expect(isCustomCodexSessionName('fix the tests', 'fix the tests', null)).toBe(false);
    expect(isCustomCodexSessionName('fix the tests', null, 'fix the tests')).toBe(false);
    expect(isCustomCodexSessionName(' fix the tests ', 'fix the tests', null)).toBe(false);
  });

  it('treats a differing title as a user rename', () => {
    expect(isCustomCodexSessionName('Bob', 'fix the tests', 'fix the tests')).toBe(true);
    expect(isCustomCodexSessionName('Bob', null, null)).toBe(true);
  });

  it('never treats an empty title as custom', () => {
    expect(isCustomCodexSessionName('', 'x', 'y')).toBe(false);
    expect(isCustomCodexSessionName('   ', 'x', 'y')).toBe(false);
    expect(isCustomCodexSessionName(null, 'x', 'y')).toBe(false);
  });
});
