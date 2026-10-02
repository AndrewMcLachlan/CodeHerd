import { describe, expect, it } from 'vitest';
import type { TabState } from '../shared/types';
import { normalizeFolder, selectTabForHistoryRollforward } from './history-attribution';

const tab = (over: Partial<TabState>): TabState => ({
  id: 'tab',
  agent: 'claude',
  launchFolder: 'C:\\proj',
  currentFolder: 'C:\\proj',
  sessionId: 'sid',
  label: 'proj',
  isActive: false,
  createdAt: 0,
  lastActivityAt: 0,
  status: 'running',
  ...over,
});

describe('selectTabForHistoryRollforward', () => {
  it('ignores an entry whose session a tab already owns (#109 leak)', () => {
    // Two Claude tabs on the same folder. A prompt in A logs A's session id; B is
    // the active tab. The id belongs to A, so nobody must adopt it — otherwise B
    // hijacks A's session and its /color and /rename leak onto B.
    const a = tab({ id: 'A', sessionId: 'sidA', isActive: false });
    const b = tab({ id: 'B', sessionId: 'sidB', isActive: true });
    expect(selectTabForHistoryRollforward([a, b], 'C:\\proj', 'sidA')).toBeNull();
  });

  it('ignores an id already owned by a tab in another folder', () => {
    const a = tab({ id: 'A', sessionId: 'sidA', launchFolder: 'C:\\other' });
    const b = tab({ id: 'B', sessionId: 'sidB', launchFolder: 'C:\\proj', isActive: true });
    expect(selectTabForHistoryRollforward([a, b], 'C:\\proj', 'sidA')).toBeNull();
  });

  it('attributes a genuinely new id to the sole Claude tab on the folder', () => {
    const a = tab({ id: 'A', sessionId: 'sidA' });
    expect(selectTabForHistoryRollforward([a], 'C:\\proj', 'sidNew')?.id).toBe('A');
  });

  it('gives a new id to the tab whose own session is no longer live', () => {
    // A rolled sidA forward, so sidA has no process left; B was freshly opened and is
    // active. Preferring the active tab gave B the id, and A's later /rename renamed B.
    const a = tab({ id: 'A', sessionId: 'sidA', isActive: false, lastActivityAt: 100 });
    const b = tab({ id: 'B', sessionId: 'sidB', isActive: true, lastActivityAt: 999 });
    const live = () => new Set(['sidB', 'sidNew']);
    expect(selectTabForHistoryRollforward([a, b], 'C:\\proj', 'sidNew', live)?.id).toBe('A');
  });

  it('does not hand a new id to a freshly opened active tab that still owns its own', () => {
    const a = tab({ id: 'A', sessionId: 'sidA', isActive: false, lastActivityAt: 100 });
    const b = tab({ id: 'B', sessionId: 'sidB', isActive: true, lastActivityAt: 999 });
    const live = () => new Set(['sidB', 'sidNew']);
    expect(selectTabForHistoryRollforward([a, b], 'C:\\proj', 'sidNew', live)?.id).not.toBe('B');
  });

  it('ignores a new id when every same-folder tab is still on its own session', () => {
    const a = tab({ id: 'A', sessionId: 'sidA', lastActivityAt: 100 });
    const b = tab({ id: 'B', sessionId: 'sidB', isActive: true });
    const live = () => new Set(['sidA', 'sidB']);
    expect(selectTabForHistoryRollforward([a, b], 'C:\\proj', 'sidNew', live)).toBeNull();
  });

  it('ignores a new id when liveness cannot single out one tab', () => {
    const a = tab({ id: 'A', sessionId: 'sidA', lastActivityAt: 100 });
    const b = tab({ id: 'B', sessionId: 'sidB', isActive: true });
    const live = () => new Set<string>();
    expect(selectTabForHistoryRollforward([a, b], 'C:\\proj', 'sidNew', live)).toBeNull();
  });

  it('refuses to guess between same-folder tabs when liveness is unavailable', () => {
    const a = tab({ id: 'A', sessionId: 'sidA', isActive: false, lastActivityAt: 100 });
    const b = tab({ id: 'B', sessionId: 'sidB', isActive: true });
    expect(selectTabForHistoryRollforward([a, b], 'C:\\proj', 'sidNew')).toBeNull();
  });

  it('still adopts for a lone tab without consulting liveness', () => {
    const a = tab({ id: 'A', sessionId: 'sidA' });
    const live = (): ReadonlySet<string> => { throw new Error('should not be consulted'); };
    expect(selectTabForHistoryRollforward([a], 'C:\\proj', 'sidNew', live)?.id).toBe('A');
  });

  it('returns null when no Claude tab is open on the folder', () => {
    const a = tab({ id: 'A', sessionId: 'sidA', launchFolder: 'C:\\elsewhere' });
    expect(selectTabForHistoryRollforward([a], 'C:\\proj', 'sidNew')).toBeNull();
  });

  it('ignores Codex tabs on the folder', () => {
    const a = tab({ id: 'A', sessionId: 'sidA', agent: 'codex', isActive: true });
    expect(selectTabForHistoryRollforward([a], 'C:\\proj', 'sidNew')).toBeNull();
  });

  it('matches folders regardless of separators, casing, and trailing slash', () => {
    const a = tab({ id: 'A', sessionId: 'sidA', launchFolder: 'C:\\Proj\\' });
    expect(selectTabForHistoryRollforward([a], 'c:/proj', 'sidNew')?.id).toBe('A');
  });
});

describe('normalizeFolder', () => {
  it('strips a \\\\?\\ long-path prefix, normalises separators and case, trims trailing slashes', () => {
    expect(normalizeFolder('\\\\?\\C:\\Dev\\App\\')).toBe('c:/dev/app');
    expect(normalizeFolder('C:/Dev/App')).toBe('c:/dev/app');
  });
});
