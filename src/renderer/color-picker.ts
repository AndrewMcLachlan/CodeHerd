import type { TabId } from '../shared/types';
import { resolveTabColor, TAB_COLOR_OPTIONS } from '../shared/tab-colors';

interface PickerChoice {
  color: string | null;
  label: string;
  value?: string;
}
export class ColorPicker {
  private overlay: HTMLDivElement | null = null;
  private tabId: TabId | null = null;

  constructor(
    private onSelect: (tabId: TabId, color: string | null) => void,
    private onClose: (tabId: TabId) => void,
  ) {}

  open(tabId: TabId, currentColor?: string): void {
    this.close(false);
    this.tabId = tabId;

    const overlay = document.createElement('div');
    overlay.className = 'color-picker-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'color-picker-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'color-picker-title');

    const title = document.createElement('div');
    title.id = 'color-picker-title';
    title.className = 'color-picker-title';
    title.textContent = 'Set tab colour';

    const choices: PickerChoice[] = [
      { color: null, label: 'Default' },
      ...TAB_COLOR_OPTIONS.map(option => ({
        color: option.name,
        label: option.label,
        value: option.value,
      })),
    ];
    const currentValue = currentColor ? resolveTabColor(currentColor).toLowerCase() : null;

    const grid = document.createElement('div');
    grid.className = 'color-picker-grid';
    const buttons = choices.map((choice) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'color-picker-option';
      button.dataset.color = choice.color ?? '';
      const selected = choice.color === null ? !currentColor : choice.value === currentValue;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));

      const swatch = document.createElement('span');
      swatch.className = choice.color === null ? 'color-picker-swatch default' : 'color-picker-swatch';
      if (choice.value) swatch.style.background = choice.value;

      const label = document.createElement('span');
      label.textContent = choice.label;
      button.append(swatch, label);
      button.addEventListener('click', () => this.select(choice.color));
      grid.appendChild(button);
      return button;
    });

    const hint = document.createElement('div');
    hint.className = 'color-picker-hint';
    hint.textContent = 'Arrow keys to navigate · Enter to select · Esc to cancel';

    dialog.append(title, grid, hint);
    overlay.appendChild(dialog);
    document.getElementById('terminal-container')!.appendChild(overlay);
    this.overlay = overlay;

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this.close();
    });
    overlay.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }
      const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
      let next = current;
      if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
      else if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
      else if (event.key === 'ArrowUp') next = (current - 3 + buttons.length) % buttons.length;
      else if (event.key === 'ArrowDown') next = (current + 3) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else return;
      event.preventDefault();
      buttons[next].focus();
    });

    const initial = buttons.find(button => button.classList.contains('selected')) ?? buttons[0];
    requestAnimationFrame(() => initial.focus());
  }

  close(restoreFocus = true): void {
    const tabId = this.tabId;
    this.overlay?.remove();
    this.overlay = null;
    this.tabId = null;
    if (restoreFocus && tabId) this.onClose(tabId);
  }

  private select(color: string | null): void {
    const tabId = this.tabId;
    if (!tabId) return;
    this.onSelect(tabId, color);
    this.close();
  }
}
