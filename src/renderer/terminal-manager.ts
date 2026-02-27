import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { TabId } from '../shared/types';

interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLDivElement;
  /** Mutable reference so closures always see the current tab ID */
  ref: { tabId: TabId };
}

export class TerminalManager {
  private terminals = new Map<TabId, TerminalEntry>();
  private container: HTMLElement;
  private onTitleChangeCallback: ((tabId: TabId, title: string) => void) | null = null;

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
    this.container.appendChild(element);

    // Mutable ref so all closures see the current ID after rekey
    const ref = { tabId };

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      theme: {
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
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(element);

    // Clipboard and keyboard shortcut handling
    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;

      // Let F11 (fullscreen toggle) pass through to Electron menu
      if (e.key === 'F11') return false;

      // Let Ctrl/Cmd+T, Ctrl/Cmd+W, Ctrl/Cmd+B pass through to menu/renderer
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        if (e.key === 't' || e.key === 'w' || e.key === 'b') {
          return false;
        }
      }

      // Ctrl+C: copy if selection exists
      if (e.ctrlKey && e.key === 'c') {
        const selection = terminal.getSelection();
        if (selection) {
          window.codeherd.clipboardWrite(selection);
          terminal.clearSelection();
          return false; // Don't send to PTY
        }
        return true; // No selection, send SIGINT normally
      }

      // Ctrl+V: paste from clipboard
      if (e.ctrlKey && e.key === 'v') {
        window.codeherd.clipboardRead().then((text) => {
          if (text) {
            window.codeherd.inputToTab(ref.tabId, text);
          }
        });
        return false;
      }

      // Ctrl+Shift+C: always copy
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        const selection = terminal.getSelection();
        if (selection) {
          window.codeherd.clipboardWrite(selection);
          terminal.clearSelection();
        }
        return false;
      }

      // Ctrl+Shift+V: always paste
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        window.codeherd.clipboardRead().then((text) => {
          if (text) {
            window.codeherd.inputToTab(ref.tabId, text);
          }
        });
        return false;
      }

      return true;
    });

    // Right-click: copy selection
    element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const selection = terminal.getSelection();
      if (selection) {
        window.codeherd.clipboardWrite(selection);
        terminal.clearSelection();
      }
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

    this.terminals.set(tabId, { terminal, fitAddon, element, ref });

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
}
