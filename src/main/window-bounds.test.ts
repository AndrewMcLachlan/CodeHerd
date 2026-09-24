import { describe, expect, it } from 'vitest';
import { windowBoundsToPersist, type WindowGeometry } from './window-bounds';

const NORMAL = { x: 120, y: 80, width: 1280, height: 800 };
const MAXIMIZED = { x: 0, y: 0, width: 2560, height: 1392 };

const win = (overrides: Partial<WindowGeometry> = {}): WindowGeometry => ({
  isMinimized: () => false,
  isMaximized: () => false,
  getBounds: () => NORMAL,
  getNormalBounds: () => NORMAL,
  ...overrides,
});

describe('windowBoundsToPersist', () => {
  it('persists the bounds of an ordinary window', () => {
    expect(windowBoundsToPersist(win())).toEqual({ ...NORMAL, isMaximized: false });
  });

  it('persists the restore size, not the maximized size', () => {
    const maximized = win({
      isMaximized: () => true,
      getBounds: () => MAXIMIZED,
      getNormalBounds: () => NORMAL,
    });
    expect(windowBoundsToPersist(maximized)).toEqual({ ...NORMAL, isMaximized: true });
  });

  it('records that the window was maximized', () => {
    const maximized = win({ isMaximized: () => true, getBounds: () => MAXIMIZED });
    expect(windowBoundsToPersist(maximized)?.isMaximized).toBe(true);
  });

  it('skips a minimized window rather than recording it as restored', () => {
    // Windows reports isMaximized() === false while minimized, so saving here would
    // silently drop the maximized flag.
    const minimized = win({ isMinimized: () => true, isMaximized: () => false });
    expect(windowBoundsToPersist(minimized)).toBeNull();
  });

  it('skips a window minimized from a maximized state', () => {
    const minimized = win({
      isMinimized: () => true,
      isMaximized: () => true,
      getBounds: () => MAXIMIZED,
    });
    expect(windowBoundsToPersist(minimized)).toBeNull();
  });

  it('never returns the maximized geometry as the restore size', () => {
    const maximized = win({
      isMaximized: () => true,
      getBounds: () => MAXIMIZED,
      getNormalBounds: () => NORMAL,
    });
    const saved = windowBoundsToPersist(maximized)!;
    expect(saved.width).not.toBe(MAXIMIZED.width);
    expect(saved.height).not.toBe(MAXIMIZED.height);
  });
});
