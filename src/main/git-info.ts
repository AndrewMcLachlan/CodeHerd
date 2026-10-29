import { execFile } from 'child_process';
import type { GitInfo, FolderPath } from '../shared/types';

// Optional locks off: a status refresh must never hold index.lock while an agent runs git in the same repo.
const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, env: gitEnv, timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

export async function getGitInfo(folder: FolderPath): Promise<GitInfo> {
  const empty: GitInfo = {
    isRepo: false,
    branch: '',
    dirty: false,
    ahead: 0,
    behind: 0,
    worktree: null,
  };

  // Spawning `git` is the expensive part (especially on Windows, and it blocks the main
  // process while each one starts), so this takes two processes, run concurrently.
  const [revParseR, statusR] = await Promise.allSettled([
    exec('git', ['rev-parse', '--git-dir', '--git-common-dir', '--show-toplevel'], folder),
    exec('git', ['status', '--branch', '--porcelain=v2'], folder),
  ]);

  // If `rev-parse` failed, it isn't a git repo.
  if (revParseR.status !== 'fulfilled') {
    return empty;
  }
  const [gitDir = '', commonDir = '', topLevel = ''] = revParseR.value.split(/\r?\n/);

  const info: GitInfo = { ...empty, isRepo: true };

  if (statusR.status === 'fulfilled') {
    // git status --branch --porcelain=v2 gives us branch + dirty in one call
    for (const line of statusR.value.split('\n')) {
      // # branch.head <name>
      if (line.startsWith('# branch.head ')) {
        info.branch = line.slice('# branch.head '.length);
      }
      // # branch.ab +N -M
      if (line.startsWith('# branch.ab ')) {
        const match = line.match(/\+(\d+) -(\d+)/);
        if (match) {
          info.ahead = parseInt(match[1], 10);
          info.behind = parseInt(match[2], 10);
        }
      }
      // Any line starting with 1, 2, u, or ? means dirty
      if (/^[12u?]/.test(line)) {
        info.dirty = true;
      }
    }
  }

  // Detect if we're in a linked worktree (git-dir !== git-common-dir).
  if (commonDir && topLevel) {
    const normCommon = commonDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const normGit = gitDir.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normGit !== normCommon) {
      const parts = topLevel.replace(/\\/g, '/').split('/');
      info.worktree = parts[parts.length - 1];
    }
  }

  return info;
}
