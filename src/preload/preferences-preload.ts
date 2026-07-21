import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type { AgentAvailability, Preferences } from '../shared/types';

// Fetch resolved theme synchronously before page renders
let resolvedTheme: string = 'dark';
try {
  resolvedTheme = ipcRenderer.sendSync('theme:get-resolved-sync');
} catch { /* fallback to dark */ }

contextBridge.exposeInMainWorld('preferencesAPI', {
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  getAvailableAgents: (): Promise<AgentAvailability> => ipcRenderer.invoke(IPC.AGENT_GET_AVAILABLE),
  savePreferences: (prefs: Preferences) =>
    ipcRenderer.invoke('preferences:save', prefs),
  closeWindow: () => ipcRenderer.send('preferences:close'),
  getTheme: () => resolvedTheme,
});
