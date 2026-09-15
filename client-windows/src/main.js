const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const Store = require('electron-store');
const { ensureRuntimeInstaller } = require('./runtime');
const { log, logPath, clearLog, readLogTail } = require('./log');

const store = new Store({ name: 'rbvpn' });
const TUNNEL_NAME = 'RB-VPN';
const CONF_NAME = `${TUNNEL_NAME}.conf`;
const DEFAULT_API = process.env.RBVPN_API_URL || 'http://162.35.175.39:4000';

let mainWindow = null;

function confPath() {
  return path.join(app.getPath('userData'), CONF_NAME);
}

function findTunnelHelper() {
  const candidates = [
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'WireGuard', 'wireguard.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'WireGuard', 'wireguard.exe'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function progress(step, message) {
  log('info', step, message);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('connect-progress', { step, message });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
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
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  log('info', 'app-ready', { logFile: logPath(), userData: app.getPath('userData') });
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-settings', () => ({
  apiUrl: store.get('apiUrl', DEFAULT_API),
  token: store.get('token', ''),
  email: store.get('email', ''),
  deviceId: store.get('deviceId', ''),
  nodeId: store.get('nodeId', ''),
}));

ipcMain.handle('save-settings', (_e, data) => {
  if (data.apiUrl != null) store.set('apiUrl', data.apiUrl);
  if (data.token != null) store.set('token', data.token);
  if (data.email != null) store.set('email', data.email);
  if (data.deviceId != null) store.set('deviceId', data.deviceId);
  if (data.nodeId != null) store.set('nodeId', data.nodeId);
  return true;
});

ipcMain.handle('logout', () => {
  store.delete('token');
  store.delete('email');
  store.delete('deviceId');
  return true;
});

async function api(pathname, { method = 'GET', body, token, apiUrl } = {}) {
  const base = apiUrl || store.get('apiUrl', DEFAULT_API);
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
    apiUrl: apiUrl || store.get('apiUrl', DEFAULT_API),
  });
  store.set('token', data.token);
  store.set('email', data.user.email);
  return data.user;
});

ipcMain.handle('fetch-subscription', async () => api('/api/plans/subscription'));

ipcMain.handle('list-nodes', async () => api('/api/devices/nodes/list'));

ipcMain.handle('ensure-device', async (_e, { nodeId } = {}) => {
  progress('ensure-device', 'Preparing device profile…');
  const preferredNodeId = nodeId || store.get('nodeId') || '';
  if (preferredNodeId) store.set('nodeId', preferredNodeId);

  let deviceId = store.get('deviceId');
  const list = await api('/api/devices');
  let device = list.devices?.find((d) => d.id === deviceId) || list.devices?.[0];
  log('info', 'ensure-device:listed', {
    count: list.devices?.length || 0,
    deviceId,
    preferredNodeId,
  });

  if (!device) {
    progress('ensure-device', 'Creating device on server…');
    const created = await api('/api/devices', {
      method: 'POST',
      body: {
        name: `Windows-${require('os').hostname()}`,
        nodeId: preferredNodeId || undefined,
      },
    });
    device = created.device;
    deviceId = device.id;
    store.set('deviceId', deviceId);
    log('info', 'ensure-device:created', { deviceId, syncStatus: device.syncStatus });
  } else {
    deviceId = device.id;
    store.set('deviceId', deviceId);
    if (preferredNodeId && device.node?.id && preferredNodeId !== device.node.id) {
      progress('ensure-device', 'Switching server node…');
      const switched = await api(`/api/devices/${deviceId}/node`, {
        method: 'POST',
        body: { nodeId: preferredNodeId },
      });
      device = switched.device;
      deviceId = device.id;
      store.set('deviceId', deviceId);
      log('info', 'ensure-device:switched-node', { deviceId, nodeId: preferredNodeId });
    }
  }

  const config = await api(`/api/devices/${deviceId}/config`);
  fs.writeFileSync(confPath(), config.conf, 'utf8');
  log('info', 'ensure-device:config-written', {
    conf: confPath(),
    syncStatus: config.syncStatus,
    endpoint: config.endpoint,
    address: config.address,
  });
  return {
    deviceId: config.deviceId,
    name: config.name,
    region: config.region,
    nodeName: config.nodeName,
    endpoint: config.endpoint,
    address: config.address,
    syncStatus: config.syncStatus,
  };
});

function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function quoteCmd(arg) {
  const s = String(arg);
  if (/[\s"&^<>|]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Elevate a plain .cmd script (one UAC). Avoids PowerShell -EncodedCommand /
 * -ExecutionPolicy Bypass / registry scraping — patterns many AVs flag.
 */
function elevatedBatch(lines, label = 'rbvpn-task') {
  const bat = path.join(app.getPath('temp'), `${label}.cmd`);
  const body = ['@echo off', 'setlocal', ...lines, 'exit /b %ERRORLEVEL%'].join('\r\n');
  fs.writeFileSync(bat, body, 'utf8');
  log('info', 'elevate:batch', { bat, lines: lines.length });

  const batArg = bat.replace(/'/g, "''");
  const ps = [
    `$p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', '${batArg}') -Verb RunAs -Wait -WindowStyle Hidden -PassThru`,
    'if ($null -eq $p) { exit 1 }',
    'exit $p.ExitCode',
  ].join('; ');
  return execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps]).finally(() => {
    try {
      fs.unlinkSync(bat);
    } catch {
      // ignore
    }
  });
}

/** Elevate a single program with args (one UAC). */
function elevatedExec(file, args) {
  const parts = [quoteCmd(file), ...args.map(quoteCmd)];
  return elevatedBatch([parts.join(' ')], 'rbvpn-exec');
}

/** One UAC: refresh RB-VPN tunnel service using wireguard.exe only. */
function elevatedApplyTunnel(helper, confFile) {
  return elevatedBatch(
    [
      `${quoteCmd(helper)} /uninstallmanagerservice`,
      `${quoteCmd(helper)} /uninstalltunnelservice ${quoteCmd(TUNNEL_NAME)}`,
      `${quoteCmd(helper)} /installtunnelservice ${quoteCmd(confFile)}`,
    ],
    'rbvpn-apply-tunnel'
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForDeviceSynced(deviceId, { timeoutMs = 45000 } = {}) {
  const started = Date.now();
  let last = null;
  progress('sync', 'Waiting for server to register your peer…');
  while (Date.now() - started < timeoutMs) {
    last = await api(`/api/devices/${deviceId}/config`);
    log('info', 'sync:poll', { syncStatus: last.syncStatus, elapsedMs: Date.now() - started });
    if (last.syncStatus === 'synced') {
      progress('sync', 'Peer registered on server');
      return last;
    }
    if (last.syncStatus === 'delete_pending') {
      throw new Error('Device was removed. Try Connect again.');
    }
    progress('sync', `Waiting for server sync… (${last.syncStatus || 'pending'})`);
    await sleep(2000);
  }
  log('error', 'sync:timeout', { syncStatus: last?.syncStatus, deviceId });
  throw new Error(
    'Server is still preparing your connection. Wait a few seconds and click Connect again.'
  );
}

async function ensureTunnelRuntime() {
  let helper = findTunnelHelper();
  if (helper) {
    log('info', 'runtime:found', helper);
    return { ok: true, helper };
  }

  progress('runtime', 'Network runtime missing — installing (approve UAC if asked)…');
  let installer;
  try {
    installer = ensureRuntimeInstaller();
    log('info', 'runtime:installer', installer);
  } catch (err) {
    log('error', 'runtime:missing-installer', err.message);
    return {
      ok: false,
      error: err.message,
    };
  }

  // One UAC: install runtime MSI (hidden from Apps list) + disable tray manager.
  const wg64 = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'WireGuard', 'wireguard.exe');
  const wg86 = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'WireGuard',
    'wireguard.exe'
  );
  progress('runtime', 'Waiting for administrator approval (UAC)…');
  const result = await elevatedBatch(
    [
      `msiexec /i ${quoteCmd(installer)} /qn /norestart ARPSYSTEMCOMPONENT=1`,
      `if exist ${quoteCmd(wg64)} ${quoteCmd(wg64)} /uninstallmanagerservice`,
      `if exist ${quoteCmd(wg86)} ${quoteCmd(wg86)} /uninstallmanagerservice`,
    ],
    'rbvpn-install-runtime'
  );
  log('info', 'runtime:install-result', {
    err: result.err && result.err.message,
    stderr: result.stderr,
  });

  helper = findTunnelHelper();
  if (!helper) {
    return {
      ok: false,
      error:
        'Could not install network components. Approve the administrator prompt and try again.',
      detail: result.stderr || (result.err && result.err.message),
    };
  }
  return { ok: true, helper };
}

ipcMain.handle('connect', async () => {
  clearLog();
  progress('connect', 'Connect started');
  log('info', 'connect:begin', {
    conf: confPath(),
    confExists: fs.existsSync(confPath()),
    deviceId: store.get('deviceId'),
    helper: findTunnelHelper(),
  });

  if (!fs.existsSync(confPath())) {
    return { ok: false, error: 'No connection profile yet. Sign in and try Connect again.' };
  }

  const deviceId = store.get('deviceId');
  if (deviceId) {
    try {
      const config = await waitForDeviceSynced(deviceId);
      fs.writeFileSync(confPath(), config.conf, 'utf8');
    } catch (err) {
      log('error', 'connect:sync-failed', err.message);
      return { ok: false, error: err.message };
    }
  }

  const runtime = await ensureTunnelRuntime();
  if (!runtime.ok) {
    log('error', 'connect:runtime-failed', runtime);
    return runtime;
  }

  progress('tunnel', 'Starting tunnel — approve UAC if prompted…');
  let result = await elevatedApplyTunnel(runtime.helper, confPath());
  log('info', 'connect:elevated-result', {
    err: result.err && result.err.message,
    stderr: result.stderr,
    stdout: result.stdout,
  });
  if (result.err) {
    progress('tunnel', 'Elevated start failed — trying without UAC…');
    await execFileAsync(runtime.helper, ['/uninstallmanagerservice']);
    await execFileAsync(runtime.helper, ['/uninstalltunnelservice', TUNNEL_NAME]);
    result = await execFileAsync(runtime.helper, ['/installtunnelservice', confPath()]);
    log('info', 'connect:fallback-result', {
      err: result.err && result.err.message,
      stderr: result.stderr,
    });
  }
  if (result.err) {
    log('error', 'connect:failed', result.stderr || (result.err && result.err.message));
    return {
      ok: false,
      error:
        'Could not start the RB-VPN tunnel. Approve the administrator prompt, then click Connect again.',
      detail: result.stderr || (result.err && result.err.message),
      logFile: logPath(),
    };
  }

  progress('connect', 'Connected');
  return { ok: true, mode: 'service', message: 'Connected', logFile: logPath() };
});

ipcMain.handle('disconnect', async () => {
  progress('disconnect', 'Disconnecting…');
  const helper = findTunnelHelper();
  if (!helper) return { ok: false, error: 'RB-VPN network runtime not found' };

  let result = await elevatedExec(helper, ['/uninstalltunnelservice', TUNNEL_NAME]);
  if (result.err) {
    result = await execFileAsync(helper, ['/uninstalltunnelservice', TUNNEL_NAME]);
  }
  if (result.err) {
    log('error', 'disconnect:failed', result.stderr || result.err.message);
    return {
      ok: false,
      error: 'Could not stop the tunnel automatically. Try Connect again or restart the app as admin.',
      detail: result.stderr || result.err.message,
      logFile: logPath(),
    };
  }
  progress('disconnect', 'Disconnected');
  return { ok: true, logFile: logPath() };
});

ipcMain.handle('show-conf-path', async () => confPath());
ipcMain.handle('get-log-path', async () => logPath());
ipcMain.handle('get-log-tail', async () => ({ path: logPath(), text: readLogTail() }));
ipcMain.handle('open-log-folder', async () => {
  const { shell } = require('electron');
  await shell.showItemInFolder(logPath());
  return logPath();
});
