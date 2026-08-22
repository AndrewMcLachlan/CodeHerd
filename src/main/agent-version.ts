import { execFile } from 'child_process';
import * as path from 'path';
import type { AgentType } from '../shared/types';
import { getLoginShellEnv } from './claude-cli';
import { resolveCommandPath } from './agent-detection';
import { getDiagnostics } from './diagnostics';

/**
 * Pull a version out of a CLI's `--version` output.
 *
 * Returns null rather than guessing: an unrecognised banner turning into a
 * plausible-looking version is worse than no version, because it ends up in a bug
 * report as fact.
 */
export function parseAgentVersion(output: string): string | null {
  const firstLine = output.split('\n')[0] ?? '';
  const match = firstLine.match(/\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
}

/** How long to wait for `--version` before giving up. */
const VERSION_TIMEOUT_MS = 5000;

/** Batch files cannot be executed directly; only these need a shell. */
const NEEDS_SHELL = new Set(['.cmd', '.bat']);

const cache = new Map<AgentType, string | null>();

/**
 * The installed version of an agent CLI, or null if it could not be determined.
 *
 * Deliberately advisory. The README's compatibility policy is that CodeHerd tracks
 * the latest stable CLI and that older versions still launch and resume, so this
 * gates nothing — it exists so that when something does break, the report says
 * which version it broke against.
 */
export async function detectAgentVersion(agent: AgentType): Promise<string | null> {
  const cached = cache.get(agent);
  if (cached !== undefined) return cached;

  const version = await runVersion(agent);
  cache.set(agent, version);
  getDiagnostics()?.log('agent.version', `${agent}=${version ?? 'unknown'}`);
  return version;
}

function runVersion(agent: AgentType): Promise<string | null> {
  // Resolve first, so the CLI is launched by full path rather than through a shell
  // searching PATH. A missing CLI is reported elsewhere; here it is simply unknown.
  const command = resolveCommandPath(agent);
  if (!command) return Promise.resolve(null);

  // Only .cmd/.bat shims — npm-installed CLIs on Windows — need a shell to run at
  // all. Everything else avoids one, along with the argument-escaping caveat that
  // comes with it.
  const shell = NEEDS_SHELL.has(path.extname(command).toLowerCase());

  return new Promise((resolve) => {
    execFile(
      shell ? `"${command}"` : command,
      ['--version'],
      { env: getLoginShellEnv(), timeout: VERSION_TIMEOUT_MS, windowsHide: true, shell },
      (error, stdout) => {
        resolve(error ? null : parseAgentVersion(stdout));
      },
    );
  });
}
