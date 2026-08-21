import { app, BrowserWindow, Menu, dialog, nativeTheme } from 'electron';
import type { RecentlyClosedTab, TabState } from '../shared/types';
import * as path from 'path';
import { PtyManager } from './pty-manager';
import { StateManager } from './state-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { buildShutdownPrompt, selectBusyTabs } from './shutdown-guard';
import { routeLinksToBrowser } from './external-links';
import { buildAppMenu } from './menu';
import { detectAvailableAgents } from './agent-detection';
import { checkForUpdate } from './update-checker';
import {
  cleanPtyDebugLogs,
  isPtyDebugEnabled,
  isDiagnosticsEnabled,
  isDiagnosticsRecording,
  diagnosticsLogPath,
  startDiagnostics,
} from './diagnostics';
import { IPC } from '../shared/ipc-channels';
import { STATE_DIR } from '../shared/constants';
import { handleSquirrelEvent } from './squirrel-startup';
import type { ThemePreference, ResolvedTheme } from '../shared/types';

// The Squirrel installer relaunches the exe with --squirrel-* flags during
// install/update/uninstall; do the shortcut work and exit before any window.
if (handleSquirrelEvent()) {
  app.quit();
}

// In dev mode, use a separate user data directory so we can run alongside the installed app
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('userData'), '-dev'));
}

// Dev runs use ~/.codeherd-dev so they never touch the installed app's settings
// (parallel to the userData split above). Pass --live-state (npm run dev:live) to
// point a dev run at the real ~/.codeherd instead — useful for reproducing a bug against
// your actual tabs. Quit the installed app first: both write state.json, last one wins.
const useLiveState = app.isPackaged || process.argv.includes('--live-state');

let mainWindow: BrowserWindow | null = null;
// Tells the UI that recording has begun. Replaced once the menu builder exists;
// until then a second-instance flag has no UI to update yet.
let announceDiagnostics: () => void = () => {};
// Set once the IPC layer is registered. Defaults to an empty list so the close
// handler can never block a quit on state that doesn't exist yet.
let getTabs: () => TabState[] = () => [];
const ptyManager = new PtyManager();
const stateManager = new StateManager(useLiveState ? STATE_DIR : `${STATE_DIR}-dev`);

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
  // quit() is not immediate: without this guard the losing process still reached
  // whenReady, armed the diagnostics recorder, and wrote a "started" line into the
  // shared log moments before exiting — a log that then recorded nothing.
  app.quit();
}

app.on('second-instance', (_event, argv) => {
  // A shortcut carrying --diagnostics cannot start a second copy: the lock above
  // sends it here and the new process dies. Honour the flag in the instance that is
  // actually running, otherwise clicking that shortcut silently does nothing (and
  // worse, the doomed process wrote a "started" line into the log before exiting).
  // argv only — the second instance's environment does not reach us.
  if (isDiagnosticsEnabled({}, argv) && !isDiagnosticsRecording()) {
    startDiagnostics(app.getPath('userData'));
    announceDiagnostics();
  }

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Set dock icon in dev mode on macOS (packaged apps use the bundled .icns)
if (process.platform === 'darwin' && !app.isPackaged) {
  app.dock?.setIcon(path.join(__dirname, '..', 'assets', 'icon-mac.png'));
}

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
    icon: path.join(__dirname, '..', 'assets', isMac ? 'icon-mac.png' : 'icon.png'),
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

  // Links must reach the default browser, never open a frameless app window or
  // replace the UI. Dropping a link on the window is the easy way to hit the latter.
  routeLinksToBrowser(mainWindow.webContents);

  if (bounds.isMaximized) {
    mainWindow.maximize();
  }

  if (isStylingMode) {
    mainWindow.loadFile(path.join(__dirname, 'index.html'), { query: { styling: '1' } });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  // Save window bounds on move/resize (debounced)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const saveBounds = () => {
    if (isStylingMode) return;
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

      // Confirm before cutting off an agent mid-turn. Checked before isQuitting is
      // set so cancelling leaves the window fully usable rather than half-shut.
      const prompt = buildShutdownPrompt(selectBusyTabs(getTabs()));
      if (prompt && mainWindow && !mainWindow.isDestroyed()) {
        const choice = dialog.showMessageBoxSync(mainWindow, {
          type: 'question',
          buttons: ['Quit anyway', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
          title: 'Agents still working',
          message: prompt.message,
          detail: prompt.detail,
        });
        if (choice !== 0) return; // Cancelled — stay open, still not quitting.
      }

      isQuitting = true;

      // Hide window immediately so it feels instant
      mainWindow?.hide();

      // Hard safety net: force exit after 5 seconds no matter what
      setTimeout(() => process.exit(0), 5000);

      // Persist current tab state before killing PTYs, so tabs can be restored on restart.
      // (gracefulKill sets status to 'stopped', which would prevent restoration.)
      stateManager.save();

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
const isStylingMode = process.argv.includes('--styling');

app.whenReady().then(() => {
  // The losing instance of a single-instance race is on its way out; starting the
  // recorder or building a window here would only corrupt the real instance's log.
  if (!gotTheLock) return;

  // Older releases wrote raw PTY logs unconditionally; reclaim the space unless
  // the user is actively debugging this run.
  if (!isPtyDebugEnabled()) {
    cleanPtyDebugLogs(app.getPath('userData'));
  }

  // Arm the recorder before any window exists, so a fault during startup is captured
  // too. Raw PTY debugging implies wanting the timeline alongside it.
  if (isDiagnosticsEnabled() || isPtyDebugEnabled()) {
    startDiagnostics(app.getPath('userData'));
  }

  const initialState = stateManager.getState();
  const availableAgents = detectAvailableAgents();
  // Kept up to date by rebuildMenu so a preferences-triggered rebuild
  // doesn't lose the Recently Closed submenu
  let recentlyClosed: RecentlyClosedTab[] = initialState.recentlyClosed;
  const rebuildMenu = (items?: RecentlyClosedTab[]) => {
    if (items) recentlyClosed = items;
    const prefs = stateManager.getPreferences();
    Menu.setApplicationMenu(buildAppMenu(
      () => mainWindow,
      recentlyClosed,
      prefs.newTabShortcut,
      availableAgents,
      prefs.defaultAgent,
    ));
  };
  // Recording can begin after startup, when a --diagnostics shortcut is clicked at
  // an already-running app. Both the badge and the menu entry have to catch up.
  announceDiagnostics = () => {
    rebuildMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.DIAGNOSTICS_STARTED, {
        logPath: diagnosticsLogPath(app.getPath('userData')),
      });
    }
  };

  const ipc = registerIpcHandlers(ptyManager, stateManager, () => mainWindow, () => isQuitting, rebuildMenu);
  getTabs = ipc.getTabs;
  rebuildMenu();
  createWindow();

  // Check GitHub for a newer release a few seconds after startup (non-blocking,
  // fails silently when offline). Skipped in dev — the local version isn't
  // meaningful there — unless forced for manual testing.
  if (app.isPackaged || process.env.CODEHERD_FORCE_UPDATE_CHECK) {
    setTimeout(() => {
      checkForUpdate(app.getVersion()).then((update) => {
        if (!update) return;
        // Don't re-notify for a version the user already dismissed
        if (update.version === stateManager.getState().dismissedUpdateVersion) return;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.UPDATE_AVAILABLE, update);
        }
      });
    }, 5000);
  }
});

app.on('window-all-closed', () => {
  if (isQuitting) {
    app.exit(0);
  }
});
