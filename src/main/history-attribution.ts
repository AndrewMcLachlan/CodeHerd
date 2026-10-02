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
 *  - no Claude tab is open on that folder;
 *  - several tabs share the folder and liveness cannot single one out.
 *
 * `liveSessionIds` supplies the session ids that still have a running Claude process
 * behind them. It is read lazily because it costs a directory scan and only a folder
 * with more than one Claude tab needs it.
 */
export function selectTabForHistoryRollforward(
  tabs: readonly TabState[],
  project: string,
  sessionId: string,
  liveSessionIds?: () => ReadonlySet<string>,
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
  if (candidates.length === 1) return candidates[0];

  // Which of several same-folder tabs rolled forward cannot be guessed from activity:
  // preferring the active tab handed a freshly opened tab its sibling's new session id,
  // and the sibling's /rename and /color followed it there. A tab whose own session
  // still has a live Claude process behind it has not rolled forward, so it is not the
  // owner; adopt only when that leaves exactly one tab it could belong to.
  if (!liveSessionIds) return null;
  const live = liveSessionIds();
  const rolled = candidates.filter((t) => !live.has(t.sessionId));
  return rolled.length === 1 ? rolled[0] : null;
}
