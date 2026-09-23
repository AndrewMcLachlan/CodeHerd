import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real node-pty addon is built for Electron's ABI; child_process is mocked so
// shell probing never leaves the test process.
const fakes = vi.hoisted(() => {
  class FakePty {
    pid = 4242;
    resizes: Array<{ cols: number; rows: number }> = [];
    onData(): void {}
    onExit(): void {}
    write(): void {}
    resize(cols: number, rows: number): void {
      this.resizes.push({ cols, rows });
    }
  }
  const spawned: FakePty[] = [];
  return { FakePty, spawned };
});

vi.mock('node-pty', () => ({
  spawn: vi.fn((_file: string, _args: string[], options: { cols: number; rows: number }) => {
    const p = new fakes.FakePty();
    p.resizes.length = 0;
    void options;
    fakes.spawned.push(p);
    return p;
  }),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => {
    throw new Error('blocked in tests');
  }),
  execFileSync: vi.fn(() => '7'),
}));

const { PtyManager } = await import('./pty-manager');

let manager: InstanceType<typeof PtyManager>;

const spawnTab = (tabId: string, cols?: number, rows?: number) => {
  manager.spawn(tabId, 'claude', 'K:\\Dev\\Apps\\Sample', { cols, rows });
  return fakes.spawned[fakes.spawned.length - 1];
};

beforeEach(() => {
  fakes.spawned.length = 0;
  manager = new PtyManager();
});

describe('PtyManager.resize', () => {
  it('forwards a genuine size change', () => {
    const pty = spawnTab('tab-1', 100, 30);
    manager.resize('tab-1', 120, 40);
    expect(pty.resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it('drops a resize that repeats the current size', () => {
    const pty = spawnTab('tab-1', 100, 30);
    manager.resize('tab-1', 120, 40);
    manager.resize('tab-1', 120, 40);
    manager.resize('tab-1', 120, 40);
    expect(pty.resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it('drops a resize that repeats the spawn size', () => {
    const pty = spawnTab('tab-1', 100, 30);
    manager.resize('tab-1', 100, 30);
    expect(pty.resizes).toEqual([]);
  });

  it('drops a resize that repeats the default spawn size', () => {
    const pty = spawnTab('tab-1');
    manager.resize('tab-1', 80, 24);
    expect(pty.resizes).toEqual([]);
  });

  it('forwards a change on each axis independently', () => {
    const pty = spawnTab('tab-1', 100, 30);
    manager.resize('tab-1', 100, 31);
    manager.resize('tab-1', 101, 31);
    expect(pty.resizes).toEqual([
      { cols: 100, rows: 31 },
      { cols: 101, rows: 31 },
    ]);
  });

  it('keeps the tracked size per tab', () => {
    const first = spawnTab('tab-1', 100, 30);
    const second = spawnTab('tab-2', 100, 30);
    manager.resize('tab-1', 120, 40);
    manager.resize('tab-2', 120, 40);
    manager.resize('tab-1', 120, 40);
    expect(first.resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(second.resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it('does not record the size when the pty rejects the resize', () => {
    const pty = spawnTab('tab-1', 100, 30);
    const failOnce = vi.spyOn(pty, 'resize').mockImplementationOnce(() => {
      throw new Error('pty exited');
    });
    manager.resize('tab-1', 120, 40);
    failOnce.mockRestore();
    manager.resize('tab-1', 120, 40);
    expect(pty.resizes).toEqual([{ cols: 120, rows: 40 }]);
  });
});
