import { describe, expect, it } from 'vitest';
import { describeInput, isDiagnosticsEnabled, isPtyDebugEnabled } from './diagnostics';

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

describe('isDiagnosticsEnabled', () => {
  it('is off unless asked for, so ordinary launches record nothing', () => {
    expect(isDiagnosticsEnabled({}, [])).toBe(false);
    expect(isDiagnosticsEnabled({}, ['--live-state'])).toBe(false);
  });

  it('honours the environment variable and the flag', () => {
    expect(isDiagnosticsEnabled({ CODEHERD_DIAGNOSTICS: '1' }, [])).toBe(true);
    expect(isDiagnosticsEnabled({}, ['--diagnostics'])).toBe(true);
  });

  it('treats 0 and false as off', () => {
    expect(isDiagnosticsEnabled({ CODEHERD_DIAGNOSTICS: '0' }, [])).toBe(false);
    expect(isDiagnosticsEnabled({ CODEHERD_DIAGNOSTICS: 'false' }, [])).toBe(false);
  });

  it('is independent of raw PTY capture', () => {
    // Raw capture records every byte the terminal shows; the timeline does not.
    // One must not imply the other in this direction.
    expect(isDiagnosticsEnabled({ CODEHERD_PTY_DEBUG: '1' }, [])).toBe(false);
    expect(isPtyDebugEnabled({ CODEHERD_DIAGNOSTICS: '1' }, [])).toBe(false);
  });

  // A --diagnostics shortcut clicked at an already-running app cannot start a second
  // copy: Electron hands its argv to the live instance instead. Only argv crosses
  // over, so the flag has to be readable with no environment to fall back on.
  it('reads the flag out of a second-instance argv', () => {
    const exe = 'C:\Users\me\AppData\Local\codeherd\app-1.0.0\codeherd.exe';
    expect(isDiagnosticsEnabled({}, [exe, '--diagnostics'])).toBe(true);
    expect(isDiagnosticsEnabled({}, [exe])).toBe(false);
    expect(isDiagnosticsEnabled({}, [exe, '--squirrel-firstrun'])).toBe(false);
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
