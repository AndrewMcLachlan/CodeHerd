import type { TabState } from '../shared/types';

/**
 * Statuses meaning the agent is mid-turn, so quitting would cut it off partway.
 *
 * Deliberately excludes 'waiting' and 'attention': those are agents sitting idle
 * for the user, where closing costs nothing that resuming won't restore. Warning
 * on them would fire on almost every quit and train the dialog to be dismissed
 * unread. 'stopped' is already finished.
 */
const BUSY_STATUSES: ReadonlySet<TabState['status']> = new Set(['running', 'resuming']);

/** Tabs whose agent is actively working. */
export function selectBusyTabs(tabs: readonly TabState[]): TabState[] {
  return tabs.filter((t) => BUSY_STATUSES.has(t.status));
}

/**
 * Wording for the quit confirmation. Returns null when nothing is busy, so the
 * caller can treat "no prompt needed" and "no tabs" identically.
 */
export function buildShutdownPrompt(
  busy: readonly TabState[],
): { message: string; detail: string } | null {
  if (busy.length === 0) return null;

  const message = busy.length === 1
    ? 'An agent is still working.'
    : `${busy.length} agents are still working.`;

  // Name the tabs so the choice is informed — "which one?" is the first question
  // otherwise. Cap the list so a wall of tabs can't push the buttons off-screen.
  const shown = busy.slice(0, 10).map((t) => `• ${t.label}`);
  if (busy.length > shown.length) shown.push(`• …and ${busy.length - shown.length} more`);

  return {
    message,
    detail: `${shown.join('\n')}\n\nQuitting now interrupts them mid-turn. Open sessions are saved and can be resumed when you reopen CodeHerd.`,
  };
}
