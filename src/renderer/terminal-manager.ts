import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { TabId, ResolvedTheme, NewTabShortcut } from '../shared/types';
import { DEFAULT_NEW_TAB_SHORTCUT, matchesShortcut } from '../shared/shortcut';

const DARK_TERMINAL_THEME: ITheme = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  selectionBackground: '#585b7066',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8',
};

const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#eff1f5',
  foreground: '#4c4f69',
  cursor: '#dc8a78',
  selectionBackground: '#acb0be80',
  black: '#5c5f77',
  red: '#d20f39',
  green: '#40a02b',
  yellow: '#df8e1d',
  blue: '#1e66f5',
  magenta: '#ea76cb',
  cyan: '#179299',
  white: '#acb0be',
  brightBlack: '#6c6f85',
  brightRed: '#d20f39',
  brightGreen: '#40a02b',
  brightYellow: '#df8e1d',
  brightBlue: '#1e66f5',
  brightMagenta: '#ea76cb',
  brightCyan: '#179299',
  brightWhite: '#bcc0cc',
};

interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLDivElement;
  cursorSuppressed: boolean;
  /** Mutable reference so closures always see the current tab ID */
  ref: { tabId: TabId };
}

const HIDDEN_CURSOR = 'rgba(0, 0, 0, 0)';
export const DEFAULT_TERMINAL_FONT_SIZE_POINTS = 12;
const MIN_TERMINAL_FONT_SIZE_POINTS = 6;
const MAX_TERMINAL_FONT_SIZE_POINTS = 72;
const CSS_PIXELS_PER_POINT = 96 / 72;

function normalizeFontSizePoints(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TERMINAL_FONT_SIZE_POINTS;
  }
  return Math.min(MAX_TERMINAL_FONT_SIZE_POINTS, Math.max(MIN_TERMINAL_FONT_SIZE_POINTS, value));
}

function pointsToCssPixels(points: number): number {
  return points * CSS_PIXELS_PER_POINT;
}

function withCursorVisibility(theme: ITheme, suppressed: boolean): ITheme {
  if (!suppressed) return theme;
  return {
    ...theme,
    cursor: HIDDEN_CURSOR,
    cursorAccent: HIDDEN_CURSOR,
  };
}

export class TerminalManager {
  private terminals = new Map<TabId, TerminalEntry>();
  private container: HTMLElement;
  private onTitleChangeCallback: ((tabId: TabId, title: string) => void) | null = null;
  private fontFamily = "'Cascadia Code', 'Fira Code', Consolas, monospace";
  private fontSizePoints = DEFAULT_TERMINAL_FONT_SIZE_POINTS;
  private fontRefitRequest: number | null = null;
  private currentTheme: ResolvedTheme = 'dark';
  private terminalForeground = '';
  private terminalBackground = '';
  private newTabShortcut: NewTabShortcut = DEFAULT_NEW_TAB_SHORTCUT;

  constructor() {
    this.container = document.getElementById('terminal-container')!;
  }

  setOnTitleChange(callback: (tabId: TabId, title: string) => void): void {
    this.onTitleChangeCallback = callback;
  }

  create(tabId: TabId): Terminal {
    const element = document.createElement('div');
    element.className = 'terminal-wrapper';
    element.dataset.tabId = tabId;
    element.style.display = 'none';
    element.style.backgroundColor = this.getTerminalTheme().background ?? '';
    this.container.appendChild(element);

    // Mutable ref so all closures see the current ID after rekey
    const ref = { tabId };

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 1,
      fontSize: pointsToCssPixels(this.fontSizePoints),
      fontFamily: this.fontFamily,
      theme: this.getTerminalTheme(),
      // Generous scrollback: xterm clears the selection when selected rows
      // are trimmed out of scrollback, which made copy flaky during
      // long streaming output (#59)
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon((_event, url) => {
      window.codeherd.openExternal(url);
    }));

    terminal.open(element);

    // xterm keeps painting the highlight at the coordinates you selected, but
    // getSelection() reads whatever occupies those cells *now*. Claude repaints
    // constantly (spinner frames, streaming output), so by the time you press
    // Ctrl+C the rows underneath can have changed and the read comes back empty —
    // a copy that silently yields nothing. Capture the text while the selection is
    // fresh and fall back to it.
    let lastSelectionText = '';
    terminal.onSelectionChange(() => {
      const text = terminal.getSelection();
      if (text) lastSelectionText = text;
      else if (!terminal.hasSelection()) lastSelectionText = '';
    });
    const selectionText = (): string => terminal.getSelection() || lastSelectionText;

    // Clipboard and keyboard shortcut handling
    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;

      // Let F11 (fullscreen toggle) pass through to Electron menu
      if (e.key === 'F11') return false;

      // Let the configured New Tab shortcut pass through to the menu/renderer.
      // When remapped or disabled ('none'), Ctrl+T is NOT intercepted here, so
      // it reaches Claude Code's show/hide sub-agent tasks toggle (#69)
      if (matchesShortcut(this.newTabShortcut, e)) return false;

      // Let Ctrl/Cmd+W, Ctrl/Cmd+B, Ctrl/Cmd+, pass through to menu/renderer
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        if (e.key === 'w' || e.key === 'b' || e.key === ',') {
          return false;
        }
      }

      // Let Ctrl+Tab and Ctrl+Shift+Tab pass through for tab switching
      if (e.ctrlKey && e.key === 'Tab') return false;

      // Let Alt+1 through Alt+9 pass through for tab switching
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '9') return false;

      // Ctrl+Enter: send LF (newline) instead of CR so Claude Code inserts a new line
      if (e.ctrlKey && e.key === 'Enter') {
        window.codeherd.inputToTab(ref.tabId, '\n');
        return false;
      }

      // Ctrl+C / Ctrl+Shift+C: copy if selection exists.
      // key.toLowerCase() so CapsLock ('C' without shift) still matches (#59)
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c') {
        // Gate on hasSelection() rather than the extracted text so an active
        // selection can never degrade into a surprise SIGINT (#59)
        if (terminal.hasSelection()) {
          e.preventDefault();
          const selection = selectionText();
          if (selection) {
            // Keep the selection until the write is confirmed. Clearing it up front
            // meant a failed copy also destroyed what you had highlighted, forcing a
            // re-select before every retry (#59)
            void window.codeherd.clipboardWrite(selection).then((copied) => {
              if (copied) terminal.clearSelection();
            });
          }
          // Nothing extractable: keep the highlight rather than clearing it, so the
          // failure is visible instead of a silent no-op that also ate the selection.
          return false; // Don't send to PTY
        }
        if (e.shiftKey) return false; // Ctrl+Shift+C never sends to PTY
        return true; // No selection, send SIGINT normally
      }

      // Ctrl+V / Ctrl+Shift+V: paste from clipboard
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault(); // Prevent native paste (would double-paste)
        window.codeherd.clipboardRead().then(async (text) => {
          if (text) {
            // paste() normalizes newlines and wraps in bracketed-paste
            // markers so multi-line pastes arrive as one block (#71)
            terminal.paste(text);
          } else if (await window.codeherd.clipboardHasImage()) {
            // No text but an image on the clipboard: forward Claude Code's
            // image-paste shortcut (Alt+V = ESC v) so Ctrl+V muscle memory
            // works for screenshots too
            window.codeherd.inputToTab(ref.tabId, '\x1bv');
          }
        });
        return false;
      }

      // Alt+V: Claude Code's image-paste shortcut on Windows. Snipping Tool
      // publishes the capture to the clipboard slightly after its toast
      // (delayed rendering), so Claude Code's first read often finds no
      // image. Hold the keystroke until an image is actually readable
      // (short poll), then forward it; forward anyway on timeout so Claude
      // Code can show its own message.
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        (async () => {
          for (let i = 0; i < 15; i++) {
            if (await window.codeherd.clipboardHasImage()) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          window.codeherd.inputToTab(ref.tabId, '\x1bv');
        })();
        return false;
      }

      // Ctrl+Z: translate to Claude Code's undo binding (Ctrl+_, 0x1F) so
      // an accidental paste can be undone. Also keeps Ctrl+Z from reaching
      // the shell as SIGTSTP on macOS/Linux.
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        window.codeherd.inputToTab(ref.tabId, '\x1f');
        return false;
      }

      return true;
    });

    // Right-click: copy selection if there is one, otherwise paste
    // (Windows Terminal convention — gives a reliable copy/paste path, #59)
    element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Branch on hasSelection(), NEVER on the extracted text. Reading empty text
      // from a live selection used to fall through to the paste arm, dumping the
      // clipboard into the agent's composer when the user was trying to copy.
      if (terminal.hasSelection()) {
        const selection = selectionText();
        if (selection) {
          void window.codeherd.clipboardWrite(selection).then((copied) => {
            if (copied) terminal.clearSelection();
          });
        }
        return;
      }
      window.codeherd.clipboardRead().then((text) => {
        if (text) {
          terminal.paste(text);
        }
      });
    });

    // Forward user input to main process
    terminal.onData((data) => {
      window.codeherd.inputToTab(ref.tabId, data);
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (element.style.display !== 'none') {
          fitAddon.fit();
          window.codeherd.resizeTab(ref.tabId, terminal.cols, terminal.rows);
        }
      });
    });
    resizeObserver.observe(element);

    // Forward terminal title changes (Claude Code sets these via OSC sequences)
    terminal.onTitleChange((title) => {
      if (this.onTitleChangeCallback) {
        this.onTitleChangeCallback(ref.tabId, title);
      }
    });

    this.terminals.set(tabId, { terminal, fitAddon, element, cursorSuppressed: false, ref });

    return terminal;
  }

  show(tabId: TabId): void {
    for (const [id, entry] of this.terminals) {
      entry.element.style.display = id === tabId ? 'block' : 'none';
    }
    const entry = this.terminals.get(tabId);
    if (entry) {
      // Fit multiple times to handle layout settling on startup
      const fit = () => {
        entry.fitAddon.fit();
        window.codeherd.resizeTab(entry.ref.tabId, entry.terminal.cols, entry.terminal.rows);
        entry.terminal.focus();
      };
      requestAnimationFrame(fit);
      setTimeout(fit, 100);
    }
  }

  write(tabId: TabId, data: string): void {
    this.terminals.get(tabId)?.terminal.write(data);
  }

  focus(tabId: TabId): void {
    this.terminals.get(tabId)?.terminal.focus();
  }

  dispose(tabId: TabId): void {
    const entry = this.terminals.get(tabId);
    if (entry) {
      entry.terminal.dispose();
      entry.element.remove();
      this.terminals.delete(tabId);
    }
  }

  /** Get the current fitted dimensions for a terminal */
  getDimensions(tabId: TabId): { cols: number; rows: number } | null {
    const entry = this.terminals.get(tabId);
    if (!entry) return null;
    return { cols: entry.terminal.cols, rows: entry.terminal.rows };
  }

  has(tabId: TabId): boolean {
    return this.terminals.has(tabId);
  }

  setNewTabShortcut(shortcut: NewTabShortcut): void {
    this.newTabShortcut = shortcut;
  }

  setFontFamily(font: string): void {
    const DEFAULT_FONT = "'Cascadia Code', 'Fira Code', Consolas, monospace";
    const escapedFont = font.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    this.fontFamily = escapedFont ? `'${escapedFont}', ${DEFAULT_FONT}` : DEFAULT_FONT;
    for (const entry of this.terminals.values()) {
      entry.terminal.options.fontFamily = this.fontFamily;
    }
    this.refitVisibleTerminals();
  }

  setFontSize(points: number | undefined): void {
    this.fontSizePoints = normalizeFontSizePoints(points);
    const pixels = pointsToCssPixels(this.fontSizePoints);
    for (const entry of this.terminals.values()) {
      entry.terminal.options.fontSize = pixels;
    }
    this.refitVisibleTerminals();
  }

  private refitVisibleTerminals(): void {
    if (this.fontRefitRequest !== null) cancelAnimationFrame(this.fontRefitRequest);
    this.fontRefitRequest = requestAnimationFrame(() => {
      this.fontRefitRequest = null;
      for (const entry of this.terminals.values()) {
        if (entry.element.style.display === 'none') continue;
        entry.fitAddon.fit();
        window.codeherd.resizeTab(entry.ref.tabId, entry.terminal.cols, entry.terminal.rows);
      }
    });
  }

  setColors(foreground: string | undefined, background: string | undefined): void {
    this.terminalForeground = foreground?.trim() ?? '';
    this.terminalBackground = background?.trim() ?? '';
    const theme = this.getTerminalTheme();
    for (const entry of this.terminals.values()) {
      entry.terminal.options.theme = withCursorVisibility(theme, entry.cursorSuppressed);
      entry.element.style.backgroundColor = theme.background ?? '';
    }
  }

  private getTerminalTheme(): ITheme {
    const base = this.currentTheme === 'light' ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
    return {
      ...base,
      ...(this.terminalForeground ? { foreground: this.terminalForeground } : {}),
      ...(this.terminalBackground ? { background: this.terminalBackground } : {}),
    };
  }

  /**
   * Codex repeatedly shows the terminal cursor between animated redraw frames. While a
   * turn is active, hide that cursor at the renderer level; restore it at the composer.
   */
  setCursorSuppressed(tabId: TabId, suppressed: boolean): void {
    const entry = this.terminals.get(tabId);
    if (!entry || entry.cursorSuppressed === suppressed) return;
    entry.cursorSuppressed = suppressed;
    entry.terminal.options.cursorBlink = !suppressed;
    entry.terminal.options.theme = withCursorVisibility(this.getTerminalTheme(), suppressed);
  }

  setTheme(theme: ResolvedTheme): void {
    this.currentTheme = theme;
    const xtermTheme = this.getTerminalTheme();
    for (const entry of this.terminals.values()) {
      entry.terminal.options.theme = withCursorVisibility(xtermTheme, entry.cursorSuppressed);
      entry.element.style.backgroundColor = xtermTheme.background ?? '';
    }
  }
}
