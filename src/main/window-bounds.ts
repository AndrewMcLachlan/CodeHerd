import type { AppState } from '../shared/types';

/** The window facts that decide what gets persisted. */
export interface WindowGeometry {
  isMinimized(): boolean;
  isMaximized(): boolean;
  getBounds(): { x: number; y: number; width: number; height: number };
  getNormalBounds(): { x: number; y: number; width: number; height: number };
}

/**
 * The window bounds to persist, or null when the current state cannot be restored from.
 *
 * Reads getNormalBounds(): while the window is maximized getBounds() reports the
 * maximized geometry, which would overwrite the size the window restores to.
 */
export function windowBoundsToPersist(window: WindowGeometry): AppState['windowBounds'] | null {
  // Windows reports isMaximized() as false while minimized, so saving here would drop
  // the maximized flag the next launch needs.
  if (window.isMinimized()) return null;

  const { x, y, width, height } = window.getNormalBounds();
  return { x, y, width, height, isMaximized: window.isMaximized() };
}
