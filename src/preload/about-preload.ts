import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

// Fetch resolved theme synchronously-ish before page renders
let resolvedTheme: string = 'dark';
try {
  resolvedTheme = ipcRenderer.sendSync('theme:get-resolved-sync');
} catch { /* fallback to dark */ }

// Any newer release found by the startup update check ({ version, url } or null)
let update: { version: string; url: string } | null = null;
try {
  update = ipcRenderer.sendSync(IPC.UPDATE_GET_SYNC);
} catch { /* treat as no update */ }

contextBridge.exposeInMainWorld('aboutInfo', {
  version: ipcRenderer.sendSync('about:get-version'),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  update,
  openGithub: () => ipcRenderer.send('about:open-github'),
  openUpdate: () => ipcRenderer.send(IPC.UPDATE_OPEN),
  closeWindow: () => ipcRenderer.send('about:close'),
  getTheme: () => resolvedTheme,
});
