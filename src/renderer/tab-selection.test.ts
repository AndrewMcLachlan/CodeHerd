import { describe, it, expect } from 'vitest';
import { selectTabAfterClose } from './tab-selection';

describe('selectTabAfterClose', () => {
  it('goes back to where you just were', () => {
    // 'c' was active and has been closed; 'b' is where you were before it.
    expect(selectTabAfterClose(['b', 'a'], ['a', 'b'])).toBe('b');
  });

  it('ignores history for tabs that are already gone', () => {
    // Closing several tabs in a row leaves stale entries at the head of history.
    expect(selectTabAfterClose(['x', 'y', 'b'], ['a', 'b'])).toBe('b');
  });

  it('falls back to the end of the strip when history offers nothing', () => {
    expect(selectTabAfterClose([], ['a', 'b', 'c'])).toBe('c');
    expect(selectTabAfterClose(['gone'], ['a', 'b', 'c'])).toBe('c');
  });

  it('reports that nothing is left', () => {
    expect(selectTabAfterClose(['a'], [])).toBeNull();
    expect(selectTabAfterClose([], [])).toBeNull();
  });
});
