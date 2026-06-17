const { contextBridge, ipcRenderer } = require('electron');

// The single, minimal surface the renderer is allowed to use. No Node, no
// network, no database handles cross this boundary — only these functions.
contextBridge.exposeInMainWorld('api', {
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  logout: () => ipcRenderer.invoke('auth:logout'),
  currentSession: () => ipcRenderer.invoke('auth:current'),
  getDashboard: () => ipcRenderer.invoke('dashboard:data'),
  navigate: (page) => ipcRenderer.invoke('app:navigate', page)
});
