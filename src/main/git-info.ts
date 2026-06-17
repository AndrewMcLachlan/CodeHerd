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

  // Run every probe concurrently rather than sequentially. Spawning `git` is the
  // expensive part (especially on Windows), so firing them in parallel turns ~5
  // serial process launches into one batch — the difference between the status bar
  // updating instantly and lagging for seconds on every tab switch.
  const [gitDirR, commonDirR, statusR, topLevelR] = await Promise.allSettled([
    exec('git', ['rev-parse', '--git-dir'], folder),
    exec('git', ['rev-parse', '--git-common-dir'], folder),
    exec('git', ['status', '--branch', '--porcelain=v2'], folder),
    exec('git', ['rev-parse', '--show-toplevel'], folder),
  ]);

  // If `rev-parse --git-dir` failed, it isn't a git repo.
  if (gitDirR.status !== 'fulfilled') {
    return empty;
  }

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
  if (commonDirR.status === 'fulfilled' && topLevelR.status === 'fulfilled') {
    const normCommon = commonDirR.value.replace(/\\/g, '/').replace(/\/+$/, '');
    const normGit = gitDirR.value.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normGit !== normCommon) {
      const parts = topLevelR.value.replace(/\\/g, '/').split('/');
      info.worktree = parts[parts.length - 1];
    }
  }

  return info;
}
