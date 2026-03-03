import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

// Fetch resolved theme synchronously-ish before page renders
let resolvedTheme: string = 'dark';
try {
  resolvedTheme = ipcRenderer.sendSync('theme:get-resolved-sync');
} catch { /* fallback to dark */ }

contextBridge.exposeInMainWorld('aboutInfo', {
  version: ipcRenderer.sendSync('about:get-version'),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  openGithub: () => ipcRenderer.send('about:open-github'),
  closeWindow: () => ipcRenderer.send('about:close'),
  getTheme: () => resolvedTheme,
});
