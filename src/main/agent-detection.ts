import * as fs from 'fs';
import * as path from 'path';
import type { AgentAvailability, AgentType } from '../shared/types';
import { getLoginShellEnv } from './claude-cli';

const SUPPORTED_AGENTS: readonly AgentType[] = ['claude', 'codex'];
const DEFAULT_WINDOWS_EXTENSIONS = ['.COM', '.EXE', '.BAT', '.CMD'];

function getEnvValue(env: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

function isExecutable(file: string, platform: NodeJS.Platform): boolean {
  try {
    fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Resolve a CLI command from an environment without executing it. */
export function resolveCommandPath(
  command: string,
  env: Record<string, string> = getLoginShellEnv(),
  platform: NodeJS.Platform = process.platform,
): string | null {
  const pathValue = getEnvValue(env, 'PATH');
  if (!pathValue) return null;

  const extensions = platform === 'win32'
    ? (getEnvValue(env, 'PATHEXT')?.split(path.delimiter).filter(Boolean)
      ?? DEFAULT_WINDOWS_EXTENSIONS)
    : [''];

  for (const rawDirectory of pathValue.split(path.delimiter)) {
    const directory = rawDirectory.trim().replace(/^"|"$/g, '');
    if (!directory) continue;

    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (isExecutable(candidate, platform)) return candidate;
    }
  }

  return null;
}

/** Detect every CLI agent CodeHerd knows how to launch. */
export function detectAvailableAgents(): AgentAvailability {
  const env = getLoginShellEnv();
  return Object.fromEntries(
    SUPPORTED_AGENTS.map(agent => [agent, resolveCommandPath(agent, env) !== null]),
  ) as AgentAvailability;
}
