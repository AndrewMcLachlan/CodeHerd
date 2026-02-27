import { execFile } from 'child_process';
import type { GitInfo, FolderPath } from '../shared/types';

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 5000, windowsHide: true }, (err, stdout) => {
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

  try {
    // Check if it's a git repo and get the toplevel
    await exec('git', ['rev-parse', '--git-dir'], folder);
  } catch {
    return empty;
  }

  const info: GitInfo = { ...empty, isRepo: true };

  try {
    // git status --branch --porcelain=v2 gives us branch + dirty in one call
    const status = await exec('git', ['status', '--branch', '--porcelain=v2'], folder);
    const lines = status.split('\n');

    for (const line of lines) {
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
  } catch {
    // git status failed, we still know it's a repo
  }

  try {
    // Detect if we're in a worktree (not the main working tree)
    const commonDir = await exec('git', ['rev-parse', '--git-common-dir'], folder);
    const gitDir = await exec('git', ['rev-parse', '--git-dir'], folder);
    // If git-dir !== git-common-dir, we're in a linked worktree
    // Normalize paths for comparison
    const normCommon = commonDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const normGit = gitDir.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normGit !== normCommon) {
      // Extract worktree name from the folder basename
      const toplevel = await exec('git', ['rev-parse', '--show-toplevel'], folder);
      const parts = toplevel.replace(/\\/g, '/').split('/');
      info.worktree = parts[parts.length - 1];
    }
  } catch {
    // Not critical
  }

  return info;
}
