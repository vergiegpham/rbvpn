const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
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
let tray = null;
let isQuitting = false;
let quittingAfterTunnelStop = false;

function confPath() {
  return path.join(app.getPath('userData'), CONF_NAME);
}

function tunnelServiceName() {
  return `WireGuardTunnel$${TUNNEL_NAME}`;
}

function resolveAppIconPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'icon.png'),
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.png'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function loadAppIcon() {
  const iconPath = resolveAppIconPath();
  if (!iconPath) return nativeImage.createEmpty();
  const img = nativeImage.createFromPath(iconPath);
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function runtimeRootDir() {
  return path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'RB-VPN');
}

function runtimeWireGuardDir() {
  return path.join(runtimeRootDir(), 'WireGuard');
}

function preferredTunnelHelper() {
  return path.join(runtimeWireGuardDir(), 'wireguard.exe');
}

function findTunnelHelper() {
  // Prefer RB-VPN\WireGuard (bundled location), then legacy default installs.
  const candidates = [
    preferredTunnelHelper(),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'WireGuard', 'wireguard.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'WireGuard', 'wireguard.exe'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/** True if the RB-VPN tunnel Windows service exists (running or stopped). */
async function isTunnelServiceInstalled() {
  const q = await execFileAsync('sc.exe', ['query', tunnelServiceName()]);
  return !q.err;
}

async function isTunnelServiceRunning() {
  const q = await execFileAsync('sc.exe', ['query', tunnelServiceName()]);
  if (q.err) return false;
  return /STATE\s*:\s*\d+\s+RUNNING/i.test(q.stdout);
}

function progress(step, message) {
  log('info', step, message);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('connect-progress', { step, message });
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  const icon = loadAppIcon();
  const trayIcon = icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon.isEmpty() ? icon : trayIcon);
  tray.setToolTip('RB-VPN');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open RB-VPN',
        click: () => showMainWindow(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('double-click', () => showMainWindow());
  tray.on('click', () => showMainWindow());
}

function createWindow() {
  const icon = loadAppIcon();
  mainWindow = new BrowserWindow({
    width: 420,
    height: 640,
    resizable: false,
    title: 'RB-VPN',
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // X button: hide to tray (tunnel stays up until Quit from tray).
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

app.whenReady().then(() => {
  log('info', 'app-ready', { logFile: logPath(), userData: app.getPath('userData') });
  createTray();
  createWindow();
});

// Keep process alive in the tray when the window is hidden.
app.on('window-all-closed', () => {
  // Do not quit on Windows/Linux — X hides to tray; Quit is from the tray menu.
});

app.on('activate', () => {
  showMainWindow();
});

// Real quit (tray → Quit) tears down the WireGuard service.
app.on('before-quit', (e) => {
  isQuitting = true;
  if (quittingAfterTunnelStop) return;
  e.preventDefault();
  quittingAfterTunnelStop = true;
  stopTunnel({ reason: 'app-quit' })
    .catch((err) => log('error', 'quit:stop-tunnel', err.message || String(err)))
    .finally(() => {
      if (tray) {
        try {
          tray.destroy();
        } catch {
          // ignore
        }
        tray = null;
      }
      app.quit();
    });
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

/**
 * Write orphan-cleanup script to temp, return elevated batch lines to install it + schtask.
 * (MSI uninstall cannot run NSIS customUnInstall hooks.)
 */
function orphanTunnelCleanupBatchLines(helper) {
  const cleanupDir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'RB-VPN');
  const cleanupCmd = path.join(cleanupDir, 'orphan-tunnel-cleanup.cmd');
  const staging = path.join(app.getPath('temp'), 'rbvpn-orphan-tunnel-cleanup.cmd');
  const appExe = process.execPath;
  const body = [
    '@echo off',
    `if exist ${quoteCmd(appExe)} exit /b 0`,
    `if exist ${quoteCmd(helper)} ${quoteCmd(helper)} /uninstalltunnelservice ${quoteCmd(TUNNEL_NAME)}`,
    'schtasks /Delete /F /TN "RB-VPN Tunnel Cleanup" >nul 2>&1',
    `del /f /q ${quoteCmd(cleanupCmd)} >nul 2>&1`,
  ].join('\r\n');
  try {
    fs.writeFileSync(staging, body, 'utf8');
  } catch (err) {
    log('error', 'cleanup-task:stage-failed', err.message);
    return [];
  }
  return [
    `mkdir ${quoteCmd(cleanupDir)} >nul 2>&1`,
    `copy /y ${quoteCmd(staging)} ${quoteCmd(cleanupCmd)} >nul`,
    `schtasks /Create /F /TN ${quoteCmd('RB-VPN Tunnel Cleanup')} /SC ONLOGON /RL HIGHEST /TR ${quoteCmd(cleanupCmd)}`,
  ];
}

/** One UAC: refresh RB-VPN tunnel service using wireguard.exe only. */
function elevatedApplyTunnel(helper, confFile) {
  const wg = quoteCmd(helper);
  const tunnelSvc = tunnelServiceName();
  return elevatedBatch(
    [
      // Avoid "service does not exist" errors when manager/tunnel were never installed.
      `sc query WireGuardManager >nul 2>&1 && ${wg} /uninstallmanagerservice`,
      `sc query ${quoteCmd(tunnelSvc)} >nul 2>&1 && ${wg} /uninstalltunnelservice ${quoteCmd(TUNNEL_NAME)}`,
      `${wg} /installtunnelservice ${quoteCmd(confFile)}`,
      // Do not auto-start after reboot without the app (prevents leftover VPN after uninstall).
      `sc config ${quoteCmd(tunnelSvc)} start= demand >nul 2>&1`,
      ...orphanTunnelCleanupBatchLines(helper),
    ],
    'rbvpn-apply-tunnel'
  );
}

/** Stop/remove the RB-VPN tunnel service (no-op if not installed). */
async function stopTunnel({ reason = 'disconnect' } = {}) {
  progress('disconnect', reason === 'app-quit' ? 'Stopping tunnel before quit…' : 'Disconnecting…');
  const installed = await isTunnelServiceInstalled();
  if (!installed) {
    log('info', 'stop-tunnel:not-installed', { reason });
    return { ok: true, skipped: true };
  }

  const helper = findTunnelHelper();
  if (!helper) {
    // Last resort: stop/delete service without wireguard.exe
    const stop = await elevatedBatch(
      [
        `sc stop ${quoteCmd(tunnelServiceName())} >nul 2>&1`,
        `sc delete ${quoteCmd(tunnelServiceName())} >nul 2>&1`,
      ],
      'rbvpn-stop-tunnel-sc'
    );
    if (stop.err) {
      return {
        ok: false,
        error: 'Could not stop the tunnel (network runtime missing).',
        detail: stop.stderr || (stop.err && stop.err.message),
      };
    }
    return { ok: true };
  }

  let result = await elevatedBatch(
    [
      `sc query ${quoteCmd(tunnelServiceName())} >nul 2>&1 && ${quoteCmd(helper)} /uninstalltunnelservice ${quoteCmd(TUNNEL_NAME)}`,
    ],
    'rbvpn-stop-tunnel'
  );
  if (result.err) {
    result = await execFileAsync(helper, ['/uninstalltunnelservice', TUNNEL_NAME]);
  }
  if (result.err) {
    log('error', 'stop-tunnel:failed', {
      reason,
      detail: result.stderr || (result.err && result.err.message),
    });
    return {
      ok: false,
      error:
        'Could not stop the tunnel automatically. Approve the administrator prompt, or restart the PC.',
      detail: result.stderr || (result.err && result.err.message),
      logFile: logPath(),
    };
  }
  log('info', 'stop-tunnel:ok', { reason });
  return { ok: true };
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
  const preferred = preferredTunnelHelper();
  if (fs.existsSync(preferred)) {
    log('info', 'runtime:found', preferred);
    return { ok: true, helper: preferred };
  }

  progress('runtime', 'Network runtime missing — installing under RB-VPN…');
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

  // Administrative extract into Program Files\RB-VPN\WireGuard (not Program Files\WireGuard).
  const targetRoot = runtimeRootDir();
  progress('runtime', 'Waiting for administrator approval (UAC)…');
  const result = await elevatedBatch(
    [
      `mkdir ${quoteCmd(targetRoot)} >nul 2>&1`,
      `msiexec /a ${quoteCmd(installer)} /qn TARGETDIR=${quoteCmd(targetRoot)}`,
      // Drop the copied MSI payload left by administrative install.
      `del /f /q ${quoteCmd(path.join(targetRoot, 'rbvpn-network-runtime.msi'))} >nul 2>&1`,
      `del /f /q ${quoteCmd(path.join(targetRoot, path.basename(installer)))} >nul 2>&1`,
      // If a leftover manager UI service exists from an old default install, disable it.
      `if exist ${quoteCmd(preferred)} (sc query WireGuardManager >nul 2>&1 && ${quoteCmd(preferred)} /uninstallmanagerservice)`,
    ],
    'rbvpn-install-runtime'
  );
  log('info', 'runtime:install-result', {
    err: result.err && result.err.message,
    stderr: result.stderr,
    preferred,
    exists: fs.existsSync(preferred),
  });

  if (!fs.existsSync(preferred)) {
    // Fall back to any discoverable helper (legacy Program Files\WireGuard).
    const helper = findTunnelHelper();
    if (helper) {
      log('info', 'runtime:fallback-helper', helper);
      return { ok: true, helper };
    }
    return {
      ok: false,
      error:
        'Could not install network components into RB-VPN. Approve the administrator prompt and try again.',
      detail: result.stderr || (result.err && result.err.message),
    };
  }
  return { ok: true, helper: preferred };
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
    await execFileAsync('sc.exe', ['query', 'WireGuardManager']).then(async (q) => {
      if (!q.err) await execFileAsync(runtime.helper, ['/uninstallmanagerservice']);
    });
    await execFileAsync('sc.exe', ['query', `WireGuardTunnel$${TUNNEL_NAME}`]).then(async (q) => {
      if (!q.err) await execFileAsync(runtime.helper, ['/uninstalltunnelservice', TUNNEL_NAME]);
    });
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
  const result = await stopTunnel({ reason: 'disconnect' });
  if (result.ok) progress('disconnect', 'Disconnected');
  return { ...result, logFile: logPath() };
});

ipcMain.handle('tunnel-status', async () => {
  const installed = await isTunnelServiceInstalled();
  const running = installed ? await isTunnelServiceRunning() : false;
  return {
    installed,
    running,
    connected: running,
    helper: findTunnelHelper(),
  };
});

ipcMain.handle('show-conf-path', async () => confPath());
ipcMain.handle('get-log-path', async () => logPath());
ipcMain.handle('get-log-tail', async () => ({ path: logPath(), text: readLogTail() }));
ipcMain.handle('open-log', async () => {
  const { shell } = require('electron');
  const p = logPath();
  // Ensure the file exists so the default editor can open it.
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, '', 'utf8');
  }
  const err = await shell.openPath(p);
  if (err) {
    log('error', 'open-log:failed', err);
    return { ok: false, error: err };
  }
  return { ok: true };
});
