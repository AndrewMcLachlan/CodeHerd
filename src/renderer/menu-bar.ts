export interface MenuItem {
  label?: string;
  detail?: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  submenu?: MenuItem[];
}

export class AppMenu {
  private button: HTMLElement;
  private getItems: () => MenuItem[];
  private dropdownEl: HTMLElement | null = null;
  private submenuEl: HTMLElement | null = null;
  private isOpen = false;
  private submenuCloseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(getItems: () => MenuItem[]) {
    this.button = document.getElementById('app-menu-btn')!;
    this.getItems = getItems;

    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (
        this.isOpen &&
        !this.button.contains(e.target as Node) &&
        (!this.dropdownEl || !this.dropdownEl.contains(e.target as Node)) &&
        (!this.submenuEl || !this.submenuEl.contains(e.target as Node))
      ) {
        this.close();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  private cancelSubmenuClose(): void {
    if (this.submenuCloseTimer) {
      clearTimeout(this.submenuCloseTimer);
      this.submenuCloseTimer = null;
    }
  }

  private scheduleSubmenuClose(): void {
    this.cancelSubmenuClose();
    this.submenuCloseTimer = setTimeout(() => {
      this.closeSubmenu();
    }, 200);
  }

  private buildDropdown(items: MenuItem[], isSubmenu: boolean): HTMLElement {
    const dropdown = document.createElement('div');
    dropdown.className = 'app-menu-dropdown';

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'app-menu-separator';
        dropdown.appendChild(sep);
        continue;
      }

      const row = document.createElement('div');
      row.className = 'app-menu-item';
      if (item.disabled) row.classList.add('disabled');
      if (item.submenu) row.classList.add('has-submenu');

      const labelSpan = document.createElement('span');
      labelSpan.className = 'app-menu-label';
      labelSpan.textContent = item.label ?? null;
      row.appendChild(labelSpan);

      if (item.detail) {
        const detailSpan = document.createElement('span');
        detailSpan.className = 'app-menu-detail';
        detailSpan.textContent = item.detail;
        row.appendChild(detailSpan);
      }

      if (item.shortcut) {
        const shortcut = document.createElement('span');
        shortcut.className = 'app-menu-shortcut';
        shortcut.textContent = item.shortcut;
        row.appendChild(shortcut);
      }

      if (item.submenu) {
        const arrow = document.createElement('span');
        arrow.className = 'app-menu-arrow';
        arrow.textContent = '\u203a';
        row.appendChild(arrow);

        row.addEventListener('mouseenter', () => {
          this.cancelSubmenuClose();
          // Only rebuild if submenu isn't already showing for this item
          if (this.submenuEl && (this.submenuEl as any).__parentRow === row) return;
          this.closeSubmenu();
          const sub = this.buildDropdown(item.submenu!, true);
          (sub as any).__parentRow = row;
          const rowRect = row.getBoundingClientRect();
          sub.style.left = `${rowRect.right}px`;
          sub.style.top = `${rowRect.top}px`;

          sub.addEventListener('mouseenter', () => {
            this.cancelSubmenuClose();
          });
          sub.addEventListener('mouseleave', () => {
            this.scheduleSubmenuClose();
          });

          document.body.appendChild(sub);
          this.submenuEl = sub;
        });

        row.addEventListener('mouseleave', () => {
          this.scheduleSubmenuClose();
        });
      } else if (!isSubmenu) {
        // Only close submenu when hovering non-submenu items in the MAIN menu
        row.addEventListener('mouseenter', () => {
          this.scheduleSubmenuClose();
        });

        if (!item.disabled) {
          row.addEventListener('click', () => {
            this.close();
            item.action?.();
          });
        }
      } else {
        // Submenu items: just handle click, don't interfere with submenu visibility
        if (!item.disabled) {
          row.addEventListener('click', () => {
            this.close();
            item.action?.();
          });
        }
      }

      dropdown.appendChild(row);
    }

    return dropdown;
  }

  private open(): void {
    this.close();
    this.isOpen = true;
    this.button.classList.add('active');

    const items = this.getItems();
    const dropdown = this.buildDropdown(items, false);

    const rect = this.button.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom}px`;

    document.body.appendChild(dropdown);
    this.dropdownEl = dropdown;
  }

  private closeSubmenu(): void {
    this.cancelSubmenuClose();
    this.submenuEl?.remove();
    this.submenuEl = null;
  }

  private close(): void {
    this.isOpen = false;
    this.closeSubmenu();
    this.dropdownEl?.remove();
    this.dropdownEl = null;
    this.button.classList.remove('active');
  }
}
