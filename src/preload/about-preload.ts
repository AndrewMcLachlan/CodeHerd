import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('aboutInfo', {
  version: ipcRenderer.sendSync('about:get-version'),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  openGithub: () => ipcRenderer.send('about:open-github'),
  closeWindow: () => ipcRenderer.send('about:close'),
});
