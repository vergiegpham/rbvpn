const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, safeStorage } = require('electron');
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

/** Packaged with the app (MSI/NSIS) — no first-connect msiexec needed. */
function bundledTunnelHelper() {
  const candidates = [
    path.join(process.resourcesPath || '', 'tunnel', 'WireGuard', 'wireguard.exe'),
    path.join(__dirname, '..', 'vendor', 'tunnel', 'WireGuard', 'wireguard.exe'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function legacyWireGuardDir() {
  return path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'WireGuard');
}

function legacyTunnelHelper() {
  return path.join(legacyWireGuardDir(), 'wireguard.exe');
}

function findTunnelHelper() {
  // Only the RB-VPN-owned path for services (Data/log.bin live next to this exe).
  const preferred = preferredTunnelHelper();
  if (fs.existsSync(preferred)) return preferred;
  return null;
}

/** Silent remove — prefer sc; also wipe any legacy bootstrap-named tunnel. */
function removeServiceBatchLines(serviceName) {
  const svc = quoteCmd(serviceName);
  return [`sc stop ${svc} >nul 2>&1`, `sc delete ${svc} >nul 2>&1`];
}

function removeRbVpnTunnelBatchLines(helper) {
  const wg = helper ? quoteCmd(helper) : null;
  const lines = [
    ...removeServiceBatchLines(tunnelServiceName()),
    // Older builds used RB-VPN.bootstrap.conf → WireGuardTunnel$RB-VPN.bootstrap
    ...removeServiceBatchLines('WireGuardTunnel$RB-VPN.bootstrap'),
  ];
  // Proper WireGuard uninstall (no MessageBox when the tunnel exists).
  if (wg) {
    lines.push(
      `${wg} /uninstalltunnelservice ${quoteCmd(TUNNEL_NAME)} >nul 2>&1`,
      `${wg} /uninstalltunnelservice ${quoteCmd('RB-VPN.bootstrap')} >nul 2>&1`
    );
  }
  // sc delete is async — ping delay works when stdin is redirected (timeout.exe does not).
  lines.push('ping 127.0.0.1 -n 4 >nul');
  return lines;
}

function removeWireGuardManagerBatchLines() {
  return removeServiceBatchLines('WireGuardManager');
}

/**
 * Full WireGuard cleanup for uninstall / orphan cleanup only (not on Connect).
 * Removes RB-VPN tunnel, manager UI service, Program Files\RB-VPN\WireGuard,
 * and leftover Program Files\WireGuard.
 */
function uninstallWireGuardBatchLines() {
  const legacyDir = legacyWireGuardDir();
  const preferredDir = runtimeWireGuardDir();
  const legacyArg = legacyDir.replace(/'/g, "''");
  const preferredArg = preferredDir.replace(/'/g, "''");
  return [
    ...removeRbVpnTunnelBatchLines(),
    ...removeWireGuardManagerBatchLines(),
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Service | Where-Object { $_.Name -like 'WireGuard*' } | ForEach-Object { Stop-Service -Name $_.Name -Force; & sc.exe delete $_.Name | Out-Null }; Start-Sleep -Milliseconds 400; Remove-Item -LiteralPath '${preferredArg}' -Recurse -Force; Remove-Item -LiteralPath '${legacyArg}' -Recurse -Force; Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -eq 'WireGuard' } | ForEach-Object { if ($_.UninstallString -match '{[0-9A-Fa-f-]+}') { Start-Process msiexec.exe -ArgumentList @('/x',$Matches[0],'/qn','/norestart') -Wait -WindowStyle Hidden } }"`,
  ];
}

/** Conf file whose basename is always RB-VPN.conf (WireGuard service name = file stem). */
function tunnelInstallConfPath() {
  return path.join(app.getPath('temp'), CONF_NAME);
}

/** Copy bundled binaries into Program Files\RB-VPN\WireGuard (required path). */
function installPreferredRuntimeBatchLines(bundledExe) {
  const srcDir = path.dirname(bundledExe);
  const dstDir = runtimeWireGuardDir();
  return [
    `mkdir ${quoteCmd(runtimeRootDir())} >nul 2>&1`,
    `mkdir ${quoteCmd(dstDir)} >nul 2>&1`,
    `robocopy ${quoteCmd(srcDir)} ${quoteCmd(dstDir)} /E /IS /IT /NFL /NDL /NJH /NJS /nc /ns /np >nul`,
    // robocopy exit codes 0-7 are success; normalize so cmd ERRORLEVEL is 0 when exe exists.
    `if exist ${quoteCmd(preferredTunnelHelper())} (exit /b 0) else (exit /b 1)`,
  ];
}

function encryptSecret(plain) {
  if (!plain) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(String(plain)).toString('base64');
    }
  } catch (err) {
    log('error', 'safeStorage:encrypt', err.message);
  }
  return Buffer.from(String(plain), 'utf8').toString('base64');
}

function decryptSecret(encoded) {
  if (!encoded) return '';
  try {
    const buf = Buffer.from(String(encoded), 'base64');
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(buf);
      } catch {
        // Fall through to plain base64 (legacy / unavailable).
      }
    }
    return buf.toString('utf8');
  } catch (err) {
    log('error', 'safeStorage:decrypt', err.message);
    return '';
  }
}

function getSavedPassword() {
  return decryptSecret(store.get('passwordEnc', ''));
}

function setSavedPassword(password) {
  if (password) store.set('passwordEnc', encryptSecret(password));
  else store.delete('passwordEnc');
}

function applyOpenAtLogin(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      path: process.execPath,
      args: [],
    });
  } catch (err) {
    log('error', 'login-item', err.message);
  }
}

function prefsFromStore() {
  return {
    savePassword: !!store.get('savePassword', false),
    autoLogin: !!store.get('autoLogin', false),
    openAtLogin: !!store.get('openAtLogin', false),
  };
}

function isElevated() {
  return new Promise((resolve) => {
    execFile('net', ['session'], { windowsHide: true }, (err) => resolve(!err));
  });
}

/** True if the RB-VPN tunnel Windows service exists (running or stopped). */
async function isTunnelServiceInstalled() {
  for (const name of [tunnelServiceName(), 'WireGuardTunnel$RB-VPN.bootstrap']) {
    const q = await execFileAsync('sc.exe', ['query', name]);
    if (!q.err) return true;
  }
  return false;
}

async function isTunnelServiceRunning() {
  for (const name of [tunnelServiceName(), 'WireGuardTunnel$RB-VPN.bootstrap']) {
    const q = await execFileAsync('sc.exe', ['query', name]);
    if (!q.err && /STATE\s*:\s*\d+\s+RUNNING/i.test(q.stdout)) return true;
  }
  return false;
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
  applyOpenAtLogin(!!store.get('openAtLogin', false));
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
  // Without Auto-login, drop the session so the next launch shows Sign in.
  if (!store.get('autoLogin', false)) {
    store.delete('token');
  }
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

ipcMain.handle('get-settings', () => {
  const prefs = prefsFromStore();
  return {
    apiUrl: store.get('apiUrl', DEFAULT_API),
    token: store.get('token', ''),
    email: store.get('email', ''),
    deviceId: store.get('deviceId', ''),
    nodeId: store.get('nodeId', ''),
    ...prefs,
    // Only return password to UI when save-password is enabled.
    password: prefs.savePassword ? getSavedPassword() : '',
  };
});

ipcMain.handle('save-settings', (_e, data) => {
  if (data.apiUrl != null) store.set('apiUrl', data.apiUrl);
  if (data.token != null) store.set('token', data.token);
  if (data.email != null) store.set('email', data.email);
  if (data.deviceId != null) store.set('deviceId', data.deviceId);
  if (data.nodeId != null) store.set('nodeId', data.nodeId);

  if (data.savePassword != null) {
    store.set('savePassword', !!data.savePassword);
    if (!data.savePassword) {
      setSavedPassword('');
      // Auto-login needs a saved password.
      if (data.autoLogin == null) store.set('autoLogin', false);
    }
  }
  if (data.autoLogin != null) {
    const on = !!data.autoLogin;
    store.set('autoLogin', on);
    if (on) store.set('savePassword', true);
  }
  if (data.openAtLogin != null) {
    store.set('openAtLogin', !!data.openAtLogin);
    applyOpenAtLogin(!!data.openAtLogin);
  }
  if (data.password != null) {
    if (store.get('savePassword', false)) setSavedPassword(data.password);
    else setSavedPassword('');
  }
  return prefsFromStore();
});

ipcMain.handle('logout', () => {
  store.delete('token');
  store.delete('deviceId');
  // Keep email/password when "save password" is on.
  if (!store.get('savePassword', false)) {
    store.delete('email');
    setSavedPassword('');
  }
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

ipcMain.handle('login', async (_e, { email, password, apiUrl, savePassword, autoLogin, openAtLogin }) => {
  if (apiUrl) store.set('apiUrl', apiUrl);
  const data = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    apiUrl: apiUrl || store.get('apiUrl', DEFAULT_API),
  });
  store.set('token', data.token);
  store.set('email', data.user.email);

  if (savePassword != null) store.set('savePassword', !!savePassword);
  if (autoLogin != null) {
    store.set('autoLogin', !!autoLogin);
    if (autoLogin) store.set('savePassword', true);
  }
  if (openAtLogin != null) {
    store.set('openAtLogin', !!openAtLogin);
    applyOpenAtLogin(!!openAtLogin);
  }

  if (store.get('savePassword', false)) setSavedPassword(password);
  else setSavedPassword('');

  return { user: data.user, prefs: prefsFromStore() };
});

ipcMain.handle('try-auto-login', async () => {
  const prefs = prefsFromStore();
  const email = store.get('email', '');

  // Stay signed in across launches only when Auto-login is enabled.
  if (!prefs.autoLogin) {
    store.delete('token');
    return { ok: false, prefs, email };
  }

  const token = store.get('token', '');
  if (token) {
    try {
      const me = await api('/api/auth/me');
      return { ok: true, user: me.user || { email }, prefs };
    } catch {
      store.delete('token');
    }
  }

  if (!prefs.savePassword) {
    return { ok: false, prefs, email };
  }

  const password = getSavedPassword();
  if (!email || !password) return { ok: false, prefs, email };

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    store.set('token', data.token);
    store.set('email', data.user.email);
    return { ok: true, user: data.user, prefs };
  } catch (err) {
    log('error', 'auto-login:failed', err.message);
    return { ok: false, error: err.message, prefs, email };
  }
});

ipcMain.handle('fetch-subscription', async () => api('/api/plans/subscription'));

ipcMain.handle('list-nodes', async () => api('/api/devices/nodes/list'));

ipcMain.handle('ensure-device', async (_e, { nodeId } = {}) => {
  progress('ensure-device', 'Preparing device profile…');
  const preferredNodeId = nodeId || store.get('nodeId') || '';
  if (preferredNodeId) store.set('nodeId', preferredNodeId);

  // Stable per-install id so a second PC never steals the first PC's WireGuard peer/IP.
  let machineId = store.get('machineId');
  if (!machineId) {
    machineId = require('crypto').randomUUID();
    store.set('machineId', machineId);
  }
  const machineTag = String(machineId).replace(/-/g, '').slice(0, 8);
  const deviceName = `Windows-${require('os').hostname()}-${machineTag}`;

  let deviceId = store.get('deviceId');
  const list = await api('/api/devices');
  const devices = list.devices || [];

  // Only reuse THIS machine's device — never fall back to devices[0] (caused shared 10.10.0.7).
  let device =
    devices.find((d) => d.id === deviceId && String(d.name || '').includes(machineTag)) ||
    devices.find((d) => String(d.name || '').includes(machineTag)) ||
    null;

  // Drop a stolen/shared deviceId from an older client build.
  if (!device && deviceId) {
    log('info', 'ensure-device:abandon-shared-device', { deviceId, machineTag });
    store.delete('deviceId');
    deviceId = null;
  }

  log('info', 'ensure-device:listed', {
    count: devices.length,
    deviceId,
    machineTag,
    preferredNodeId,
    matched: Boolean(device),
  });

  if (!device) {
    progress('ensure-device', 'Creating device on server…');
    // replace:true reclaims a slot on Basic (1 device) when an old/other-PC profile exists.
    const created = await api('/api/devices', {
      method: 'POST',
      body: {
        name: deviceName,
        nodeId: preferredNodeId || undefined,
        replace: true,
      },
    });
    device = created.device;
    deviceId = device.id;
    store.set('deviceId', deviceId);
    log('info', 'ensure-device:created', {
      deviceId,
      clientIp: device.clientIp,
      syncStatus: device.syncStatus,
    });
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

  const config = device.clientIp
    ? await api(`/api/devices/${deviceId}/config`).catch(() => null)
    : null;
  if (config?.conf) {
    fs.writeFileSync(confPath(), config.conf, 'utf8');
  }
  log('info', 'ensure-device:ready', {
    conf: confPath(),
    syncStatus: device.syncStatus,
    address: device.clientIp || null,
    hasConf: Boolean(config?.conf),
  });
  return {
    deviceId,
    name: device.name,
    region: device.node?.region,
    nodeName: device.node?.name,
    endpoint: device.node
      ? `${device.node.publicHost}:${device.node.publicPort || 51820}`
      : null,
    address: device.clientIp || null,
    syncStatus: device.syncStatus,
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
 * Run a plain .cmd script with admin rights.
 * If RB-VPN is already elevated (requireAdministrator), run directly —
 * nested Start-Process -Verb RunAs often fails or confuses UAC.
 */
async function elevatedBatch(lines, label = 'rbvpn-task') {
  const bat = path.join(app.getPath('temp'), `${label}.cmd`);
  const body = ['@echo off', 'setlocal', ...lines, 'exit /b %ERRORLEVEL%'].join('\r\n');
  fs.writeFileSync(bat, body, 'utf8');
  const alreadyElevated = await isElevated();
  log('info', 'elevate:batch', { bat, lines: lines.length, alreadyElevated });

  try {
    if (alreadyElevated) {
      return await execFileAsync('cmd.exe', ['/c', bat]);
    }

    // Second UAC (nested RunAs) is unreliable — prefer launching RB-VPN as admin.
    const batArg = bat.replace(/'/g, "''");
    const ps = [
      `$p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', '${batArg}') -Verb RunAs -Wait -PassThru`,
      'if ($null -eq $p) { exit 1223 }',
      'exit $p.ExitCode',
    ].join('; ');
    const result = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps]);
    if (result.err) {
      const code = result.err.code || result.err.status;
      result.err.message =
        code === 1223
          ? 'Administrator prompt was cancelled.'
          : result.err.message || `Elevated command failed (code ${code})`;
    }
    return result;
  } finally {
    try {
      fs.unlinkSync(bat);
    } catch {
      // ignore
    }
  }
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
  // Electron userData uses package.json "name" (rbvpn-windows), not productName.
  const userDataDir = app.getPath('userData');
  const body = [
    '@echo off',
    `if exist ${quoteCmd(appExe)} exit /b 0`,
    // App is gone — uninstall WireGuard runtime with RB-VPN (not during normal Connect).
    ...uninstallWireGuardBatchLines(),
    `if exist "%APPDATA%\\rbvpn-windows" rmdir /s /q "%APPDATA%\\rbvpn-windows"`,
    `if exist ${quoteCmd(userDataDir)} rmdir /s /q ${quoteCmd(userDataDir)}`,
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

/** One UAC: install tunnel service from conf. Fail if install/service does not stick. */
function elevatedApplyTunnel(helper, confFile) {
  const wg = quoteCmd(helper);
  const tunnelSvc = tunnelServiceName();
  // WireGuard names the service from the conf basename — always install from RB-VPN.conf.
  const installConf = tunnelInstallConfPath();
  return elevatedBatch(
    [
      ...removeWireGuardManagerBatchLines(),
      ...removeRbVpnTunnelBatchLines(helper),
      `copy /y ${quoteCmd(confFile)} ${quoteCmd(installConf)} >nul`,
      'if errorlevel 1 exit /b 1',
      `${wg} /installtunnelservice ${quoteCmd(installConf)}`,
      'if errorlevel 1 exit /b 1',
      // Confirm the Windows service exists after install.
      `sc query ${quoteCmd(tunnelSvc)} >nul 2>&1`,
      'if errorlevel 1 exit /b 1',
      `sc start ${quoteCmd(tunnelSvc)} >nul 2>&1`,
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
    // Tunnel already down — safe to tell the API to free the IP.
    await releaseServerSession({ reason });
    log('info', 'stop-tunnel:not-installed', { reason });
    return { ok: true, skipped: true };
  }

  const helper = findTunnelHelper();
  const result = await elevatedBatch(removeRbVpnTunnelBatchLines(helper), 'rbvpn-stop-tunnel');
  // If elevation failed, try non-elevated sc (works when app already runs as admin).
  if (result.err) {
    const fallback = await execFileAsync('sc.exe', ['stop', tunnelServiceName()]);
    await execFileAsync('sc.exe', ['delete', tunnelServiceName()]);
    await execFileAsync('sc.exe', ['stop', 'WireGuardTunnel$RB-VPN.bootstrap']);
    await execFileAsync('sc.exe', ['delete', 'WireGuardTunnel$RB-VPN.bootstrap']);
    if (helper) {
      await execFileAsync(helper, ['/uninstalltunnelservice', TUNNEL_NAME]);
      await execFileAsync(helper, ['/uninstalltunnelservice', 'RB-VPN.bootstrap']);
    }
    if (fallback.err && (await isTunnelServiceInstalled())) {
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
  }
  // Release IP only after local tunnel is down so the API call can use the normal NIC.
  await releaseServerSession({ reason });
  log('info', 'stop-tunnel:ok', { reason });
  return { ok: true };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function wgCliPath(helper) {
  return path.join(path.dirname(helper), 'wg.exe');
}

function parseClientConf(confText) {
  const address = (confText.match(/^\s*Address\s*=\s*([0-9.]+)/m) || [])[1] || '';
  const peerPublicKey = (confText.match(/\[Peer\][\s\S]*?^\s*PublicKey\s*=\s*(.+)$/m) || [])[1] || '';
  return {
    address: String(address).trim(),
    peerPublicKey: String(peerPublicKey).trim(),
  };
}

/** VPN LAN only — does not blackhole general internet while waiting for handshake. */
function vpnSubnetAllowedIps(address) {
  const parts = String(address || '').split('.');
  if (parts.length !== 4) return '10.10.0.0/24';
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

/**
 * Bootstrap conf: handshake-safe (no 0.0.0.0/0, no tunnel DNS).
 * Full-tunnel conf is applied only after handshake succeeds.
 */
function buildBootstrapConf(fullConf) {
  const { address } = parseClientConf(fullConf);
  const allowed = vpnSubnetAllowedIps(address);
  return String(fullConf)
    .replace(/^\s*DNS\s*=\s*.+$/im, '# DNS applied after full tunnel is verified')
    .replace(/^\s*AllowedIPs\s*=\s*.+$/im, `AllowedIPs = ${allowed}`);
}

function bootstrapConfPath() {
  // Must keep basename RB-VPN.conf so the service is WireGuardTunnel$RB-VPN (not .bootstrap).
  return path.join(app.getPath('userData'), `${TUNNEL_NAME}.bootstrap.src.conf`);
}

function fullTunnelConfPath() {
  return path.join(app.getPath('userData'), `${TUNNEL_NAME}.full.conf`);
}

/**
 * Public IPv4 via VPN; leave RFC1918 / CGNAT / loopback on the physical NIC.
 * Using 0.0.0.0/0 on Windows WireGuard enables a kill-switch that also blocks LAN.
 */
const LAN_SAFE_ALLOWED_IPS = [
  '0.0.0.0/5',
  '8.0.0.0/7',
  '11.0.0.0/8',
  '12.0.0.0/6',
  '16.0.0.0/4',
  '32.0.0.0/3',
  '64.0.0.0/3',
  '96.0.0.0/4',
  '112.0.0.0/5',
  '120.0.0.0/6',
  '124.0.0.0/7',
  '126.0.0.0/8',
  '128.0.0.0/3',
  '160.0.0.0/5',
  '168.0.0.0/6',
  '172.0.0.0/12',
  '172.32.0.0/11',
  '172.64.0.0/10',
  '172.128.0.0/9',
  '173.0.0.0/8',
  '174.0.0.0/7',
  '176.0.0.0/4',
  '192.0.0.0/9',
  '192.128.0.0/11',
  '192.160.0.0/13',
  '192.169.0.0/16',
  '192.170.0.0/15',
  '192.172.0.0/14',
  '192.176.0.0/12',
  '192.192.0.0/10',
  '193.0.0.0/8',
  '194.0.0.0/7',
  '196.0.0.0/6',
  '200.0.0.0/5',
  '208.0.0.0/4',
].join(', ');

function buildLanSafeFullConf(fullConf) {
  log('info', 'full-tunnel:allowed-ips', { mode: 'lan-safe-public-ipv4' });
  return String(fullConf).replace(
    /^\s*AllowedIPs\s*=\s*.+$/im,
    `AllowedIPs = ${LAN_SAFE_ALLOWED_IPS}`
  );
}

function parseEndpointHost(confText) {
  const m = String(confText).match(/^\s*Endpoint\s*=\s*([^:\s\r\n]+)/im);
  return m ? m[1].trim() : '';
}

/** True when WireGuard has completed at least one handshake with the peer. */
async function tunnelHasHandshake(helper) {
  const wgCli = wgCliPath(helper);
  if (!fs.existsSync(wgCli)) return false;
  // Prefer listing all interfaces — name mismatches are less brittle.
  let r = await execFileAsync(wgCli, ['show', TUNNEL_NAME, 'latest-handshakes']);
  if ((r.err && !r.stdout) || !String(r.stdout || '').trim()) {
    r = await execFileAsync(wgCli, ['show', 'all', 'latest-handshakes']);
  }
  if (r.err && !r.stdout) {
    log('info', 'handshake:wg-show-failed', r.stderr || (r.err && r.err.message));
    return false;
  }
  for (const line of String(r.stdout || '')
    .trim()
    .split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    const ts = Number(parts[parts.length - 1]);
    if (Number.isFinite(ts) && ts > 0) return true;
  }
  return false;
}

async function waitForTunnelHandshake(helper, { timeoutMs = 20000 } = {}) {
  const started = Date.now();
  progress('tunnel', 'Waiting for VPN handshake…');
  while (Date.now() - started < timeoutMs) {
    if (await tunnelHasHandshake(helper)) {
      log('info', 'handshake:ok', { elapsedMs: Date.now() - started });
      return true;
    }
    progress(
      'tunnel',
      `Waiting for VPN handshake… (${Math.round((Date.now() - started) / 1000)}s)`
    );
    await sleep(1000);
  }
  log('error', 'handshake:timeout', { timeoutMs });
  return false;
}

/**
 * Install LAN-safe full tunnel via WireGuard service (proper Windows routes + endpoint bypass).
 * Manual New-NetRoute after bootstrap was blackholing the VPN server IP.
 */
async function enableFullTunnelRoutes(helper, _peerPublicKey, fullConfPath) {
  const fullText = fs.readFileSync(fullConfPath, 'utf8');
  const lanSafe = buildLanSafeFullConf(fullText);
  const outPath = fullTunnelConfPath();
  fs.writeFileSync(outPath, lanSafe, 'utf8');

  const endpoint = parseEndpointHost(fullText);
  const result = await elevatedApplyTunnel(helper, outPath);
  log('info', 'full-tunnel:install', {
    err: result.err && result.err.message,
    stderr: result.stderr,
    stdout: result.stdout,
    endpoint,
  });
  if (result.err) return false;

  // Keep a host route to the VPN server on the physical NIC (belt-and-suspenders).
  if (endpoint && /^\d{1,3}(\.\d{1,3}){3}$/.test(endpoint)) {
    const ps1 = path.join(app.getPath('temp'), 'rbvpn-endpoint-bypass.ps1');
    fs.writeFileSync(
      ps1,
      [
        "$ErrorActionPreference = 'SilentlyContinue'",
        `$ep = '${endpoint}'`,
        `$phys = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' -and $_.InterfaceAlias -notmatch 'RB-VPN|WireGuard|Wintun|Astrill' } | Sort-Object RouteMetric | Select-Object -First 1`,
        'if ($phys) {',
        '  New-NetRoute -DestinationPrefix ($ep + "/32") -NextHop $phys.NextHop -InterfaceIndex $phys.InterfaceIndex -RouteMetric 1 -ErrorAction SilentlyContinue | Out-Null',
        '  Write-Output ("endpoint-bypass via " + $phys.InterfaceAlias + " gw=" + $phys.NextHop)',
        '}',
      ].join('\r\n'),
      'utf8'
    );
    const bypass = await elevatedBatch(
      [`powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${quoteCmd(ps1)}`],
      'rbvpn-endpoint-bypass'
    );
    try {
      fs.unlinkSync(ps1);
    } catch {
      // ignore
    }
    log('info', 'full-tunnel:endpoint-bypass', {
      err: bypass.err && bypass.err.message,
      stdout: bypass.stdout,
    });
  }

  await sleep(1500);
  return true;
}

/**
 * Verify traffic really exits via the VPN (not a pre-kill-switch leak).
 * Requires Cloudflare trace body with ip= matching the VPN server public IP when possible.
 */
async function checkTunneledInternet(fullConf, { timeoutMs = 12000 } = {}) {
  const expected = parseEndpointHost(fullConf);
  const urls = ['https://1.1.1.1/cdn-cgi/trace', 'https://cloudflare.com/cdn-cgi/trace'];
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', redirect: 'follow' });
      clearTimeout(timer);
      const body = await res.text();
      const ip = ((body.match(/^ip=([0-9.]+)/m) || [])[1] || '').trim();
      if (!res.ok || !ip) {
        log('info', 'internet:try-failed', { url, status: res.status, hasIp: Boolean(ip) });
        continue;
      }
      if (expected && /^\d{1,3}(\.\d{1,3}){3}$/.test(expected) && ip !== expected) {
        log('info', 'internet:wrong-egress', { url, ip, expected });
        continue;
      }
      log('info', 'internet:ok', { url, ip, expected: expected || null });
      return true;
    } catch (err) {
      log('info', 'internet:try-failed', { url, error: err.message });
    }
  }
  return false;
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
    if (last.syncStatus === 'idle') {
      throw new Error('VPN session ended on the server. Click Connect again.');
    }
    progress('sync', `Waiting for server sync… (${last.syncStatus || 'pending'})`);
    await sleep(2000);
  }
  log('error', 'sync:timeout', { syncStatus: last?.syncStatus, deviceId });
  throw new Error(
    'Server is still preparing your connection. Wait a few seconds and click Connect again.'
  );
}

/** Ask the API to free this device's IP / remove the node peer (best-effort). */
async function releaseServerSession({ reason = 'disconnect' } = {}) {
  const deviceId = store.get('deviceId');
  if (!deviceId || !store.get('token')) return;
  try {
    const result = await api(`/api/devices/${deviceId}/disconnect`, { method: 'POST', body: {} });
    log('info', 'session:released', { reason, result });
  } catch (err) {
    log('info', 'session:release-failed', { reason, error: err.message });
  }
}

/**
 * Network runtime lives at Program Files\RB-VPN\WireGuard (Data/log.bin there).
 * Do NOT remove Program Files\WireGuard on every Connect — only on app uninstall.
 */
async function ensureTunnelRuntime() {
  const preferred = preferredTunnelHelper();
  const bundled = bundledTunnelHelper();
  const elevated = await isElevated();

  if (fs.existsSync(preferred)) {
    log('info', 'runtime:found', preferred);
    return { ok: true, helper: preferred };
  }

  if (!elevated) {
    return {
      ok: false,
      error:
        'Administrator rights are required to install network components under RB-VPN. Restart RB-VPN and approve the admin prompt.',
    };
  }

  progress('runtime', 'Installing network components under RB-VPN…');

  if (bundled) {
    const copy = await elevatedBatch(installPreferredRuntimeBatchLines(bundled), 'rbvpn-copy-runtime');
    log('info', 'runtime:copy-result', {
      err: copy.err && copy.err.message,
      preferredExists: fs.existsSync(preferred),
      bundled,
    });
  } else {
    let installer;
    try {
      installer = ensureRuntimeInstaller();
      log('info', 'runtime:installer', installer);
    } catch (err) {
      log('error', 'runtime:missing-installer', err.message);
      return { ok: false, error: err.message };
    }
    const targetRoot = runtimeRootDir();
    const extract = await elevatedBatch(
      [
        `mkdir ${quoteCmd(targetRoot)} >nul 2>&1`,
        `msiexec /a ${quoteCmd(installer)} /qn TARGETDIR=${quoteCmd(targetRoot)}`,
        `del /f /q ${quoteCmd(path.join(targetRoot, 'rbvpn-network-runtime.msi'))} >nul 2>&1`,
        `del /f /q ${quoteCmd(path.join(targetRoot, path.basename(installer)))} >nul 2>&1`,
      ],
      'rbvpn-install-runtime'
    );
    log('info', 'runtime:install-result', {
      err: extract.err && extract.err.message,
      preferredExists: fs.existsSync(preferred),
    });
  }

  if (!fs.existsSync(preferred)) {
    return {
      ok: false,
      error:
        'Could not install network components under C:\\Program Files\\RB-VPN\\WireGuard. Reinstall RB-VPN Setup, then try Connect again.',
    };
  }

  log('info', 'runtime:found', preferred);
  return { ok: true, helper: preferred };
}

ipcMain.handle('connect', async () => {
  clearLog();
  progress('connect', 'Connect started');
  const deviceId = store.get('deviceId');
  log('info', 'connect:begin', {
    conf: confPath(),
    deviceId,
    helper: findTunnelHelper(),
  });

  if (!deviceId) {
    return { ok: false, error: 'No device profile yet. Sign in and select a node first.' };
  }

  try {
    progress('sync', 'Requesting VPN IP from server…');
    const started = await api(`/api/devices/${deviceId}/connect`, { method: 'POST', body: {} });
    log('info', 'session:started', {
      address: started.address,
      syncStatus: started.syncStatus,
    });
    const config = await waitForDeviceSynced(deviceId);
    fs.writeFileSync(confPath(), config.conf, 'utf8');
    log('info', 'connect:config-written', { address: config.address });
  } catch (err) {
    log('error', 'connect:sync-failed', err.message);
    await releaseServerSession({ reason: 'sync-failed' });
    return { ok: false, error: err.message };
  }

  const runtime = await ensureTunnelRuntime();
  if (!runtime.ok) {
    log('error', 'connect:runtime-failed', runtime);
    await releaseServerSession({ reason: 'runtime-failed' });
    return runtime;
  }

  const fullConf = fs.readFileSync(confPath(), 'utf8');
  const { peerPublicKey } = parseClientConf(fullConf);

  // One-shot LAN-safe tunnel (WireGuard service owns routes). Avoids bootstrap→manual
  // route expansion that blackholed the VPN endpoint while another peer (.6) works fine.
  progress('tunnel', 'Starting VPN tunnel…');
  const startedOk = await enableFullTunnelRoutes(runtime.helper, peerPublicKey, confPath());
  if (!startedOk) {
    progress('tunnel', 'Elevated start failed — trying without UAC…');
    const outPath = fullTunnelConfPath();
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, buildLanSafeFullConf(fullConf), 'utf8');
    }
    await execFileAsync(runtime.helper, ['/uninstalltunnelservice', TUNNEL_NAME]);
    await sleep(3000);
    const installConf = tunnelInstallConfPath();
    fs.copyFileSync(outPath, installConf);
    const fallback = await execFileAsync(runtime.helper, ['/installtunnelservice', installConf]);
    log('info', 'connect:fallback-result', {
      err: fallback.err && fallback.err.message,
      stderr: fallback.stderr,
    });
    if (fallback.err) {
      await releaseServerSession({ reason: 'tunnel-start-failed' });
      return {
        ok: false,
        error:
          'Could not start the RB-VPN tunnel. Approve the administrator prompt, then click Connect again.',
        detail: fallback.stderr || (fallback.err && fallback.err.message),
        logFile: logPath(),
      };
    }
  }

  const handshook = await waitForTunnelHandshake(runtime.helper, { timeoutMs: 25000 });
  if (!handshook) {
    await stopTunnel({ reason: 'handshake-timeout' });
    return {
      ok: false,
      error:
        'VPN could not reach the server (no handshake). Check firewall/UDP to the VPN server, try another network or node, then Connect again.',
      logFile: logPath(),
    };
  }

  progress('tunnel', 'Checking internet through VPN…');
  const online = await checkTunneledInternet(fullConf, { timeoutMs: 12000 });
  if (!online) {
    await stopTunnel({ reason: 'no-internet' });
    return {
      ok: false,
      error:
        'VPN reached the server but internet through the tunnel failed. Your network was restored. Try another node, or contact support if every node fails.',
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
