import * as fs from 'fs';
import * as path from 'path';
import type { AgentType, FolderOpenRequest } from '../shared/types';

const agents: readonly AgentType[] = ['claude', 'codex'];
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The folder a command line asks CodeHerd to open (`codeherd [folder] [--agent <claude|codex>] [--resume [session-id]]`),
 * resolved against `--cwd` (set by the `codeherd.cmd` launcher) or else the directory it was run from.
 * `--resume` makes the folder optional, as it is for `claude --resume`. Without an id, the folder's usual session picker decides.
 * Null when no existing folder was given.
 * `skip` drops leading positionals that aren't the user's: an unpackaged run receives the app path first.
 */
export function parseOpenRequest(argv: readonly string[], cwd: string, skip = 0, isDirectory = defaultIsDirectory): FolderOpenRequest | null {
  const positionals: string[] = [];
  let agent: AgentType | undefined;
  let base = cwd;
  let resume = false;
  let resumeSessionId: string | undefined;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const cwdFlag = /^--cwd(?:=(.*))?$/.exec(arg);
    if (cwdFlag) {
      base = cwdFlag[1] ?? argv[++i] ?? cwd;
      continue;
    }
    const agentFlag = /^--agent(?:=(.*))?$/.exec(arg);
    if (agentFlag) {
      const value = (agentFlag[1] ?? argv[++i] ?? '').toLowerCase();
      if ((agents as readonly string[]).includes(value)) agent = value as AgentType;
      continue;
    }
    const resumeFlag = /^(?:--resume|-r)(?:=(.*))?$/.exec(arg);
    if (resumeFlag) {
      resume = true;
      const value = resumeFlag[1] ?? (sessionIdPattern.test(argv[i + 1] ?? '') ? argv[++i] : undefined);
      if (value && sessionIdPattern.test(value)) resumeSessionId = value;
      continue;
    }
    if (!arg.startsWith('-')) positionals.push(arg);
  }
  const target = positionals.slice(skip)[0] ?? (resume ? '.' : undefined);
  if (!target) return null;
  const folder = path.resolve(base, target);
  if (!isDirectory(folder)) return null;
  return { folder, ...(agent && { agent }), ...(resumeSessionId && { resumeSessionId }) };
}

/** Whether the command line's first argument after any `skip`ped positionals asks for the version. */
export function isVersionRequest(argv: readonly string[], skip = 0): boolean {
  const first = argv[1 + skip]?.toLowerCase();
  return first === '--version' || first === '-v';
}

function defaultIsDirectory(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}
