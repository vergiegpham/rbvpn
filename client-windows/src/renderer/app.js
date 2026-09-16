const loginView = document.getElementById('view-login');
const appView = document.getElementById('view-app');
const statusPill = document.getElementById('status-pill');
const loginError = document.getElementById('login-error');
const appMsg = document.getElementById('app-msg');
const subLine = document.getElementById('sub-line');
const userEmail = document.getElementById('user-email');
const nodeSelect = document.getElementById('nodeSelect');

let unsubProgress = null;

function setConnected(on) {
  statusPill.textContent = on ? 'Connected' : 'Disconnected';
  statusPill.classList.toggle('on', on);
  statusPill.classList.toggle('off', !on);
  document.getElementById('btn-connect').classList.toggle('hidden', on);
  document.getElementById('btn-disconnect').classList.toggle('hidden', !on);
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

async function showApp(email) {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  userEmail.textContent = email || '';
  appMsg.textContent = '';
  setConnected(false);
  const settings = await window.rbvpn.getSettings();
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

function showLogin() {
  appView.classList.add('hidden');
  loginView.classList.remove('hidden');
  setConnected(false);
}

async function boot() {
  const settings = await window.rbvpn.getSettings();
  document.getElementById('apiUrl').value = settings.apiUrl || 'http://162.35.175.39:4000';
  document.getElementById('email').value = settings.email || '';
  if (settings.token) {
    await showApp(settings.email);
  } else {
    showLogin();
  }
}

document.getElementById('btn-login').addEventListener('click', async () => {
  loginError.textContent = '';
  try {
    const user = await window.rbvpn.login({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
      apiUrl: document.getElementById('apiUrl').value.trim(),
    });
    await showApp(user.email);
  } catch (err) {
    loginError.textContent = err.message;
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await window.rbvpn.logout();
  showLogin();
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
