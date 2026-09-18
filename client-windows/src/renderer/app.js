const loginView = document.getElementById('view-login');
const appView = document.getElementById('view-app');
const statusPill = document.getElementById('status-pill');
const loginError = document.getElementById('login-error');
const appMsg = document.getElementById('app-msg');
const subLine = document.getElementById('sub-line');
const userEmail = document.getElementById('user-email');
const nodeSelect = document.getElementById('nodeSelect');

const elSavePassword = document.getElementById('savePassword');
const elAutoLogin = document.getElementById('autoLogin');
const elOpenAtLogin = document.getElementById('openAtLogin');
const optSavePassword = document.getElementById('opt-savePassword');
const optAutoLogin = document.getElementById('opt-autoLogin');
const optOpenAtLogin = document.getElementById('opt-openAtLogin');

let unsubProgress = null;

function setConnected(on) {
  statusPill.textContent = on ? 'Connected' : 'Disconnected';
  statusPill.classList.toggle('on', on);
  statusPill.classList.toggle('off', !on);
  document.getElementById('btn-connect').classList.toggle('hidden', on);
  document.getElementById('btn-disconnect').classList.toggle('hidden', !on);
}

function applyPrefsToUi(prefs = {}) {
  const savePassword = !!prefs.savePassword;
  const autoLogin = !!prefs.autoLogin;
  const openAtLogin = !!prefs.openAtLogin;
  elSavePassword.checked = savePassword;
  elAutoLogin.checked = autoLogin;
  elOpenAtLogin.checked = openAtLogin;
  optSavePassword.checked = savePassword;
  optAutoLogin.checked = autoLogin;
  optOpenAtLogin.checked = openAtLogin;
}

async function persistPrefsFrom(source) {
  const savePassword = source.savePassword.checked;
  const autoLogin = source.autoLogin.checked;
  const openAtLogin = source.openAtLogin.checked;
  // Auto-login requires a saved password.
  if (autoLogin && !savePassword) source.savePassword.checked = true;
  const prefs = await window.rbvpn.saveSettings({
    savePassword: source.savePassword.checked,
    autoLogin,
    openAtLogin,
  });
  applyPrefsToUi(prefs);
}

async function loadNodes(preferredId) {
  nodeSelect.innerHTML = '';
  try {
    const { nodes } = await window.rbvpn.listNodes();
    if (!nodes?.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No nodes available';
      nodeSelect.appendChild(opt);
      return;
    }
    for (const n of nodes) {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = `${n.name} (${n.region})`;
      nodeSelect.appendChild(opt);
    }
    if (preferredId && nodes.some((n) => n.id === preferredId)) {
      nodeSelect.value = preferredId;
    }
  } catch (err) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = err.message;
    nodeSelect.appendChild(opt);
  }
}

async function showApp(email, prefs) {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  userEmail.textContent = email || '';
  appMsg.textContent = '';
  setConnected(false);
  if (prefs) applyPrefsToUi(prefs);
  const settings = await window.rbvpn.getSettings();
  applyPrefsToUi(settings);
  await loadNodes(settings.nodeId);
  try {
    const status = await window.rbvpn.tunnelStatus();
    if (status.connected) {
      setConnected(true);
      appMsg.textContent = 'Tunnel still active from a previous session.';
    }
  } catch {
    // ignore
  }
  try {
    const { subscription } = await window.rbvpn.fetchSubscription();
    if (!subscription) {
      subLine.textContent = 'No active plan. Buy one on the website first.';
    } else {
      const ends = new Date(subscription.endsAt).toLocaleDateString();
      subLine.textContent = `${subscription.plan.name} · active until ${ends} · all nodes`;
    }
  } catch (err) {
    subLine.textContent = err.message;
  }
}

async function showLogin(settings) {
  appView.classList.add('hidden');
  loginView.classList.remove('hidden');
  setConnected(false);
  const s = settings || (await window.rbvpn.getSettings());
  document.getElementById('apiUrl').value = s.apiUrl || 'http://162.35.175.39:4000';
  document.getElementById('email').value = s.email || '';
  document.getElementById('password').value = s.savePassword ? s.password || '' : '';
  applyPrefsToUi(s);
}

async function boot() {
  const result = await window.rbvpn.tryAutoLogin();
  applyPrefsToUi(result.prefs || {});
  if (result.ok && result.user) {
    await showApp(result.user.email, result.prefs);
    return;
  }
  await showLogin({
    ...(await window.rbvpn.getSettings()),
    ...(result.prefs || {}),
    email: result.email || '',
  });
  if (result.error) loginError.textContent = result.error;
}

document.getElementById('btn-login').addEventListener('click', async () => {
  loginError.textContent = '';
  try {
    const { user, prefs } = await window.rbvpn.login({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
      apiUrl: document.getElementById('apiUrl').value.trim(),
      savePassword: elSavePassword.checked,
      autoLogin: elAutoLogin.checked,
      openAtLogin: elOpenAtLogin.checked,
    });
    await showApp(user.email, prefs);
  } catch (err) {
    loginError.textContent = err.message;
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await window.rbvpn.logout();
  await showLogin();
});

elAutoLogin.addEventListener('change', () => {
  if (elAutoLogin.checked) elSavePassword.checked = true;
});
optAutoLogin.addEventListener('change', async () => {
  if (optAutoLogin.checked) optSavePassword.checked = true;
  await persistPrefsFrom({
    savePassword: optSavePassword,
    autoLogin: optAutoLogin,
    openAtLogin: optOpenAtLogin,
  });
});
optSavePassword.addEventListener('change', async () => {
  if (!optSavePassword.checked) optAutoLogin.checked = false;
  await persistPrefsFrom({
    savePassword: optSavePassword,
    autoLogin: optAutoLogin,
    openAtLogin: optOpenAtLogin,
  });
});
optOpenAtLogin.addEventListener('change', async () => {
  await persistPrefsFrom({
    savePassword: optSavePassword,
    autoLogin: optAutoLogin,
    openAtLogin: optOpenAtLogin,
  });
});

nodeSelect.addEventListener('change', async () => {
  await window.rbvpn.saveSettings({ nodeId: nodeSelect.value });
});

document.getElementById('btn-open-log').addEventListener('click', async () => {
  await window.rbvpn.openLog();
});

document.getElementById('btn-connect').addEventListener('click', async () => {
  appMsg.textContent = 'Connecting…';
  setConnected(false);
  if (unsubProgress) unsubProgress();
  unsubProgress = window.rbvpn.onConnectProgress(({ message }) => {
    if (message) appMsg.textContent = message;
  });
  try {
    const nodeId = nodeSelect.value;
    await window.rbvpn.saveSettings({ nodeId });
    const config = await window.rbvpn.ensureDevice({ nodeId });
    const result = await window.rbvpn.connect();
    if (!result.ok) {
      appMsg.textContent = result.error + (result.detail ? `\n${result.detail}` : '');
      setConnected(false);
      return;
    }
    setConnected(true);
    appMsg.textContent = `${result.message || 'Connected'} · ${config.nodeName}`;
  } catch (err) {
    setConnected(false);
    appMsg.textContent = err.message;
  } finally {
    if (unsubProgress) {
      unsubProgress();
      unsubProgress = null;
    }
  }
});

document.getElementById('btn-disconnect').addEventListener('click', async () => {
  appMsg.textContent = 'Disconnecting…';
  if (unsubProgress) unsubProgress();
  unsubProgress = window.rbvpn.onConnectProgress(({ message }) => {
    if (message) appMsg.textContent = message;
  });
  const result = await window.rbvpn.disconnect();
  setConnected(false);
  appMsg.textContent = result.ok ? 'Disconnected' : result.error || 'Disconnected';
  if (unsubProgress) {
    unsubProgress();
    unsubProgress = null;
  }
});

boot();
