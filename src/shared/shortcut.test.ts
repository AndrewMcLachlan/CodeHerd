import { describe, expect, it } from 'vitest';
import { formatShortcut, matchesShortcut, toAccelerator, type ShortcutEvent } from './shortcut';

const event = (overrides: Partial<ShortcutEvent>): ShortcutEvent => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  key: '',
  ...overrides,
});

describe('matchesShortcut', () => {
  it('matches modifiers and key exactly', () => {
    expect(matchesShortcut('Ctrl+T', event({ ctrlKey: true, key: 't' }))).toBe(true);
    expect(matchesShortcut('Ctrl+Shift+T', event({ ctrlKey: true, shiftKey: true, key: 'T' }))).toBe(true);
    expect(matchesShortcut('Ctrl+Alt+K', event({ ctrlKey: true, altKey: true, key: 'k' }))).toBe(true);
    expect(matchesShortcut('F5', event({ key: 'F5' }))).toBe(true);
  });

  it('accepts the macOS Cmd key wherever Ctrl is configured', () => {
    expect(matchesShortcut('Ctrl+T', event({ metaKey: true, key: 't' }))).toBe(true);
  });

  it('rejects extra or missing modifiers', () => {
    expect(matchesShortcut('Ctrl+T', event({ ctrlKey: true, shiftKey: true, key: 't' }))).toBe(false);
    expect(matchesShortcut('Ctrl+Shift+T', event({ ctrlKey: true, key: 't' }))).toBe(false);
    expect(matchesShortcut('Ctrl+T', event({ key: 't' }))).toBe(false);
  });

  it("never matches 'none' or malformed strings, so keys reach the terminal", () => {
    expect(matchesShortcut('none', event({ ctrlKey: true, key: 't' }))).toBe(false);
    expect(matchesShortcut('', event({ key: 't' }))).toBe(false);
  });
});

describe('formatShortcut', () => {
  it('renders symbols on macOS and plus-joined names elsewhere', () => {
    expect(formatShortcut('Ctrl+Shift+T', true)).toBe('⌘⇧T');
    expect(formatShortcut('Ctrl+Shift+T', false)).toBe('Ctrl+Shift+T');
    expect(formatShortcut('F5', false)).toBe('F5');
  });

  it("returns undefined for 'none' so callers can hide the label", () => {
    expect(formatShortcut('none', false)).toBeUndefined();
  });
});

describe('toAccelerator', () => {
  it('maps Ctrl to CmdOrCtrl for Electron menus', () => {
    expect(toAccelerator('Ctrl+Alt+K')).toBe('CmdOrCtrl+Alt+K');
    expect(toAccelerator('F5')).toBe('F5');
  });

  it("returns null for 'none' so no accelerator is registered", () => {
    expect(toAccelerator('none')).toBeNull();
  });
});
