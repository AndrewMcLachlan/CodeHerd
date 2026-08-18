import { describe, expect, it } from 'vitest';
import {
  detectAttention,
  detectCodexAttention,
  detectStatus,
  extractOscTitle,
  isBusyTitle,
} from './status-detection';

const E = '\x1b';
const GREY = `${E}[38;2;153;153;153m`;

describe('detectAttention', () => {
  // Every positive case below is lifted verbatim from raw PTY logs of real
  // Claude Code prompts (control codes restored from their escaped form).
  const footers: [string, string][] = [
    ['old style (colour directly before phrase)', `${GREY}Esc to cancel`],
    ['question select footer', `${GREY}Enter to select · ↑/↓ to navigate · Esc to cancel`],
    ['select footer with CRLF gap', `${GREY}\r\nEnter to select · ↑/↓ to navigate · Esc to cancel`],
    ['tab/arrow variant', `${GREY}Enter to select · Tab/Arrow keys to navigate · Esc to cancel`],
    ['notes variant', `${GREY}Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel`],
    [
      'multi-question variant',
      `${GREY}Enter to select · ↑/↓ to navigate · n to add notes · Tab to switch questions · Esc to cancel`,
    ],
    [
      'notepad variant',
      `${GREY}Enter to select · ↑/↓ to navigate · ctrl+g to edit in Notepad · Esc to cancel`,
    ],
    ['confirm italic variant', `${GREY}${E}[3mEnter to confirm · Esc to cancel`],
    ['confirm italic + cursor move', `${GREY}${E}[3m${E}[74;3HEnter to confirm · Esc to cancel`],
    [
      'notepad + style/cursor sequences',
      `${GREY}${E}[22m${E}[74;48Hctrl+g${E}[1Cto edit in Notepad · Esc to cancel`,
    ],
    [
      'model default prompt with cursor-forward gaps',
      `${GREY}Enter to set as defaul${E}[1C ·${E}[1Cs to us${E}[1C this session only · Esc to cancel`,
    ],
    ['cursor-positioned bare phrase', `${GREY}${E}[62;2HEsc to cancel`],
    ['navigate-then-confirm variant', `${GREY}${E}[3m↑/↓ to navigate · Enter to confirm · Esc to cancel`],
  ];

  it.each(footers)('detects prompt footer: %s', (_name, data) => {
    expect(detectAttention(data)).toBe(true);
  });

  // Output that merely *mentions* the phrase must not pulse the tab.
  const content: [string, string][] = [
    [
      'plain conversation text',
      'Sun in title means Claude is waiting. Grey "Esc to cancel" shows a prompt.',
    ],
    [
      'syntax-highlighted source of this detector shown in a diff',
      `${E}[38;5;149mincludes${E}[38;5;231m(${E}[38;5;186m'${E}[38;5;141m\\x1b${E}[38;5;186m[38;2;153;153;153mEsc to cancel`,
    ],
    [
      'grey chrome, then colour change, then phrase in content',
      `${GREY}some hint${E}[38;5;231m and later the words Esc to cancel appear`,
    ],
    [
      'grey chrome, then reset, then phrase in content',
      `${GREY}› ${E}[0mThe footer says Esc to cancel when a prompt is open`,
    ],
    ['grey far from phrase', `${GREY}esc to interrupt${E}[39m${'x'.repeat(300)}Esc to cancel`],
    ['phrase with no styling at all', 'Esc to cancel'],
  ];

  it.each(content)('ignores conversation content: %s', (_name, data) => {
    expect(detectAttention(data)).toBe(false);
  });
});

describe('extractOscTitle', () => {
  it('extracts the title from an OSC 0 sequence', () => {
    expect(extractOscTitle(`${E}]0;my title\x07`)).toBe('my title');
  });

  it('extracts the title when surrounded by other output', () => {
    expect(extractOscTitle(`hello${E}]0;⠋ Thinking…\x07world`)).toBe('⠋ Thinking…');
  });

  it('returns null when no OSC title is present', () => {
    expect(extractOscTitle('plain output')).toBeNull();
    expect(extractOscTitle(`${E}[38;5;231mstyled output`)).toBeNull();
  });
});

describe('isBusyTitle', () => {
  it('treats a braille spinner frame as busy', () => {
    expect(isBusyTitle('⠋ Thinking…')).toBe(true);
    expect(isBusyTitle('⠙ Running tools')).toBe(true);
  });

  // Captured from a real session: current Claude Code alternates ◐ and ◑ for the
  // whole turn, then swaps the glyph for ✳ the moment it finishes.
  it('treats a circle spinner frame as busy', () => {
    expect(isBusyTitle('◐ Count numbers from 1 to 40')).toBe(true);
    expect(isBusyTitle('◑ Count numbers from 1 to 40')).toBe(true);
    expect(isBusyTitle('◒ Count numbers from 1 to 40')).toBe(true);
    expect(isBusyTitle('◓ Count numbers from 1 to 40')).toBe(true);
    expect(isBusyTitle('◐ Claude Code')).toBe(true);
  });

  it('treats other titles as not busy', () => {
    expect(isBusyTitle('✳ CodeHerd')).toBe(false);
    expect(isBusyTitle('Claude')).toBe(false);
    expect(isBusyTitle('')).toBe(false);
  });

  // The idle marker sits next to the spinner glyphs in the same visual role, so
  // getting this wrong leaves every finished turn stuck as "running".
  it('treats the idle marker as not busy, task name or not', () => {
    expect(isBusyTitle('✳ Claude Code')).toBe(false);
    expect(isBusyTitle('✳ Count numbers from 1 to 40')).toBe(false);
  });
});

describe('detectStatus over a real turn', () => {
  // The OSC titles one session emitted, in order, from startup to turn end.
  const osc = (title: string) => `${E}]0;${title}\x07`;

  it('runs on the spinner and settles to waiting when the glyph changes', () => {
    expect(detectStatus(osc('✳ Claude Code'), 'stopped')).toBe('waiting');
    expect(detectStatus(osc('◐ Claude Code'), 'waiting')).toBe('running');
    expect(detectStatus(osc('◑ Count numbers from 1 to 40'), 'running')).toBeNull();
    expect(detectStatus(osc('✳ Count numbers from 1 to 40'), 'running')).toBe('waiting');
  });
});

describe('detectCodexAttention', () => {
  it('detects the Codex approval title in both animation frames', () => {
    expect(detectCodexAttention(`${E}]0;[!] Action Required | Codex\x07`)).toBe(true);
    expect(detectCodexAttention(`${E}]0;[.] Action Required | Codex\x07`)).toBe(true);
    expect(detectCodexAttention(`${E}]0;[ ! ] Action Required\x07`)).toBe(true);
  });

  it('ignores other titles and plain output', () => {
    expect(detectCodexAttention(`${E}]0;Codex — working\x07`)).toBe(false);
    expect(detectCodexAttention(`${E}]0;Action Required\x07`)).toBe(false);
    expect(detectCodexAttention('[!] Action Required without an OSC title')).toBe(false);
  });
});

describe('detectStatus', () => {
  const QUESTION_FOOTER = `${GREY}Enter to select · ↑/↓ to navigate · Esc to cancel`;

  it('moves to attention when a prompt footer appears', () => {
    expect(detectStatus(QUESTION_FOOTER, 'running')).toBe('attention');
  });

  it('moves to running on a busy (spinner) title', () => {
    expect(detectStatus(`${E}]0;⠋ Thinking…\x07`, 'waiting')).toBe('running');
  });

  it('moves to waiting on a non-busy title', () => {
    expect(detectStatus(`${E}]0;✳ CodeHerd\x07`, 'running')).toBe('waiting');
  });

  it('keeps attention when a non-busy title arrives while a prompt is open', () => {
    // Title repaints while a question is on screen must not clear the pulse.
    expect(detectStatus(`${E}]0;✳ CodeHerd\x07`, 'attention')).toBeNull();
  });

  it('prefers attention when the footer and a non-busy title arrive together', () => {
    expect(detectStatus(`${E}]0;✳ CodeHerd\x07${QUESTION_FOOTER}`, 'running')).toBe('attention');
  });

  it('returns null when nothing recognisable is in the chunk', () => {
    expect(detectStatus('ordinary terminal output', 'running')).toBeNull();
  });

  it('returns null when the detected status matches the current status', () => {
    expect(detectStatus(QUESTION_FOOTER, 'attention')).toBeNull();
    expect(detectStatus(`${E}]0;⠋ Thinking…\x07`, 'running')).toBeNull();
  });
});
