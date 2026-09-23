import type { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';

/** The parts of WebglAddon this module drives; narrowed so tests can substitute a fake. */
export interface RendererAddon {
  onContextLoss(handler: () => void): unknown;
  dispose(): void;
}

export type RendererHost = Pick<Terminal, 'loadAddon'>;

/**
 * Attach xterm's GPU renderer, returning null when it cannot run.
 *
 * Must be called after terminal.open(): the addon needs the terminal's element to
 * acquire a WebGL2 context, and without one it throws during activation.
 */
export function attachWebglRenderer(
  terminal: RendererHost,
  create: () => RendererAddon = () => new WebglAddon(),
): RendererAddon | null {
  let addon: RendererAddon;
  try {
    addon = create();
  } catch {
    return null;
  }

  try {
    // Disposing the addon on context loss hands rendering back to the DOM renderer;
    // leaving it attached would freeze the terminal on a dead context.
    addon.onContextLoss(() => addon.dispose());
    terminal.loadAddon(addon as never);
    return addon;
  } catch {
    try {
      addon.dispose();
    } catch {
      // Nothing usable to clean up.
    }
    return null;
  }
}
