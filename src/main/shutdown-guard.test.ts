import { describe, expect, it } from 'vitest';
import type { TabState } from '../shared/types';
import { buildShutdownPrompt, selectBusyTabs } from './shutdown-guard';

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
  status: 'waiting',
  ...over,
});

describe('selectBusyTabs', () => {
  it('selects agents that are mid-turn', () => {
    const tabs = [
      tab({ id: 'a', status: 'running' }),
      tab({ id: 'b', status: 'resuming' }),
    ];
    expect(selectBusyTabs(tabs).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('ignores idle, finished, and user-blocked tabs', () => {
    // 'attention' and 'waiting' are agents idling for the user — closing costs
    // nothing a resume won't restore, and warning would fire on nearly every quit.
    const tabs = [
      tab({ id: 'a', status: 'waiting' }),
      tab({ id: 'b', status: 'attention' }),
      tab({ id: 'c', status: 'stopped' }),
    ];
    expect(selectBusyTabs(tabs)).toEqual([]);
  });

  it('returns nothing when there are no tabs', () => {
    expect(selectBusyTabs([])).toEqual([]);
  });
});

describe('buildShutdownPrompt', () => {
  it('returns null when nothing is busy, so no dialog is shown', () => {
    expect(buildShutdownPrompt([])).toBeNull();
  });

  it('uses singular wording and names the tab', () => {
    const prompt = buildShutdownPrompt([tab({ status: 'running', label: 'MooBank' })]);
    expect(prompt?.message).toBe('An agent is still working.');
    expect(prompt?.detail).toContain('• MooBank');
    expect(prompt?.detail).toContain('resumed');
  });

  it('counts and lists several busy tabs', () => {
    const prompt = buildShutdownPrompt([
      tab({ status: 'running', label: 'one' }),
      tab({ status: 'resuming', label: 'two' }),
    ]);
    expect(prompt?.message).toBe('2 agents are still working.');
    expect(prompt?.detail).toContain('• one');
    expect(prompt?.detail).toContain('• two');
  });

  it('caps a long list so the dialog buttons stay reachable', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      tab({ id: `t${i}`, status: 'running', label: `tab${i}` }));
    const detail = buildShutdownPrompt(many)!.detail;
    expect(detail).toContain('• tab9');
    expect(detail).not.toContain('• tab10');
    expect(detail).toContain('…and 4 more');
  });
});
