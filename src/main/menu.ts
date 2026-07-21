import { Menu, BrowserWindow, app } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type { AgentAvailability, AgentType, NewTabShortcut, RecentlyClosedTab } from '../shared/types';
import { getNewTabMenuOptions } from '../shared/agents';
import { DEFAULT_NEW_TAB_SHORTCUT, toAccelerator } from '../shared/shortcut';

export function buildAppMenu(
  getMainWindow: () => BrowserWindow | null,
  recentlyClosed: RecentlyClosedTab[] = [],
  newTabShortcut: NewTabShortcut = DEFAULT_NEW_TAB_SHORTCUT,
  availableAgents: AgentAvailability = { claude: false, codex: false },
  defaultAgent: AgentType = 'claude',
): Menu {
  // null for 'none' or any malformed value → register no accelerator, leaving
  // Ctrl+T free to reach Claude Code's sub-agent tasks toggle (#69)
  const newTabAccelerator = toAccelerator(newTabShortcut);
  const isMac = process.platform === 'darwin';
  const newTabItems: Electron.MenuItemConstructorOptions[] = getNewTabMenuOptions(
    availableAgents,
    defaultAgent,
  ).map((option, index) => ({
    label: option.label,
    enabled: option.agent !== null,
    ...(index === 0 && newTabAccelerator ? { accelerator: newTabAccelerator } : {}),
    click: () => {
      if (option.agent) getMainWindow()?.webContents.send('menu:open-folder', option.agent);
    },
  }));

  // On macOS the menu shows in the system menu bar, so keep it full.
  // On Windows/Linux we render a custom in-window menu bar, so the native
  // menu only exists to register keyboard accelerators.
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        ...newTabItems,
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
                label: `${item.agent === 'codex' ? 'Codex' : 'Claude'}: ${item.label} — ${item.folder}`,
                click: () => {
                  getMainWindow()?.webContents.send(IPC.MENU_RESTORE_RECENT, {
                    agent: item.agent,
                    folder: item.folder,
                    sessionId: item.sessionId,
                    index,
                  });
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
