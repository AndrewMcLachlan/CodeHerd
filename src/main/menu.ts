import { Menu, BrowserWindow, app } from 'electron';

export function buildAppMenu(getMainWindow: () => BrowserWindow | null): Menu {
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
        { type: 'separator' },
        { role: 'toggleDevTools' },
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
