import type { UpdateInfo } from '../shared/types';

const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/AndrewMcLachlan/CodeHerd/releases/latest';
const RELEASE_LIST_API_URL = 'https://api.github.com/repos/AndrewMcLachlan/CodeHerd/releases?per_page=20';
const RELEASES_PAGE_URL = 'https://github.com/AndrewMcLachlan/CodeHerd/releases/latest';

// Result of the startup check, kept so the About window can show it later.
let availableUpdate: UpdateInfo | null = null;

export function getAvailableUpdate(): UpdateInfo | null {
  return availableUpdate;
}

/** Rank of a prerelease stage word; a full release outranks them all. */
const STAGE_RANK: Record<string, number> = { alpha: 0, beta: 1, rc: 2 };
const RELEASE_RANK = 3;

/**
 * Parse "1.0.0-beta2" into a numeric core plus prerelease rank. CodeHerd uses
 * undotted, numbered prerelease tags (beta1, beta2, rc1 — see docs/INSTALL.md;
 * Squirrel's NuGet versioning strips dots from prerelease identifiers, so the
 * undotted form keeps the version identical everywhere Windows displays it).
 */
function parseVersion(version: string): { core: number[]; rank: number; pre: number } {
  const [core, ...preParts] = version.split('-');
  const coreNums = core.split('.').map(s => parseInt(s, 10));
  if (preParts.length === 0) return { core: coreNums, rank: RELEASE_RANK, pre: 0 };

  const match = /^([a-zA-Z]+)\.?(\d*)$/.exec(preParts.join('-'));
  const stage = match?.[1]?.toLowerCase() ?? '';
  return {
    core: coreNums,
    rank: STAGE_RANK[stage] ?? 0,
    // A bare stage ("beta") sorts before its first numbered form ("beta1").
    pre: match?.[2] ? parseInt(match[2], 10) : 0,
  };
}

/**
 * Compare two version strings, prerelease-aware:
 *   0.11.0 < 1.0.0-alpha1 < 1.0.0-beta1 < 1.0.0-beta2 < 1.0.0-beta10 < 1.0.0-rc1 < 1.0.0
 * Returns > 0 if a is newer than b, < 0 if older, 0 if equal.
 * Missing or non-numeric core segments compare as 0.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < len; i++) {
    const na = Number.isFinite(pa.core[i]) ? pa.core[i] : 0;
    const nb = Number.isFinite(pb.core[i]) ? pb.core[i] : 0;
    if (na !== nb) return na - nb;
  }
  if (pa.rank !== pb.rank) return pa.rank - pb.rank;
  return pa.pre - pb.pre;
}

interface ReleaseJson {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

function toUpdateInfo(release: ReleaseJson): UpdateInfo | null {
  if (typeof release.tag_name !== 'string' || release.tag_name.length === 0) return null;
  return {
    version: release.tag_name.replace(/^v/i, ''),
    url: typeof release.html_url === 'string' && release.html_url.startsWith('https://')
      ? release.html_url
      : RELEASES_PAGE_URL,
  };
}

/**
 * Ask GitHub for a newer release than the running version.
 *
 * Stable builds only look at the latest *stable* release (GitHub's
 * /releases/latest excludes prereleases), so they are never nagged about
 * betas. Prerelease builds scan the recent release list instead, so a beta
 * user hears about both the next beta and the final release — /latest alone
 * would leave them blind until the next stable shipped.
 *
 * Fails silently (returns null) on network errors, rate limits or bad responses.
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    const isPrereleaseBuild = currentVersion.includes('-');
    const res = await fetch(isPrereleaseBuild ? RELEASE_LIST_API_URL : LATEST_RELEASE_API_URL, {
      headers: { 'User-Agent': 'CodeHerd', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const body = await res.json() as ReleaseJson | ReleaseJson[];

    const candidates = (Array.isArray(body) ? body : [body])
      .filter(r => r.draft !== true)
      .map(toUpdateInfo)
      .filter((u): u is UpdateInfo => u !== null)
      .filter(u => compareVersions(u.version, currentVersion) > 0)
      .sort((a, b) => compareVersions(b.version, a.version));

    availableUpdate = candidates[0] ?? null;
    return availableUpdate;
  } catch {
    // Offline, DNS failure, rate limit, malformed JSON... — never bother the user
    return null;
  }
}
