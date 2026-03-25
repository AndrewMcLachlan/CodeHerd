import type { TabState } from '../shared/types';

type Status = TabState['status'];

/**
 * Detects whether Claude Code is showing an approval/decision prompt.
 * Currently matches the "Esc to cancel" footer styled in grey (RGB 153,153,153).
 */
export function detectAttention(data: string): boolean {
  return data.includes('\x1b[38;2;153;153;153mEsc to cancel');
}

/**
 * Extracts the terminal title from an OSC sequence (ESC]0;title BEL).
 * Returns null if no OSC title is present in the data.
 */
export function extractOscTitle(data: string): string | null {
  const match = data.match(/\x1b\]0;(.+?)\x07/);
  return match ? match[1] : null;
}

/**
 * Detects whether the OSC title indicates Claude Code is busy (spinner).
 * Braille characters (U+2800–U+28FF) are used as spinner frames.
 */
export function isBusyTitle(title: string): boolean {
  return /^[\u2800-\u28FF]/.test(title);
}

/**
 * Determines the new tab status based on PTY output data and the current status.
 * Returns null if no status change is detected.
 */
export function detectStatus(data: string, currentStatus: Status): Status | null {
  let newStatus: Status | null = null;

  if (detectAttention(data)) {
    newStatus = 'attention';
  }

  const title = extractOscTitle(data);
  if (title) {
    if (isBusyTitle(title)) {
      newStatus = 'running';
    } else if (newStatus !== 'attention' && currentStatus !== 'attention') {
      newStatus = 'waiting';
    }
  }

  if (newStatus && newStatus !== currentStatus) {
    return newStatus;
  }
  return null;
}
