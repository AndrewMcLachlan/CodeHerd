import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real node-pty addon is built for Electron's ABI; child_process is mocked so
// shell probing and taskkill never leave the test process.
const fakes = vi.hoisted(() => {
  class FakePty {
    pid = 4242;
    dead = false;
    written: string[] = [];
    private exitCallbacks: Array<(e: { exitCode: number }) => void> = [];
    onData(): void {}
    onExit(cb: (e: { exitCode: number }) => void): void {
      this.exitCallbacks.push(cb);
    }
    write(data: string): void {
      if (this.dead) throw new Error('EPIPE');
      this.written.push(data);
    }
    resize(): void {}
    exit(): void {
      this.exitCallbacks.forEach((cb) => cb({ exitCode: 0 }));
    }
  }
  const spawned: FakePty[] = [];
  return { FakePty, spawned };
});

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    const p = new fakes.FakePty();
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

const { execSync } = await import('child_process');
const { PtyManager } = await import('./pty-manager');

let manager: InstanceType<typeof PtyManager>;

const spawnTab = (tabId: string, agent: 'claude' | 'codex') => {
  manager.spawn(tabId, agent, 'K:\\Dev\\Apps\\Sample');
  return fakes.spawned[fakes.spawned.length - 1];
};

beforeEach(() => {
  vi.useFakeTimers();
  fakes.spawned.length = 0;
  manager = new PtyManager();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('gracefulKill', () => {
  it('sends Claude a double interrupt and resolves when the process exits', async () => {
    const pty = spawnTab('tab-1', 'claude');
    const kill = manager.gracefulKill('tab-1');

    expect(pty.written).toEqual(['\x03', '\x03']);
    pty.exit();
    await expect(kill).resolves.toBeUndefined();
    expect(manager.getSessionId('tab-1')).toBeUndefined();
  });

  it('interrupts Codex, then sends /quit once the composer has focus', async () => {
    const pty = spawnTab('tab-1', 'codex');
    const kill = manager.gracefulKill('tab-1');

    expect(pty.written).toEqual(['\x03']);
    await vi.advanceTimersByTimeAsync(150);
    expect(pty.written).toEqual(['\x03', '/quit\r']);

    pty.exit();
    await expect(kill).resolves.toBeUndefined();
  });

  it('skips /quit when Codex exits before the interrupt settles', async () => {
    const pty = spawnTab('tab-1', 'codex');
    const kill = manager.gracefulKill('tab-1');

    pty.exit();
    await kill;
    await vi.advanceTimersByTimeAsync(150);
    expect(pty.written).toEqual(['\x03']);
  });

  it('force-kills the process tree when nothing exits within 5 seconds', async () => {
    spawnTab('tab-1', 'claude');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const kill = manager.gracefulKill('tab-1');

    await vi.advanceTimersByTimeAsync(5000);
    await expect(kill).resolves.toBeUndefined();
    if (process.platform === 'win32') {
      expect(vi.mocked(execSync)).toHaveBeenCalledWith(
        expect.stringContaining('taskkill /T /F /PID 4242'),
        expect.anything(),
      );
    } else {
      expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
    }
    killSpy.mockRestore();
  });

  it('resolves immediately when the process is already dead', async () => {
    const pty = spawnTab('tab-1', 'claude');
    pty.dead = true;
    await expect(manager.gracefulKill('tab-1')).resolves.toBeUndefined();
    expect(manager.getSessionId('tab-1')).toBeUndefined();
  });

  it('resolves immediately for an unknown tab', async () => {
    await expect(manager.gracefulKill('no-such-tab')).resolves.toBeUndefined();
  });
});

describe('gracefulKillAll', () => {
  it('shuts down every tab and clears the registry', async () => {
    const a = spawnTab('tab-a', 'claude');
    const b = spawnTab('tab-b', 'claude');
    const all = manager.gracefulKillAll();

    a.exit();
    b.exit();
    await expect(all).resolves.toBeUndefined();
    expect(manager.getSessionId('tab-a')).toBeUndefined();
    expect(manager.getSessionId('tab-b')).toBeUndefined();
  });

  it('resolves when there is nothing to kill', async () => {
    await expect(manager.gracefulKillAll()).resolves.toBeUndefined();
  });
});
