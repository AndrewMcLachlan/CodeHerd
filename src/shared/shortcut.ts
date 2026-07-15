// Canonical New Tab shortcut helpers, shared by the main process (menu
// accelerator) and the renderer (terminal key handler + labels).
//
// Canonical format: modifiers in the fixed order Ctrl, Alt, Shift, then the
// key, joined by '+'. The key is an uppercase letter, a digit, or 'F1'..'F12'.
// Examples: 'Ctrl+T', 'Ctrl+Shift+T', 'Ctrl+Alt+K', 'F5'. The sentinel 'none'
// means the shortcut is disabled — Ctrl+T is left for the terminal so Claude
// Code receives it (show/hide sub-agent tasks). See #69.

export const DEFAULT_NEW_TAB_SHORTCUT = 'Ctrl+T';

export interface ShortcutEvent {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}

interface Parsed {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string; // uppercased: 'T', '1', 'F5'
}

function parse(shortcut: string): Parsed | null {
  if (!shortcut || shortcut === 'none') return null;
  const parts = shortcut.split('+');
  const key = parts.pop();
  if (!key) return null;
  return {
    ctrl: parts.includes('Ctrl'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift'),
    key: key.toUpperCase(),
  };
}

/** True when a keyboard event matches the configured shortcut. 'none' and
 *  malformed strings never match, so Ctrl+T then falls through to the PTY. */
export function matchesShortcut(shortcut: string, e: ShortcutEvent): boolean {
  const p = parse(shortcut);
  if (!p) return false;
  if ((e.ctrlKey || e.metaKey) !== p.ctrl) return false;
  if (e.altKey !== p.alt) return false;
  if (e.shiftKey !== p.shift) return false;
  return e.key.toUpperCase() === p.key;
}

/** Human-readable label (⌘⇧T on macOS, Ctrl+Shift+T elsewhere). Returns
 *  undefined for 'none'/malformed so callers can hide the label. */
export function formatShortcut(shortcut: string, isMac: boolean): string | undefined {
  const p = parse(shortcut);
  if (!p) return undefined;
  const parts: string[] = [];
  if (p.ctrl) parts.push(isMac ? '⌘' : 'Ctrl');
  if (p.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (p.shift) parts.push(isMac ? '⇧' : 'Shift');
  parts.push(p.key);
  return isMac ? parts.join('') : parts.join('+');
}

/** Electron accelerator ('CmdOrCtrl+T'), or null for 'none'/malformed so the
 *  menu registers no accelerator and the key reaches the terminal. */
export function toAccelerator(shortcut: string): string | null {
  const p = parse(shortcut);
  if (!p) return null;
  const parts: string[] = [];
  if (p.ctrl) parts.push('CmdOrCtrl');
  if (p.alt) parts.push('Alt');
  if (p.shift) parts.push('Shift');
  parts.push(p.key);
  return parts.join('+');
}
