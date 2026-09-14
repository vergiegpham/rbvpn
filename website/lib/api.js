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

export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const auth = token ?? getToken();
  if (auth) headers.Authorization = `Bearer ${auth}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Request failed');
  }
  return data;
}

export { API_URL };
