import { normalizeTabColor } from '../shared/tab-colors';

export type CodexColorCommand =
  | { type: 'pick-color'; clearLength: number }
  | { type: 'set-color'; color: string | null; clearLength: number };

interface ComposerState {
  text: string;
  cursor: number;
  reliable: boolean;
}

function parseColorCommand(text: string): CodexColorCommand | null {
  const match = text.trim().match(/^\/color(?:\s+(.+?))?$/i);
  if (!match) return null;

  const clearLength = Array.from(text).length;
  const argument = match[1]?.trim();
  if (!argument) return { type: 'pick-color', clearLength };
  if (/^(?:default|none|reset|clear)$/i.test(argument)) {
    return { type: 'set-color', color: null, clearLength };
  }

  const color = normalizeTabColor(argument);
  return color
    ? { type: 'set-color', color, clearLength }
    : { type: 'pick-color', clearLength };
}

/**
 * Mirrors enough of Codex's composer editing to recognise an application-owned
 * slash command at submission time. If history or an unknown editing sequence is
 * used, tracking becomes conservative and the input is left entirely to Codex.
 */
export class CodexCommandTracker {
  private states = new Map<string, ComposerState>();

  handleInput(tabId: string, data: string): CodexColorCommand | null {
    const state = this.states.get(tabId) ?? { text: '', cursor: 0, reliable: true };
    this.states.set(tabId, state);

    for (let offset = 0; offset < data.length;) {
      if (data.startsWith('\x1b[200~', offset) || data.startsWith('\x1b[201~', offset)) {
        offset += 6;
        continue;
      }

      if (data[offset] === '\x1b') {
        const sequence = data.slice(offset).match(/^\x1b(?:\[[0-?]*[ -/]*[@-~]|O.)/)?.[0];
        if (!sequence) {
          // A bare Escape dismisses Codex UI without changing the composer text.
          offset += 1;
          continue;
        }
        this.applyEscapeSequence(state, sequence);
        offset += sequence.length;
        continue;
      }

      const codePoint = data.codePointAt(offset)!;
      const char = String.fromCodePoint(codePoint);
      offset += char.length;

      if (char === '\r') {
        this.states.delete(tabId);
        return state.reliable ? parseColorCommand(state.text) : null;
      }
      if (char === '\n') {
        this.insert(state, '\n');
      } else if (char === '\x7f' || char === '\b') {
        if (state.cursor > 0) {
          state.text = state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor);
          state.cursor -= 1;
        }
      } else if (char === '\x01') {
        state.cursor = 0;
      } else if (char === '\x05') {
        state.cursor = state.text.length;
      } else if (char === '\x0b') {
        state.text = state.text.slice(0, state.cursor);
      } else if (char === '\x15') {
        state.text = state.text.slice(state.cursor);
        state.cursor = 0;
      } else if (char === '\x17') {
        const before = state.text.slice(0, state.cursor);
        const start = before.search(/\S+\s*$/);
        if (start >= 0) {
          state.text = state.text.slice(0, start) + state.text.slice(state.cursor);
          state.cursor = start;
        }
      } else if (char === '\x03') {
        this.states.delete(tabId);
        return null;
      } else if (codePoint >= 0x20) {
        this.insert(state, char);
      }
    }

    return null;
  }

  forget(tabId: string): void {
    this.states.delete(tabId);
  }

  private insert(state: ComposerState, text: string): void {
    state.text = state.text.slice(0, state.cursor) + text + state.text.slice(state.cursor);
    state.cursor += text.length;
  }

  private applyEscapeSequence(state: ComposerState, sequence: string): void {
    switch (sequence) {
      case '\x1b[I':
      case '\x1b[O':
        // Focus-in/focus-out reports are emitted by xterm when the host enables
        // focus tracking. They share the PTY input stream but are not composer edits.
        break;
      case '\x1b[D':
      case '\x1bOD':
        state.cursor = Math.max(0, state.cursor - 1);
        break;
      case '\x1b[C':
      case '\x1bOC':
        state.cursor = Math.min(state.text.length, state.cursor + 1);
        break;
      case '\x1b[H':
      case '\x1bOH':
      case '\x1b[1~':
        state.cursor = 0;
        break;
      case '\x1b[F':
      case '\x1bOF':
      case '\x1b[4~':
        state.cursor = state.text.length;
        break;
      case '\x1b[3~':
        if (state.cursor < state.text.length) {
          state.text = state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1);
        }
        break;
      default:
        // SGR mouse reports also arrive through terminal.onData. A click used to focus
        // the composer must not make subsequent command tracking unreliable.
        if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(sequence)) break;
        // History, word navigation, undo, and other TUI editing cannot be mirrored
        // safely. A false negative is preferable to consuming a real Codex prompt.
        state.reliable = false;
    }
  }
}
