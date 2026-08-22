import type { AgentType } from '../shared/types';

/**
 * Why a session list came back empty or short.
 *
 * The compatibility policy in the README is that secondary features degrade
 * gracefully when a CLI changes its formats — but degrading *silently* leaves you
 * unable to tell "I have never used an agent here" from "CodeHerd can no longer
 * read your sessions". These name that difference.
 */
export type SessionProblem = 'store-missing' | 'unreadable' | 'unrecognised-format';

export interface SessionListingFacts {
  /** Whether the CLI's history file or session directory was found at all. */
  storeExists: boolean;
  /** Lines or entries examined. */
  linesRead: number;
  /** Of those, how many were understood. */
  linesParsed: number;
  /** Sessions produced for the requested folder. */
  sessions: number;
  /** The store was found but could not be opened or streamed. */
  readFailed?: boolean;
}

/**
 * A store that is mostly unreadable means the format moved; a handful of bad lines
 * does not. Interrupted writes routinely leave a truncated final line, so a strict
 * "any failure is a problem" rule would cry wolf on healthy installs.
 */
const PARSE_FAILURE_TOLERANCE = 0.1;

/** Diagnose a session listing, or null when nothing is wrong. */
export function diagnoseSessionListing(facts: SessionListingFacts): SessionProblem | null {
  if (facts.readFailed) return 'unreadable';
  if (!facts.storeExists) return 'store-missing';

  // Nothing to judge: an empty store is a legitimate "no sessions yet".
  if (facts.linesRead === 0) return null;

  const failed = facts.linesRead - facts.linesParsed;
  if (failed / facts.linesRead > PARSE_FAILURE_TOLERANCE) return 'unrecognised-format';

  return null;
}

const AGENT_NAMES: Record<AgentType, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

/**
 * Wording shown in the sidebar. Names the agent and, when known, its version:
 * a report saying which CLI version stopped parsing is actionable, "no sessions
 * found" is not.
 */
export function describeSessionProblem(
  problem: SessionProblem,
  agent: AgentType,
  version: string | null,
): string {
  const name = AGENT_NAMES[agent];
  const named = version ? `${name} ${version}` : name;

  switch (problem) {
    case 'store-missing':
      return `No session history found for ${name}. Run it once in a terminal, or check that it is installed where CodeHerd can see it.`;
    case 'unreadable':
      return `CodeHerd could not read ${named}'s session history. Check the file permissions in your home folder.`;
    case 'unrecognised-format':
      return `CodeHerd could not understand ${named}'s session history — the format has probably changed. Sessions still launch and resume; only this list is affected.`;
  }
}
