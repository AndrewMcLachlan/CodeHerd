import * as fs from 'fs';
import * as path from 'path';
import type { AgentType, FolderOpenRequest } from '../shared/types';

const agents: readonly AgentType[] = ['claude', 'codex'];

/**
 * The folder a command line asks CodeHerd to open (`codeherd <folder> [--agent <claude|codex>]`),
 * resolved against the directory it was run from. Null when no existing folder was given.
 * `skip` drops leading positionals that aren't the user's: an unpackaged run receives the app path first.
 */
export function parseOpenRequest(argv: readonly string[], cwd: string, skip = 0, isDirectory = defaultIsDirectory): FolderOpenRequest | null {
  const positionals: string[] = [];
  let agent: AgentType | undefined;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const agentFlag = /^--agent(?:=(.*))?$/.exec(arg);
    if (agentFlag) {
      const value = (agentFlag[1] ?? argv[++i] ?? '').toLowerCase();
      if ((agents as readonly string[]).includes(value)) agent = value as AgentType;
      continue;
    }
    if (!arg.startsWith('-')) positionals.push(arg);
  }
  const target = positionals.slice(skip)[0];
  if (!target) return null;
  const folder = path.resolve(cwd, target);
  if (!isDirectory(folder)) return null;
  return agent ? { folder, agent } : { folder };
}

function defaultIsDirectory(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}
