import type { TabState } from '../shared/types';

/**
 * Canonical form of a folder path for cross-tab comparison: strips a Windows
 * `\\?\` long-path prefix, normalises separators, drops trailing slashes, and
 * lowercases (Windows paths are case-insensitive).
 */
export function normalizeFolder(p: string): string {
  return p
    .replace(/^\\\\\?\\/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/**
 * Decide which Claude tab, if any, should adopt a `sessionId` seen in a
 * `history.jsonl` entry for `project`. history.jsonl records the folder and the
 * current session id per submitted prompt, but not which tab produced it, so this
 * is a best-effort attribution used to follow Claude rolling a tab's session id
 * forward mid-tab (notably after `/clear`).
 *
 * Returns null when the entry must be ignored:
 *  - the sessionId is ALREADY owned by a live tab — then this is that session's own
 *    activity, not a roll-forward. Reassigning it would hijack the id from its real
 *    owner, which is what leaked colour/name between two tabs on the same folder:
 *    a prompt in tab A logs A's id, and if B was the active tab the old code handed
 *    A's id (and thus A's /color and /rename) to B (#109);
 *  - no Claude tab is open on that folder.
 *
 * Otherwise (a genuinely new id, owned by nobody) it returns the tab most likely to
 * have produced it: the active tab, else the most recently active tab on the folder.
 */
export function selectTabForHistoryRollforward(
  tabs: readonly TabState[],
  project: string,
  sessionId: string,
): TabState | null {
  // Already owned → not a roll-forward. Guards against hijacking a sibling tab's
  // session (the root cause of #109). sessionIds are globally unique, so an owner
  // in any folder means this entry is not a new session needing a home.
  if (tabs.some((t) => t.sessionId === sessionId)) return null;

  const target = normalizeFolder(project);
  const candidates = tabs.filter(
    (t) => t.agent === 'claude' && normalizeFolder(t.launchFolder) === target,
  );
  if (candidates.length === 0) return null;

  return (
    candidates.find((t) => t.isActive)
    ?? [...candidates].sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]
    ?? null
  );
}
