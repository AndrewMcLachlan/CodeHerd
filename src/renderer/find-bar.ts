import type { ISearchOptions, SearchAddon } from '@xterm/addon-search';
import type { TabId } from '../shared/types';
import type { TerminalManager } from './terminal-manager';

// Decoration colors per theme (Catppuccin Mocha / Latte, matching the
// terminal themes in terminal-manager.ts). Backgrounds must be #RRGGBB.
const DARK_DECORATIONS: ISearchOptions['decorations'] = {
  matchBackground: '#45475a',
  matchOverviewRuler: '#f9e2af',
  activeMatchBorder: '#f9e2af',
  activeMatchColorOverviewRuler: '#fab387',
};

const LIGHT_DECORATIONS: ISearchOptions['decorations'] = {
  matchBackground: '#ccd0da',
  matchOverviewRuler: '#df8e1d',
  activeMatchBorder: '#df8e1d',
  activeMatchColorOverviewRuler: '#fe640b',
};

/**
 * Find-in-session bar (#72). Overlaid at the top-right of the terminal
 * area; searches the active terminal's buffer via @xterm/addon-search.
 * Hidden by default, so it never intercepts keystrokes destined for the
 * terminal unless it is open and its input is focused.
 */
export class FindBar {
  private bar: HTMLElement;
  private input: HTMLInputElement;
  private countEl: HTMLElement;
  private caseBtn: HTMLButtonElement;
  private wordBtn: HTMLButtonElement;
  private tabId: TabId | null = null;
  private resultsSubscription: { dispose(): void } | null = null;
  private caseSensitive = false;
  private wholeWord = false;

  constructor(private terminalManager: TerminalManager) {
    this.bar = document.getElementById('find-bar')!;
    this.input = document.getElementById('find-input') as HTMLInputElement;
    this.countEl = document.getElementById('find-count')!;
    this.caseBtn = document.getElementById('find-case') as HTMLButtonElement;
    this.wordBtn = document.getElementById('find-word') as HTMLButtonElement;

    // Incremental search as the user types
    this.input.addEventListener('input', () => this.search(true));

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this.findPrevious();
        } else {
          this.findNext();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    this.caseBtn.addEventListener('click', () => {
      this.caseSensitive = !this.caseSensitive;
      this.caseBtn.classList.toggle('active', this.caseSensitive);
      this.search(true);
      this.input.focus();
    });

    this.wordBtn.addEventListener('click', () => {
      this.wholeWord = !this.wholeWord;
      this.wordBtn.classList.toggle('active', this.wholeWord);
      this.search(true);
      this.input.focus();
    });

    document.getElementById('find-prev')!.addEventListener('click', () => {
      this.findPrevious();
      this.input.focus();
    });

    document.getElementById('find-next')!.addEventListener('click', () => {
      this.findNext();
      this.input.focus();
    });

    document.getElementById('find-close')!.addEventListener('click', () => this.close());
  }

  /** Open (or refocus) the find bar for the given tab's terminal */
  open(tabId: TabId): void {
    if (this.tabId !== tabId) {
      this.detach();
      this.tabId = tabId;
      const addon = this.addon();
      if (addon) {
        this.resultsSubscription = addon.onDidChangeResults((e) => {
          this.updateCount(e.resultIndex, e.resultCount);
        });
      }
    }
    this.bar.classList.remove('hidden');
    this.input.focus();
    this.input.select();
    if (this.input.value) {
      this.search(true);
    }
  }

  /** Close and return focus to the terminal (Escape / close button) */
  close(): void {
    const tabId = this.tabId;
    this.hide();
    if (tabId) {
      this.terminalManager.focus(tabId);
    }
  }

  /**
   * Hide without focusing the terminal — used when tabs are switched or
   * all tabs are closed (whoever triggered that manages focus itself).
   */
  hide(): void {
    this.detach();
    this.tabId = null;
    this.bar.classList.add('hidden');
  }

  private detach(): void {
    this.resultsSubscription?.dispose();
    this.resultsSubscription = null;
    // Addon is null if the terminal was already disposed (tab closed)
    this.addon()?.clearDecorations();
    this.countEl.textContent = '';
  }

  private addon(): SearchAddon | null {
    return this.tabId ? this.terminalManager.getSearchAddon(this.tabId) : null;
  }

  private options(incremental: boolean): ISearchOptions {
    const isLight = document.documentElement.dataset.theme === 'light';
    return {
      caseSensitive: this.caseSensitive,
      wholeWord: this.wholeWord,
      incremental,
      decorations: isLight ? LIGHT_DECORATIONS : DARK_DECORATIONS,
    };
  }

  /** Run/refresh the search for the current input value */
  private search(incremental: boolean): void {
    const addon = this.addon();
    if (!addon) return;
    const term = this.input.value;
    if (!term) {
      addon.clearDecorations();
      this.countEl.textContent = '';
      return;
    }
    addon.findNext(term, this.options(incremental));
  }

  private findNext(): void {
    const addon = this.addon();
    if (addon && this.input.value) {
      addon.findNext(this.input.value, this.options(false));
    }
  }

  private findPrevious(): void {
    const addon = this.addon();
    if (addon && this.input.value) {
      addon.findPrevious(this.input.value, this.options(false));
    }
  }

  private updateCount(resultIndex: number, resultCount: number): void {
    if (!this.input.value) {
      this.countEl.textContent = '';
    } else if (resultCount === 0) {
      this.countEl.textContent = 'No results';
    } else if (resultIndex === -1) {
      // Match count exceeded the addon's highlight limit
      this.countEl.textContent = `${resultCount}+`;
    } else {
      this.countEl.textContent = `${resultIndex + 1}/${resultCount}`;
    }
  }
}
