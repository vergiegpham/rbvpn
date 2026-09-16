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
  tunnelStatus: () => ipcRenderer.invoke('tunnel-status'),
  showConfPath: () => ipcRenderer.invoke('show-conf-path'),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  getLogTail: () => ipcRenderer.invoke('get-log-tail'),
  openLog: () => ipcRenderer.invoke('open-log'),
  onConnectProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('connect-progress', handler);
    return () => ipcRenderer.removeListener('connect-progress', handler);
  },
});
