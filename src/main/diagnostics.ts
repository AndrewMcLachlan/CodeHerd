import * as fs from 'fs';
import * as path from 'path';

/**
 * Raw PTY logging captures every byte the terminal shows — prompts, conversation
 * content, and potentially secrets — and grows without bound, so it is strictly
 * opt-in for debugging sessions: set CODEHERD_PTY_DEBUG=1 or pass --pty-debug.
 *
 * This is deliberately NOT the same switch as the diagnostics log below. Raw
 * capture stays a developer tool; diagnostics is safe enough to leave running.
 */
export function isPtyDebugEnabled(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  const value = env.CODEHERD_PTY_DEBUG;
  if (value && value !== '0' && value.toLowerCase() !== 'false') return true;
  return argv.includes('--pty-debug');
}

/**
 * Whether to record the diagnostics timeline: set CODEHERD_DIAGNOSTICS=1 or pass
 * --diagnostics.
 *
 * Deliberately not a preference. This exists for chasing an intermittent fault, and
 * a setting for that in everyone's Preferences window is clutter for the people who
 * will never use it. Prefer the environment variable on Windows: shortcut arguments
 * are lost when Squirrel recreates the Start Menu shortcut on update, a user
 * environment variable is not.
 */
export function isDiagnosticsEnabled(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  const value = env.CODEHERD_DIAGNOSTICS;
  if (value && value !== '0' && value.toLowerCase() !== 'false') return true;
  return argv.includes('--diagnostics');
}

const CONTROL_NAMES: Record<number, string> = {
  0x03: 'ETX', 0x04: 'EOT', 0x07: 'BEL', 0x08: 'BS', 0x09: 'TAB',
  0x0a: 'LF', 0x0d: 'CR', 0x1b: 'ESC', 0x7f: 'DEL',
};

// CSI (ESC [ … final byte) and SS3 (ESC O x) cover arrow and function keys, plus the
// mouse and bracketed-paste markers — the sequences a latency trace is actually about.
const ESCAPE_SEQUENCE = /^\x1b(?:\[[0-9;?<>]*[ -/]*[@-~]|O[@-~]|[@-Z\\-_])/;

/**
 * Describe a chunk of user input for the log **without recording what was typed**.
 *
 * Control and escape sequences are kept verbatim: an arrow key or a Ctrl+C is the
 * whole point of an input-latency trace, and neither carries content. Printable
 * characters are collapsed to a count, because a terminal receives passwords,
 * tokens, and private conversation, and none of that belongs in a file someone
 * will attach to a bug report.
 */
export function describeInput(data: string): string {
  let out = '';
  let printable = 0;
  const flush = () => {
    if (printable > 0) {
      out += `<${printable} chars>`;
      printable = 0;
    }
  };

  let i = 0;
  while (i < data.length) {
    const code = data.charCodeAt(i);
    if (code === 0x1b) {
      // Bounded window so a large paste cannot make this quadratic.
      const match = data.slice(i, i + 32).match(ESCAPE_SEQUENCE);
      if (match) {
        flush();
        out += `<ESC>${match[0].slice(1)}`;
        i += match[0].length;
        continue;
      }
    }
    if (code < 0x20 || code === 0x7f) {
      flush();
      out += `<${CONTROL_NAMES[code] ?? `0x${code.toString(16).padStart(2, '0')}`}>`;
    } else {
      printable++;
    }
    i++;
  }
  flush();
  return out;
}

/**
 * Opt-in main-process instrumentation for diagnosing input latency under load.
 * Correlates on one timeline: how long the event loop stalls, how much PTY output
 * flowed around a stall (the suspected cause), when input actually reached the main
 * process (the suspected victim), and how long synchronous transcript reads took.
 *
 * Designed to be left switched on for days waiting for a rare fault, so it writes
 * only when something is worth seeing and caps its own size.
 */
export interface Diagnostics {
  /** Record an event (input arrival, clipboard write, transcript read) on the timeline. */
  log(event: string, detail?: string): void;
  /** Tally a chunk of PTY output; reported alongside a stall. */
  countOutput(bytes: number): void;
  stop(): void;
}

/** Rotate at 5 MB, keeping one previous file — enough history, bounded at ~10 MB. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/** Where the timeline is written. Shared so the UI can point at the real file. */
export function diagnosticsLogPath(logDir: string): string {
  return path.join(logDir, 'diagnostics.log');
}

let active: Diagnostics | null = null;

/** The running diagnostics logger, or null when instrumentation is off. */
export function getDiagnostics(): Diagnostics | null {
  return active;
}

/**
 * Whether the recorder is actually running — the honest answer for the UI, which
 * shows a badge and a folder shortcut only while there is a log being written.
 * Not the same as isDiagnosticsEnabled(): --pty-debug arms the recorder too.
 */
export function isDiagnosticsRecording(): boolean {
  return active !== null;
}

export function startDiagnostics(
  logDir: string,
  intervalMs = 100,
  thresholdMs = 50,
  heartbeatMs = 60_000,
): Diagnostics {
  // Restarting while already running would leak the old timer and stream.
  if (active) return active;

  // The dev run redirects userData to a subdirectory that may not exist yet; without
  // this the stream fails asynchronously and the log silently never appears.
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    // fall through — the stream error handler below reports it
  }

  const logPath = diagnosticsLogPath(logDir);
  const previousPath = `${logPath}.1`;
  let stream: fs.WriteStream;
  let written = 0;

  const openStream = () => {
    stream = fs.createWriteStream(logPath, { flags: 'a' });
    stream.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error(`[diag] cannot write ${logPath}:`, err);
    });
  };

  try {
    written = fs.statSync(logPath).size;
  } catch {
    written = 0;
  }
  openStream();

  const rotate = () => {
    try {
      stream.end();
      fs.rmSync(previousPath, { force: true });
      fs.renameSync(logPath, previousPath);
    } catch {
      // If rotation fails, keep appending rather than losing the run.
    }
    written = 0;
    openStream();
  };

  const write = (line: string) => {
    const stamped = `[${new Date().toISOString()}] ${line}\n`;
    written += Buffer.byteLength(stamped);
    stream.write(stamped);
    // eslint-disable-next-line no-console
    console.log(`[diag] ${line}`);
    if (written >= MAX_LOG_BYTES) rotate();
  };

  // eslint-disable-next-line no-console
  console.log(`[diag] logging to ${logPath}`);
  write(`=== diagnostics started (stall threshold ${thresholdMs}ms) ===`);

  let chunks = 0;
  let bytes = 0;
  let sinceHeartbeatChunks = 0;
  let sinceHeartbeatBytes = 0;
  let lastHeartbeatAt = Date.now();
  let expected = Date.now() + intervalMs;

  const tick = () => {
    const now = Date.now();
    const lag = now - expected;
    // Output volume is reported only alongside a stall, where it is the evidence that
    // separates saturation from a blocking call. A line every window would flood the
    // file and add main-process work to the very thing being measured.
    if (lag > thresholdMs) {
      write(`event-loop stalled ${lag}ms (output this window: ${chunks} chunks, ${bytes} bytes)`);
    }
    sinceHeartbeatChunks += chunks;
    sinceHeartbeatBytes += bytes;
    chunks = 0;
    bytes = 0;
    // A periodic summary keeps a quiet log informative: "no stalls" means more when
    // it can be read against real throughput.
    if (now - lastHeartbeatAt >= heartbeatMs) {
      const seconds = Math.round((now - lastHeartbeatAt) / 1000);
      write(`heartbeat: ${sinceHeartbeatChunks} chunks, ${sinceHeartbeatBytes} bytes in last ${seconds}s`);
      sinceHeartbeatChunks = 0;
      sinceHeartbeatBytes = 0;
      lastHeartbeatAt = now;
    }
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
      active = null;
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
