import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GitInfo } from '../shared/types';
import { classifyGitDirChange, findRepo, GitWatcher, parsePackedRefs, upstreamRef } from './git-info';

let dir: string;

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8' }).trim();

const commit = (cwd: string, file: string): void => {
  fs.writeFileSync(path.join(cwd, file), file);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', file);
};

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codeherd-git-')));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('parsePackedRefs', () => {
  it('maps refs to their hashes, skipping comments and peeled tags', () => {
    const sha = 'a'.repeat(40);
    const refs = parsePackedRefs(`# pack-refs with: peeled fully-peeled sorted\n${sha} refs/heads/main\n^${'b'.repeat(40)}\n`);
    expect([...refs]).toEqual([['refs/heads/main', sha]]);
  });
});

describe('upstreamRef', () => {
  it('maps a tracked branch to its remote-tracking ref', () => {
    const config = '[core]\n\tbare = false\n[branch "feature/x"]\n\tremote = origin\n\tmerge = refs/heads/feature/x\n[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n';
    expect(upstreamRef(config, 'feature/x')).toBe('refs/remotes/origin/feature/x');
  });

  it('uses the merge ref itself for a local upstream', () => {
    expect(upstreamRef('[branch "topic"]\n\tremote = .\n\tmerge = refs/heads/main\n', 'topic')).toBe('refs/heads/main');
  });

  it('returns null for an untracked branch', () => {
    expect(upstreamRef('[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n', 'other')).toBeNull();
  });
});

describe('classifyGitDirChange', () => {
  it('sorts git directory changes by what they invalidate', () => {
    expect(classifyGitDirChange('index')).toBe('status');
    expect(classifyGitDirChange('worktrees\\wt\\HEAD')).toBe('status');
    expect(classifyGitDirChange('refs/remotes/origin/main')).toBe('refs');
    expect(classifyGitDirChange('packed-refs')).toBe('refs');
    expect(classifyGitDirChange('index.lock')).toBeNull();
    expect(classifyGitDirChange('objects/ab/cdef')).toBeNull();
  });
});

describe('findRepo', () => {
  it('finds the repo above a subfolder', async () => {
    git(dir, 'init', '-q');
    fs.mkdirSync(path.join(dir, 'src'));
    expect(await findRepo(path.join(dir, 'src'))).toEqual({ gitDir: path.join(dir, '.git'), commonDir: path.join(dir, '.git'), topLevel: dir });
  });

  it('returns null outside a repo', async () => {
    expect(await findRepo(dir)).toBeNull();
  });
});

describe('GitWatcher', () => {
  let watcher: GitWatcher | null = null;

  afterEach(() => {
    watcher?.dispose();
    watcher = null;
  });

  const setUpClone = (): { origin: string; clone: string } => {
    const origin = path.join(dir, 'origin');
    fs.mkdirSync(origin);
    git(origin, 'init', '-q', '-b', 'main');
    commit(origin, 'a.txt');
    const clone = path.join(dir, 'clone');
    git(dir, 'clone', '-q', origin, clone);
    return { origin, clone };
  };

  it('reads branch, ahead/behind and dirtiness like git status does', async () => {
    const { origin, clone } = setUpClone();
    commit(clone, 'b.txt');
    commit(origin, 'c.txt');
    git(clone, 'fetch', '-q');
    git(clone, 'pack-refs', '--all');
    fs.writeFileSync(path.join(clone, 'untracked.txt'), 'x');

    watcher = new GitWatcher(() => {});
    expect(await watcher.get(clone)).toEqual({ isRepo: true, branch: 'main', dirty: true, ahead: 1, behind: 1, worktree: null });
  });

  it('reports a linked worktree by its folder name', async () => {
    const { clone } = setUpClone();
    const worktree = path.join(dir, 'wt');
    git(clone, 'worktree', 'add', '-q', '-b', 'topic', worktree);

    watcher = new GitWatcher(() => {});
    expect(await watcher.get(worktree)).toMatchObject({ isRepo: true, branch: 'topic', dirty: false, worktree: 'wt' });
  });

  it('reports a folder outside any repo', async () => {
    watcher = new GitWatcher(() => {});
    expect(await watcher.get(dir)).toMatchObject({ isRepo: false });
  });

  it('pushes a change when the working tree is edited', async () => {
    const { clone } = setUpClone();
    const changes: GitInfo[] = [];
    watcher = new GitWatcher((_folder, info) => changes.push(info));
    expect(await watcher.get(clone)).toMatchObject({ dirty: false });

    fs.writeFileSync(path.join(clone, 'a.txt'), 'edited');
    await expect.poll(() => changes.at(-1)?.dirty, { timeout: 8_000 }).toBe(true);
  }, 10_000);
});
