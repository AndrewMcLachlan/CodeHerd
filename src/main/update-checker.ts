import type { UpdateInfo } from '../shared/types';

const RELEASES_API_URL = 'https://api.github.com/repos/AndrewMcLachlan/CodeHerd/releases/latest';
const RELEASES_PAGE_URL = 'https://github.com/AndrewMcLachlan/CodeHerd/releases/latest';

// Result of the startup check, kept so the About window can show it later.
let availableUpdate: UpdateInfo | null = null;

export function getAvailableUpdate(): UpdateInfo | null {
  return availableUpdate;
}

/**
 * Compare two dotted-numeric version strings (e.g. '0.9.0' vs '0.10.1').
 * Returns > 0 if a is newer than b, < 0 if older, 0 if equal.
 * Missing or non-numeric segments compare as 0.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(s => parseInt(s, 10));
  const pb = b.split('.').map(s => parseInt(s, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Ask GitHub for the latest release and compare it against the running version.
 * Returns the update info if a newer release exists, null otherwise.
 * Fails silently (returns null) on network errors, rate limits or bad responses.
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(RELEASES_API_URL, {
      headers: { 'User-Agent': 'CodeHerd', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const release = await res.json() as { tag_name?: unknown; html_url?: unknown };
    if (typeof release.tag_name !== 'string' || release.tag_name.length === 0) return null;
    const version = release.tag_name.replace(/^v/i, '');
    if (compareVersions(version, currentVersion) <= 0) return null;
    availableUpdate = {
      version,
      url: typeof release.html_url === 'string' && release.html_url.startsWith('https://')
        ? release.html_url
        : RELEASES_PAGE_URL,
    };
    return availableUpdate;
  } catch {
    // Offline, DNS failure, rate limit, malformed JSON... — never bother the user
    return null;
  }
}
