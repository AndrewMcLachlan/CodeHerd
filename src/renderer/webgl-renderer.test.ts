import { describe, expect, it, vi } from 'vitest';
import { attachWebglRenderer, type RendererAddon, type RendererHost } from './webgl-renderer';

class FakeAddon implements RendererAddon {
  disposed = false;
  contextLossHandler: (() => void) | null = null;
  onContextLoss(handler: () => void): unknown {
    this.contextLossHandler = handler;
    return { dispose: () => {} };
  }
  dispose(): void {
    this.disposed = true;
  }
}

const host = (): RendererHost & { loaded: unknown[] } => {
  const loaded: unknown[] = [];
  return { loaded, loadAddon: (addon: never) => { loaded.push(addon); } };
};

describe('attachWebglRenderer', () => {
  it('loads the addon into the terminal', () => {
    const terminal = host();
    const addon = new FakeAddon();
    const result = attachWebglRenderer(terminal, () => addon);
    expect(result).toBe(addon);
    expect(terminal.loaded).toEqual([addon]);
  });

  it('disposes the addon when the GPU context is lost', () => {
    const terminal = host();
    const addon = new FakeAddon();
    attachWebglRenderer(terminal, () => addon);
    expect(addon.contextLossHandler).toBeTypeOf('function');
    addon.contextLossHandler!();
    expect(addon.disposed).toBe(true);
  });

  it('falls back when the addon cannot be constructed', () => {
    const terminal = host();
    const result = attachWebglRenderer(terminal, () => {
      throw new Error('WebGL2 unavailable');
    });
    expect(result).toBeNull();
    expect(terminal.loaded).toEqual([]);
  });

  it('falls back and cleans up when activation throws', () => {
    const addon = new FakeAddon();
    const terminal: RendererHost = {
      loadAddon: () => { throw new Error('could not acquire context'); },
    };
    const result = attachWebglRenderer(terminal, () => addon);
    expect(result).toBeNull();
    expect(addon.disposed).toBe(true);
  });

  it('survives an addon that also throws while being cleaned up', () => {
    const addon = new FakeAddon();
    vi.spyOn(addon, 'dispose').mockImplementation(() => { throw new Error('already gone'); });
    const terminal: RendererHost = {
      loadAddon: () => { throw new Error('could not acquire context'); },
    };
    expect(attachWebglRenderer(terminal, () => addon)).toBeNull();
  });
});
