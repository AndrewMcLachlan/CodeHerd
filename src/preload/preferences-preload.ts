import { contextBridge, ipcRenderer } from 'electron';

// Fetch resolved theme synchronously before page renders
let resolvedTheme: string = 'dark';
try {
  resolvedTheme = ipcRenderer.sendSync('theme:get-resolved-sync');
} catch { /* fallback to dark */ }

contextBridge.exposeInMainWorld('preferencesAPI', {
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  savePreferences: (prefs: { warnBeforeClosingTabs: boolean; fontFamily: string; theme: string }) =>
    ipcRenderer.invoke('preferences:save', prefs),
  closeWindow: () => ipcRenderer.send('preferences:close'),
  getTheme: () => resolvedTheme,
});
