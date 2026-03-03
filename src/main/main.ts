import { app, BrowserWindow, Menu, nativeTheme } from 'electron';
import * as path from 'path';
import { PtyManager } from './pty-manager';
import { StateManager } from './state-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { buildAppMenu } from './menu';
import type { ThemePreference, ResolvedTheme } from '../shared/types';

// In dev mode, use a separate user data directory so we can run alongside the installed app
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('userData'), '-dev'));
}

let mainWindow: BrowserWindow | null = null;
const ptyManager = new PtyManager();
const stateManager = new StateManager();

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return pref;
}

function getThemeColors(resolved: ResolvedTheme) {
  if (resolved === 'light') {
    return { bg: '#eff1f5', titleBar: '#dce0e8', symbolColor: '#4c4f69' };
  }
  return { bg: '#1e1e2e', titleBar: '#11111b', symbolColor: '#cdd6f4' };
}

// Enforce single instance (skip in dev to allow running alongside installed app)
const gotTheLock = app.isPackaged ? app.requestSingleInstanceLock() : true;
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createWindow(): void {
  const savedState = stateManager.getState();
  const bounds = savedState.windowBounds;
  const prefs = stateManager.getPreferences();

  // Configure nativeTheme based on preference
  nativeTheme.themeSource = prefs.theme === 'system' ? 'system' : prefs.theme;
  const resolved = resolveTheme(prefs.theme);
  const colors = getThemeColors(resolved);

  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    title: 'CodeHerd',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: colors.bg,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 10, y: 10 } }
      : { titleBarOverlay: { color: colors.titleBar, symbolColor: colors.symbolColor, height: 36 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (bounds.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Save window bounds on move/resize (debounced)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const saveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const wb = mainWindow.getBounds();
        stateManager.setWindowBounds({
          ...wb,
          isMaximized: mainWindow.isMaximized(),
        });
        stateManager.save();
      }
    }, 1000);
  };
  mainWindow.on('move', saveBounds);
  mainWindow.on('resize', saveBounds);

  // Intercept window close to do graceful PTY shutdown
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      isQuitting = true;

      // Hide window immediately so it feels instant
      mainWindow?.hide();

      // Hard safety net: force exit after 5 seconds no matter what
      setTimeout(() => process.exit(0), 5000);

      // Graceful shutdown, then exit (no async/await - use promise chain)
      ptyManager.gracefulKillAll()
        .catch(() => {})
        .finally(() => {
          mainWindow?.destroy();
          app.exit(0);
        });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Listen for OS theme changes when preference is 'system'
  nativeTheme.on('updated', () => {
    const currentPrefs = stateManager.getPreferences();
    if (currentPrefs.theme === 'system' && mainWindow && !mainWindow.isDestroyed()) {
      const newResolved = resolveTheme('system');
      const newColors = getThemeColors(newResolved);
      mainWindow.webContents.send('theme:changed', newResolved);
      if (process.platform !== 'darwin') {
        mainWindow.setTitleBarOverlay({
          color: newColors.titleBar,
          symbolColor: newColors.symbolColor,
        });
      }
    }
  });
}

let isQuitting = false;

app.whenReady().then(() => {
  registerIpcHandlers(ptyManager, stateManager, () => mainWindow);
  Menu.setApplicationMenu(buildAppMenu(() => mainWindow));
  createWindow();
});

app.on('window-all-closed', () => {
  if (isQuitting) {
    app.exit(0);
  }
});
