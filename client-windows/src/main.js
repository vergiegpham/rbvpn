const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const Store = require('electron-store');

const store = new Store({ name: 'rbvpn' });
const CONF_NAME = 'RB-VPN.conf';

function confPath() {
  return path.join(app.getPath('userData'), CONF_NAME);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 640,
    resizable: false,
    title: 'RB-VPN',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-settings', () => ({
  apiUrl: store.get('apiUrl', 'http://localhost:4000'),
  token: store.get('token', ''),
  email: store.get('email', ''),
  deviceId: store.get('deviceId', ''),
}));

ipcMain.handle('save-settings', (_e, data) => {
  if (data.apiUrl != null) store.set('apiUrl', data.apiUrl);
  if (data.token != null) store.set('token', data.token);
  if (data.email != null) store.set('email', data.email);
  if (data.deviceId != null) store.set('deviceId', data.deviceId);
  return true;
});

ipcMain.handle('logout', () => {
  store.delete('token');
  store.delete('email');
  store.delete('deviceId');
  return true;
});

async function api(pathname, { method = 'GET', body, token, apiUrl } = {}) {
  const base = apiUrl || store.get('apiUrl', 'http://localhost:4000');
  const headers = { 'Content-Type': 'application/json' };
  const auth = token || store.get('token');
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

ipcMain.handle('login', async (_e, { email, password, apiUrl }) => {
  if (apiUrl) store.set('apiUrl', apiUrl);
  const data = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    apiUrl: apiUrl || store.get('apiUrl'),
  });
  store.set('token', data.token);
  store.set('email', data.user.email);
  return data.user;
});

ipcMain.handle('fetch-subscription', async () => {
  return api('/api/plans/subscription');
});

ipcMain.handle('ensure-device', async () => {
  let deviceId = store.get('deviceId');
  if (!deviceId) {
    const list = await api('/api/devices');
    if (list.devices?.length) {
      deviceId = list.devices[0].id;
    } else {
      const created = await api('/api/devices', {
        method: 'POST',
        body: { name: `Windows-${require('os').hostname()}` },
      });
      deviceId = created.device.id;
    }
    store.set('deviceId', deviceId);
  }
  const config = await api(`/api/devices/${deviceId}/config`);
  fs.writeFileSync(confPath(), config.conf, 'utf8');
  return config;
});

function findWireGuardExe() {
  const candidates = [
    'C:\\\\Program Files\\\\WireGuard\\\\wireguard.exe',
    'C:\\\\Program Files (x86)\\\\WireGuard\\\\wireguard.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

ipcMain.handle('connect', async () => {
  const wg = findWireGuardExe();
  if (!wg) {
    return {
      ok: false,
      error:
        'WireGuard for Windows not found. Install from https://www.wireguard.com/install/ then retry.',
    };
  }
  if (!fs.existsSync(confPath())) {
    return { ok: false, error: 'No tunnel config. Fetch device config first.' };
  }

  // Install tunnel service (requires elevation). Alternative: open conf in WireGuard UI.
  return new Promise((resolve) => {
    execFile(
      wg,
      ['/installtunnelservice', confPath()],
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          // Fall back: open the conf so user can Activate in WireGuard Manager
          spawn(wg, [confPath()], { detached: true, stdio: 'ignore' }).unref();
          resolve({
            ok: true,
            mode: 'ui',
            message:
              'Opened WireGuard. If not connected, click Activate on the RB-VPN tunnel (may need admin).',
            detail: stderr || err.message,
          });
          return;
        }
        resolve({ ok: true, mode: 'service', message: 'Tunnel service installed/started.' });
      }
    );
  });
});

ipcMain.handle('disconnect', async () => {
  const wg = findWireGuardExe();
  if (!wg) return { ok: false, error: 'WireGuard not installed' };
  return new Promise((resolve) => {
    execFile(
      wg,
      ['/uninstalltunnelservice', 'RB-VPN'],
      { windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            error:
              'Could not stop tunnel service automatically. Deactivate RB-VPN in the WireGuard app.',
            detail: stderr || err.message,
          });
          return;
        }
        resolve({ ok: true });
      }
    );
  });
});

ipcMain.handle('show-conf-path', async () => {
  return confPath();
});
