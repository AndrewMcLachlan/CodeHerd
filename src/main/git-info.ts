import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { GitInfo, FolderPath } from '../shared/types';

// Optional locks off: a status refresh must never hold index.lock while an agent runs git in the same repo.
const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };

/** Quiet period after the last change before git is consulted, so a burst of edits costs one `git status`. */
const settleMs = 1_000;
/** Ceiling on that wait, so a tree that never goes quiet (a watch-mode build) still refreshes. */
const maxSettleMs = 5_000;
/** Refresh interval when a recursive watch can't be set up and changes must be polled for. */
const fallbackPollMs = 5_000;

const notARepo: GitInfo = { isRepo: false, branch: '', dirty: false, ahead: 0, behind: 0, worktree: null };

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, env: gitEnv, timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

export interface RepoPaths {
  /** Per-worktree git directory: HEAD and index live here. */
  gitDir: string;
  /** Shared git directory: refs, packed-refs and config live here. */
  commonDir: string;
  topLevel: string;
}

export async function findRepo(folder: FolderPath): Promise<RepoPaths | null> {
  let dir = path.resolve(folder);
  for (;;) {
    const dotGit = path.join(dir, '.git');
    const stat = await fs.promises.stat(dotGit).catch(() => null);
    if (stat?.isDirectory()) return { gitDir: dotGit, commonDir: dotGit, topLevel: dir };
    if (stat?.isFile()) {
      const match = /^gitdir:\s*(.+?)\s*$/m.exec(await fs.promises.readFile(dotGit, 'utf8'));
      if (!match) return null;
      const gitDir = path.resolve(dir, match[1]);
      const commonDir = await fs.promises.readFile(path.join(gitDir, 'commondir'), 'utf8').catch(() => null);
      return { gitDir, commonDir: commonDir ? path.resolve(gitDir, commonDir.trim()) : gitDir, topLevel: dir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function parsePackedRefs(text: string): Map<string, string> {
  const refs = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{40,64}) (\S+)$/.exec(line);
    if (match) refs.set(match[2], match[1]);
  }
  return refs;
}

/** The upstream ref `branch` tracks, from the `[branch "<name>"]` section of a git config. */
export function upstreamRef(config: string, branch: string): string | null {
  let inBranch = false;
  let remote: string | undefined;
  let merge: string | undefined;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[\s*([^\s\]"]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line);
    if (header) {
      inBranch = header[1].toLowerCase() === 'branch' && header[2]?.replace(/\\(.)/g, '$1') === branch;
      continue;
    }
    if (!inBranch) continue;
    const entry = /^([A-Za-z][\w-]*)\s*=\s*(.*)$/.exec(line);
    if (!entry) continue;
    const value = entry[2].startsWith('"') ? entry[2].replace(/^"((?:[^"\\]|\\.)*)".*$/, '$1') : entry[2].replace(/\s*[;#].*$/, '');
    const key = entry[1].toLowerCase();
    if (key === 'remote') remote = value;
    else if (key === 'merge') merge = value;
  }
  if (!remote || !merge) return null;
  if (remote === '.') return merge;
  return `refs/remotes/${remote}/${merge.replace(/^refs\/heads\//, '')}`;
}

/** What a change inside the git directory invalidates: `status` for HEAD/index, `refs` for refs and config. */
export function classifyGitDirChange(name: string): 'status' | 'refs' | null {
  const p = name.replace(/\\/g, '/');
  if (p.endsWith('.lock')) return null;
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (base === 'HEAD' || base === 'index') return 'status';
  if (p === 'packed-refs' || p === 'config' || p.startsWith('refs/')) return 'refs';
  return null;
}

async function readText(file: string): Promise<string | null> {
  return fs.promises.readFile(file, 'utf8').catch(() => null);
}

async function resolveRef(repo: RepoPaths, ref: string, packed: Map<string, string>, depth = 0): Promise<string | null> {
  const loose = (await readText(path.join(repo.commonDir, ref)))?.trim();
  if (loose?.startsWith('ref: ') && depth < 5) return resolveRef(repo, loose.slice(5).trim(), packed, depth + 1);
  if (loose && /^[0-9a-f]{40,64}$/.test(loose)) return loose;
  return packed.get(ref) ?? null;
}

/** Everything `git status` would report, by spawning git. Used for ref formats this module doesn't read. */
async function readGitInfoWithGit(folder: FolderPath): Promise<GitInfo> {
  const [revParseR, statusR] = await Promise.allSettled([
    exec('git', ['rev-parse', '--git-dir', '--git-common-dir', '--show-toplevel'], folder),
    exec('git', ['status', '--branch', '--porcelain=v2'], folder),
  ]);
  if (revParseR.status !== 'fulfilled') return notARepo;
  const [gitDir = '', commonDir = '', topLevel = ''] = revParseR.value.split(/\r?\n/);
  const info: GitInfo = { ...notARepo, isRepo: true };
  if (statusR.status === 'fulfilled') {
    for (const line of statusR.value.split('\n')) {
      if (line.startsWith('# branch.head ')) info.branch = line.slice('# branch.head '.length);
      const ab = line.startsWith('# branch.ab ') ? /\+(\d+) -(\d+)/.exec(line) : null;
      if (ab) {
        info.ahead = parseInt(ab[1], 10);
        info.behind = parseInt(ab[2], 10);
      }
      if (/^[12u?]/.test(line)) info.dirty = true;
    }
  }
  if (commonDir && topLevel && path.resolve(folder, gitDir) !== path.resolve(folder, commonDir)) info.worktree = path.basename(topLevel);
  return info;
}

function sameInfo(a: GitInfo, b: GitInfo): boolean {
  return a.isRepo === b.isRepo && a.branch === b.branch && a.dirty === b.dirty && a.ahead === b.ahead && a.behind === b.behind && a.worktree === b.worktree;
}

/**
 * Git state for one folder, read from the files in `.git` and kept current by watching them
 * and the working tree. git itself only runs for the two things the files can't answer
 * cheaply: whether the tree is dirty, and how far apart the branch and its upstream are.
 */
class FolderGit {
  private current: Promise<GitInfo> | null = null;
  private last: GitInfo | null = null;
  private repoKey: string | null = null;
  private watchers: { close(): void }[] = [];
  private statusStale = true;
  private dirty = false;
  private aheadBehindKey = '';
  private aheadBehind = { ahead: 0, behind: 0 };
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private firstChangeAt = 0;
  private closed = false;

  constructor(readonly folder: FolderPath, private onChange: (info: GitInfo) => void) {}

  info(): Promise<GitInfo> {
    return this.current ??= this.refresh().then(info => this.last = info);
  }

  dispose(): void {
    this.closed = true;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.unwatch();
  }

  private refresh(): Promise<GitInfo> {
    const previous = this.current ?? Promise.resolve(notARepo);
    return previous.catch(() => notARepo).then(() => this.compute());
  }

  private changed(kind: 'status' | 'refs'): void {
    if (this.closed) return;
    if (kind === 'status') this.statusStale = true;
    const now = Date.now();
    if (!this.settleTimer) this.firstChangeAt = now;
    else clearTimeout(this.settleTimer);
    const wait = Math.max(0, Math.min(settleMs, this.firstChangeAt + maxSettleMs - now));
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.current = this.refresh();
      void this.current.then(info => {
        if (this.closed || (this.last && sameInfo(this.last, info))) return;
        this.last = info;
        this.onChange(info);
      }, () => {});
    }, wait);
  }

  private async compute(): Promise<GitInfo> {
    const repo = await findRepo(this.folder);
    if (this.closed) return notARepo;
    this.watch(repo);
    if (!repo) return notARepo;
    if (await fs.promises.stat(path.join(repo.commonDir, 'reftable')).then(() => true, () => false)) {
      this.statusStale = false;
      return readGitInfoWithGit(this.folder);
    }

    const info: GitInfo = { ...notARepo, isRepo: true };
    if (path.resolve(repo.gitDir) !== path.resolve(repo.commonDir)) info.worktree = path.basename(repo.topLevel);

    const [head, packedText, config] = await Promise.all([
      readText(path.join(repo.gitDir, 'HEAD')),
      readText(path.join(repo.commonDir, 'packed-refs')),
      readText(path.join(repo.commonDir, 'config')),
    ]);
    const packed = parsePackedRefs(packedText ?? '');
    const headRef = /^ref:\s*(refs\/heads\/\S+)/.exec(head ?? '')?.[1];

    let ahead = 0;
    let behind = 0;
    if (headRef) {
      info.branch = headRef.slice('refs/heads/'.length);
      const upstream = upstreamRef(config ?? '', info.branch);
      const [local, remote] = await Promise.all([resolveRef(repo, headRef, packed), upstream ? resolveRef(repo, upstream, packed) : null]);
      if (local && remote && local !== remote) ({ ahead, behind } = await this.countAheadBehind(local, remote));
    } else {
      info.branch = '(detached)';
    }
    info.ahead = ahead;
    info.behind = behind;

    if (this.statusStale) {
      this.statusStale = false;
      try {
        const status = await exec('git', ['status', '--porcelain=v2'], this.folder);
        this.dirty = status.split('\n').some(line => /^[12u?]/.test(line));
      } catch {
        this.statusStale = true;
      }
    }
    info.dirty = this.dirty;
    return info;
  }

  private async countAheadBehind(local: string, remote: string): Promise<{ ahead: number; behind: number }> {
    const key = `${local}...${remote}`;
    if (key === this.aheadBehindKey) return this.aheadBehind;
    try {
      const [ahead = '0', behind = '0'] = (await exec('git', ['rev-list', '--left-right', '--count', key], this.folder)).split(/\s+/);
      this.aheadBehind = { ahead: parseInt(ahead, 10) || 0, behind: parseInt(behind, 10) || 0 };
      this.aheadBehindKey = key;
    } catch {
      this.aheadBehind = { ahead: 0, behind: 0 };
    }
    return this.aheadBehind;
  }

  private watch(repo: RepoPaths | null): void {
    const key = repo ? `${repo.topLevel}|${repo.gitDir}|${repo.commonDir}` : '';
    if (key === this.repoKey) return;
    this.unwatch();
    this.repoKey = key;

    if (!repo) {
      // Only a `git init` here is noticed; a repo created above this folder waits for the next tab switch.
      this.addWatcher(this.folder, false, name => { if (name === '.git') this.changed('status'); });
      return;
    }

    const innerGitDir = path.join(repo.topLevel, '.git');
    const gitDirInside = path.resolve(repo.commonDir) === path.resolve(innerGitDir);
    this.addWatcher(repo.topLevel, true, name => {
      const p = name.replace(/\\/g, '/');
      if (p === '.git' || p.startsWith('.git/')) {
        const kind = gitDirInside ? classifyGitDirChange(p.slice(5)) : null;
        if (kind) this.changed(kind);
        return;
      }
      this.changed('status');
    });
    if (!gitDirInside) {
      this.addWatcher(repo.commonDir, true, name => {
        const kind = classifyGitDirChange(name);
        if (kind) this.changed(kind);
      });
      const gitDirRel = path.relative(repo.commonDir, repo.gitDir);
      if (gitDirRel.startsWith('..') || path.isAbsolute(gitDirRel)) {
        this.addWatcher(repo.gitDir, false, name => {
          const kind = classifyGitDirChange(name);
          if (kind) this.changed(kind);
        });
      }
    }
  }

  private addWatcher(dir: string, recursive: boolean, onName: (name: string) => void): void {
    const poll = () => {
      const timer = setInterval(() => this.changed('status'), fallbackPollMs);
      timer.unref?.();
      this.watchers.push({ close: () => clearInterval(timer) });
    };
    try {
      const watcher = fs.watch(dir, { recursive, persistent: false }, (_event, name) => onName(name ? name.toString() : ''));
      watcher.on('error', () => {
        watcher.close();
        if (!this.closed) poll();
      });
      this.watchers.push(watcher);
    } catch {
      poll();
    }
  }

  private unwatch(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }
}

/** Git state for the folder on screen, pushed to `onChange` as it changes. Watches one folder at a time. */
export class GitWatcher {
  private active: FolderGit | null = null;

  constructor(private onChange: (folder: FolderPath, info: GitInfo) => void) {}

  get(folder: FolderPath): Promise<GitInfo> {
    if (this.active?.folder !== folder) {
      this.active?.dispose();
      const active = new FolderGit(folder, info => this.onChange(folder, info));
      this.active = active;
    }
    return this.active.info();
  }

  dispose(): void {
    this.active?.dispose();
    this.active = null;
  }
}
