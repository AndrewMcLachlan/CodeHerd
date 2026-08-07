import { describe, expect, it } from 'vitest';
import { describeInput, isPtyDebugEnabled } from './diagnostics';

describe('describeInput', () => {
  it('keeps arrow keys intact — they are the point of a latency trace', () => {
    expect(describeInput('\x1b[B')).toBe('<ESC>[B');
    expect(describeInput('\x1b[A')).toBe('<ESC>[A');
    expect(describeInput('\x1bOA')).toBe('<ESC>OA');
  });

  it('keeps named control characters', () => {
    expect(describeInput('\x03')).toBe('<ETX>');
    expect(describeInput('\r')).toBe('<CR>');
    expect(describeInput('\x7f')).toBe('<DEL>');
  });

  it('never records what was typed', () => {
    // A terminal receives passwords and tokens; the log gets attached to bug reports.
    const secret = 'hunter2';
    const described = describeInput(secret);
    expect(described).toBe('<7 chars>');
    expect(described).not.toContain('hunter');
  });

  it('redacts printable text around control sequences it keeps', () => {
    expect(describeInput('ls -la\r')).toBe('<6 chars><CR>');
    expect(describeInput('\x1b[Bpassword\r')).toBe('<ESC>[B<8 chars><CR>');
  });

  it('does not leak pasted content between bracketed-paste markers', () => {
    const described = describeInput('\x1b[200~secret-token\x1b[201~');
    expect(described).toBe('<ESC>[200~<12 chars><ESC>[201~');
    expect(described).not.toContain('secret');
  });

  it('keeps SGR mouse reports, which carry no content', () => {
    expect(describeInput('\x1b[<0;10;20M')).toBe('<ESC>[<0;10;20M');
  });

  it('handles an empty chunk', () => {
    expect(describeInput('')).toBe('');
  });

  it('counts non-ASCII printable characters without recording them', () => {
    const described = describeInput('héllo');
    expect(described).toBe('<5 chars>');
    // Not a bare letter: the marker itself contains "chars", so a single-character
    // assertion passes or fails for the wrong reason.
    expect(described).not.toContain('é');
    expect(described).not.toContain('héllo');
  });

  it('renders an unnamed control character by code', () => {
    expect(describeInput('\x01')).toBe('<0x01>');
  });
});

describe('isPtyDebugEnabled', () => {
  it('is off by default — raw capture stays a developer tool', () => {
    expect(isPtyDebugEnabled({}, [])).toBe(false);
  });

  it('honours the environment variable and the flag', () => {
    expect(isPtyDebugEnabled({ CODEHERD_PTY_DEBUG: '1' }, [])).toBe(true);
    expect(isPtyDebugEnabled({}, ['--pty-debug'])).toBe(true);
  });

  it('treats 0 and false as off', () => {
    expect(isPtyDebugEnabled({ CODEHERD_PTY_DEBUG: '0' }, [])).toBe(false);
    expect(isPtyDebugEnabled({ CODEHERD_PTY_DEBUG: 'false' }, [])).toBe(false);
  });
});
