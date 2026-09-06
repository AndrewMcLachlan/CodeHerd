import type { TabId } from '../shared/types';

/**
 * Which tab to activate once the active one closes.
 *
 * The tab you were on before it, rather than whichever happens to sit last in the
 * strip: closing a tab is usually a return to what you were doing, and with the
 * strip scrolled the last tab may not even be on screen. History can name tabs
 * that have since been closed themselves, so the first one still open wins.
 *
 * Returns null when nothing is left.
 */
export function selectTabAfterClose(
  mruHistory: readonly TabId[],
  openTabIds: readonly TabId[],
): TabId | null {
  const open = new Set(openTabIds);
  const recent = mruHistory.find(id => open.has(id));
  if (recent) return recent;
  return openTabIds.length > 0 ? openTabIds[openTabIds.length - 1] : null;
}
