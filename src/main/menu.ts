import { Menu, BrowserWindow, app } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type { RecentlyClosedTab } from '../shared/types';

export function buildAppMenu(getMainWindow: () => BrowserWindow | null, recentlyClosed: RecentlyClosedTab[] = []): Menu {
  const isMac = process.platform === 'darwin';

  // On macOS the menu shows in the system menu bar, so keep it full.
  // On Windows/Linux we render a custom in-window menu bar, so the native
  // menu only exists to register keyboard accelerators.
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            getMainWindow()?.webContents.send('menu:open-folder');
          },
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            getMainWindow()?.webContents.send('menu:close-tab');
          },
        },
        {
          label: 'Recently Closed',
          enabled: recentlyClosed.length > 0,
          submenu: recentlyClosed.length > 0
            ? recentlyClosed.map((item, index) => ({
                label: `${item.label} — ${item.folder}`,
                click: () => {
                  getMainWindow()?.webContents.send(IPC.MENU_RESTORE_RECENT, { folder: item.folder, sessionId: item.sessionId, index });
                },
              }))
            : [{ label: 'No recently closed tabs', enabled: false }],
        },
        { type: 'separator' },
        {
          label: 'Preferences',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            getMainWindow()?.webContents.send('menu:preferences');
          },
        },
        { type: 'separator' },
        isMac
          ? { role: 'close' }
          : { label: 'Exit', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            getMainWindow()?.webContents.send('menu:toggle-sidebar');
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        ...(!app.isPackaged ? [
          { type: 'separator' } as Electron.MenuItemConstructorOptions,
          { role: 'toggleDevTools' } as Electron.MenuItemConstructorOptions,
        ] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About CodeHerd',
          click: () => {
            getMainWindow()?.webContents.send('menu:about');
          },
        },
      ],
    },
  ];

  if (isMac) {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  return Menu.buildFromTemplate(template);
}
