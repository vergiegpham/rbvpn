const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('rbvpn_token');
}

export function setAuth(token, user) {
  localStorage.setItem('rbvpn_token', token);
  localStorage.setItem('rbvpn_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('rbvpn_token');
  localStorage.removeItem('rbvpn_user');
}

export function getStoredUser() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('rbvpn_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Only same-site paths; `//host` would leave the site. */
export function safeNextPath(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

/**
 * `auth: false` for login/register so a stale token never rides along.
 * `redirectOn401: false` on public pages: an expired session just signs out quietly.
 */
export async function api(path, { method = 'GET', body, token, auth = true, redirectOn401 = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const bearer = auth ? (token ?? getToken()) : null;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the RB-VPN server. Check your connection and try again.');
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && bearer && typeof window !== 'undefined') {
    // Expired or revoked session (password changed, secret rotated): sign in again.
    clearAuth();
    if (redirectOn401 && !window.location.pathname.startsWith('/login')) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = `/login?next=${encodeURIComponent(next)}`;
    }
  }
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Request failed');
  }
  return data;
}

export function formatMoney(cents, currency = 'usd') {
  const amount = (Number(cents) || 0) / 100;
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(currency || 'usd').toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}
