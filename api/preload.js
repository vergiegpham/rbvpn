const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rbvpn', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  logout: () => ipcRenderer.invoke('logout'),
  login: (payload) => ipcRenderer.invoke('login', payload),
  fetchSubscription: () => ipcRenderer.invoke('fetch-subscription'),
  listNodes: () => ipcRenderer.invoke('list-nodes'),
  ensureDevice: (opts) => ipcRenderer.invoke('ensure-device', opts || {}),
  connect: () => ipcRenderer.invoke('connect'),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  showConfPath: () => ipcRenderer.invoke('show-conf-path'),
});
