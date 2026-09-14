const loginView = document.getElementById('view-login');
const appView = document.getElementById('view-app');
const statusPill = document.getElementById('status-pill');
const loginError = document.getElementById('login-error');
const appMsg = document.getElementById('app-msg');
const subLine = document.getElementById('sub-line');
const userEmail = document.getElementById('user-email');

function setConnected(on) {
  statusPill.textContent = on ? 'Connected' : 'Disconnected';
  statusPill.classList.toggle('on', on);
  statusPill.classList.toggle('off', !on);
}

async function showApp(email) {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  userEmail.textContent = email || '';
  appMsg.textContent = '';
  try {
    const { subscription } = await window.rbvpn.fetchSubscription();
    if (!subscription) {
      subLine.textContent = 'No active plan. Buy one on the website first.';
    } else {
      const ends = new Date(subscription.endsAt).toLocaleDateString();
      subLine.textContent = `${subscription.plan.name} · active until ${ends}`;
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
  document.getElementById('apiUrl').value = settings.apiUrl || 'http://localhost:4000';
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

document.getElementById('btn-refresh').addEventListener('click', async () => {
  appMsg.textContent = 'Fetching WireGuard config…';
  try {
    const config = await window.rbvpn.ensureDevice();
    appMsg.textContent = `Config ready · ${config.nodeName} (${config.endpoint})\n${await window.rbvpn.showConfPath()}`;
  } catch (err) {
    appMsg.textContent = err.message;
  }
});

document.getElementById('btn-connect').addEventListener('click', async () => {
  appMsg.textContent = 'Preparing tunnel…';
  try {
    await window.rbvpn.ensureDevice();
    const result = await window.rbvpn.connect();
    if (!result.ok) {
      appMsg.textContent = result.error;
      setConnected(false);
      return;
    }
    setConnected(true);
    appMsg.textContent = result.message || 'Connected';
  } catch (err) {
    setConnected(false);
    appMsg.textContent = err.message;
  }
});

document.getElementById('btn-disconnect').addEventListener('click', async () => {
  const result = await window.rbvpn.disconnect();
  setConnected(false);
  appMsg.textContent = result.ok
    ? 'Disconnected'
    : result.error || 'Disconnected (manual deactivate may be required)';
});

boot();
