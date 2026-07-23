import type { TabState } from '../shared/types';

type Status = TabState['status'];

/**
 * Detects whether Claude Code is showing an approval/decision prompt.
 *
 * The prompt footer ends in "Esc to cancel", styled grey (RGB 153,153,153). Newer Claude
 * Code versions place hint text ("Enter to select · ↑/↓ to navigate · ", "Enter to
 * confirm · ", ...) and minor style/cursor sequences between the colour code and the
 * phrase, so allow a short gap — but reject any colour change or reset inside it, which
 * is what separates the real footer from conversation text that merely mentions
 * "Esc to cancel".
 */
const ATTENTION_FOOTER =
  /\x1b\[38;2;153;153;153m(?:(?!\x1b\[(?:38;|48;|39m|3[0-7]m|9[0-7]m|0?m))[\s\S]){0,150}?Esc to cancel/;

export function detectAttention(data: string): boolean {
  return ATTENTION_FOOTER.test(data);
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
 * Detects the title Codex displays while waiting for a tool approval.
 * The punctuation alternates as part of Codex's attention animation.
 */
export function detectCodexAttention(data: string): boolean {
  const title = extractOscTitle(data);
  return title !== null && /^\[\s*[!.]\s*\]\s+Action Required(?:\s+\||$)/.test(title);
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
