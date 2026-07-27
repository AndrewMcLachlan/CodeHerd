import * as fs from 'fs';
import * as path from 'path';

/**
 * Raw PTY logging captures every byte the terminal shows — prompts, conversation
 * content, and potentially secrets — and grows without bound, so it is strictly
 * opt-in for debugging sessions: set CODEHERD_PTY_DEBUG=1 or pass --pty-debug.
 */
export function isPtyDebugEnabled(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  const value = env.CODEHERD_PTY_DEBUG;
  if (value && value !== '0' && value.toLowerCase() !== 'false') return true;
  return argv.includes('--pty-debug');
}

/** Render control characters readably, matching the raw pty-debug log format. */
export function escapeControl(data: string): string {
  const names: Record<number, string> = {
    3: 'ETX', 4: 'EOT', 7: 'BEL', 8: 'BS', 9: 'TAB', 10: 'LF', 13: 'CR', 27: 'ESC',
  };
  return data.replace(/[\x00-\x1f\x7f]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return `<${names[code] ?? `0x${code.toString(16).padStart(2, '0')}`}>`;
  });
}

/**
 * Opt-in main-process instrumentation for diagnosing input latency under load.
 * Correlates three things on one timeline: how long the event loop stalls, how
 * much PTY output flowed in each window (the suspected cause), and when input
 * actually reached the main process (the suspected victim). Gated behind the same
 * CODEHERD_PTY_DEBUG flag as raw logging; a no-op unless started.
 */
export interface Diagnostics {
  /** Record an event (e.g. input arrival, pty.write) on the timeline. */
  log(event: string, detail?: string): void;
  /** Tally a chunk of PTY output; flushed as a per-window summary by the monitor. */
  countOutput(bytes: number): void;
  stop(): void;
}

let active: Diagnostics | null = null;

/** The running diagnostics logger, or null when instrumentation is off. */
export function getDiagnostics(): Diagnostics | null {
  return active;
}

/**
 * Start the event-loop lag monitor. Every `intervalMs` it checks how late its own
 * timer fired (= how long the loop was blocked) and, when that exceeds `thresholdMs`,
 * writes a line alongside the output volume seen since the last tick. Also mirrors to
 * the console so a `npm start` dev run shows the timeline live. Returns the logger and
 * registers it as the process-wide singleton for getDiagnostics().
 */
export function startDiagnostics(
  logDir: string,
  intervalMs = 100,
  thresholdMs = 50,
): Diagnostics {
  const stream = fs.createWriteStream(path.join(logDir, 'diagnostics-loop.log'), { flags: 'a' });
  const write = (line: string) => {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    stream.write(`${stamped}\n`);
    // eslint-disable-next-line no-console
    console.log(`[diag] ${line}`);
  };
  write(`=== diagnostics started (interval ${intervalMs}ms, stall threshold ${thresholdMs}ms) ===`);

  let chunks = 0;
  let bytes = 0;
  let expected = Date.now() + intervalMs;
  const tick = () => {
    const now = Date.now();
    const lag = now - expected;
    if (chunks > 0) write(`output: ${chunks} chunks, ${bytes} bytes`);
    if (lag > thresholdMs) write(`event-loop stalled ${lag}ms`);
    chunks = 0;
    bytes = 0;
    expected = now + intervalMs;
    timer = setTimeout(tick, intervalMs);
  };
  let timer = setTimeout(tick, intervalMs);

  active = {
    log: (event, detail) => write(detail ? `${event} ${detail}` : event),
    countOutput: (n) => { chunks += 1; bytes += n; },
    stop: () => {
      clearTimeout(timer);
      write('=== diagnostics stopped ===');
      stream.end();
      if (active) active = null;
    },
  };
  return active;
}

/**
 * Delete raw PTY debug logs left behind by earlier runs (older releases wrote
 * them unconditionally). Best-effort; returns the number of files removed.
 */
export function cleanPtyDebugLogs(dir: string): number {
  let removed = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/^pty-debug-.+\.log$/.test(name)) continue;
      try {
        fs.unlinkSync(path.join(dir, name));
        removed++;
      } catch {
        // in use or already gone
      }
    }
  } catch {
    // directory unreadable — nothing to clean
  }
  return removed;
}
