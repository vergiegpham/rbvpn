// End-to-end API checks against a disposable database.
// Usage: DATABASE_URL=postgresql://…/rbvpn_test node test/integration.mjs
// The script starts the API itself (ports 4100/4101) and refuses to run unless the database name ends in _test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = new URL(dbUrl.replace(/^postgresql:/, 'http:')).pathname.replace(/^\//, '');
if (!dbName.endsWith('_test')) {
  console.error(`Refusing to run: DATABASE_URL database "${dbName}" must end with _test`);
  process.exit(1);
}

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IPN_SECRET = 'integration-ipn-secret';
const AGENT_SECRET = crypto.randomBytes(24).toString('hex');
const ADMIN_EMAIL = 'admin@rbvpn.test';
const ADMIN_PASSWORD = 'Admin-Integration-1';

const baseEnv = {
  ...process.env,
  JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  NODE_AGENT_SECRET: AGENT_SECRET,
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  APP_URL: 'http://app.test',
  API_URL: 'http://api.test',
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
};
const servers = [];

function startServer(port, extra) {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: apiDir,
    env: { ...baseEnv, PORT: String(port), ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  child.stdout.on('data', (d) => (child.output += d));
  child.stderr.on('data', (d) => (child.output += d));
  servers.push(child);
  return child;
}

async function waitHealthy(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`API on ${port} did not start:\n${servers.map((s) => s.output).join('\n')}`);
}

function client(port) {
  return async function call(pathname, { method = 'GET', body, token, headers = {} } = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
}

const api = client(4100); // crypto configured, mock payments off
const mockApi = client(4101); // nothing configured, mock payments on
const agentHeaders = { 'x-node-agent-secret': AGENT_SECRET };

let prisma;
let sweepSessions;
let adminToken;
let nodeId;

function sortObject(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((result, key) => {
      result[key] = obj[key] && typeof obj[key] === 'object' ? sortObject(obj[key]) : obj[key];
      return result;
    }, {});
}

function ipnSignature(payload, secret = IPN_SECRET) {
  return crypto.createHmac('sha512', secret).update(JSON.stringify(sortObject(payload))).digest('hex');
}

let clientCounter = 0;

async function registerUser(prefix) {
  const email = `${prefix}-${crypto.randomBytes(4).toString('hex')}@rbvpn.test`;
  clientCounter += 1;
  const { status, data } = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'Password-123', name: prefix },
    // The API trusts X-Forwarded-For from loopback (nginx); distinct clients avoid the signup limit.
    headers: { 'x-forwarded-for': `198.51.100.${clientCounter}` },
  });
  assert.equal(status, 201, JSON.stringify(data));
  return { email, token: data.token, id: data.user.id };
}

async function grant(userId, planCode = 'pro') {
  const { status, data } = await api(`/api/admin/users/${userId}/subscription`, {
    method: 'POST',
    token: adminToken,
    body: { planCode },
  });
  assert.equal(status, 201, JSON.stringify(data));
}

before(async () => {
  process.env.JWT_SECRET = baseEnv.JWT_SECRET;
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();
  for (const table of ['Payment', 'Subscription', 'Device', 'ContactMessage', 'User', 'Plan', 'VpnNode']) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }

  // Seed twice: the second run must change nothing.
  for (let i = 0; i < 2; i++) {
    await new Promise((resolve, reject) => {
      const seed = spawn(process.execPath, ['prisma/seed.js'], {
        cwd: apiDir,
        env: { ...baseEnv, SEED_NODE_HOST: '203.0.113.10', SEED_NODE_PUBLIC_KEY: 'c2VydmVyLXB1YmxpYy1rZXktZm9yLXRlc3RzLTAwMDA=' },
        stdio: 'inherit',
      });
      seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
    });
  }

  startServer(4100, {
    NOWPAYMENTS_API_KEY: 'integration-api-key',
    NOWPAYMENTS_IPN_SECRET: IPN_SECRET,
    ALLOW_MOCK_PAYMENTS: 'false',
  });
  startServer(4101, { NOWPAYMENTS_API_KEY: '', NOWPAYMENTS_IPN_SECRET: '', ALLOW_MOCK_PAYMENTS: 'true' });
  await Promise.all([waitHealthy(4100), waitHealthy(4101)]);

  ({ sweepSessions } = await import('../src/services/sessions.js'));

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  adminToken = login.data.token;
  nodeId = (await prisma.vpnNode.findFirst()).id;
});

after(async () => {
  for (const s of servers) s.kill();
  await prisma?.$disconnect();
});

test('seed is idempotent and keeps admin edits', async () => {
  assert.equal(await prisma.plan.count(), 4);
  assert.equal(await prisma.user.count({ where: { role: 'admin' } }), 1);
  const node = await prisma.vpnNode.findFirst();
  assert.equal(node.active, true);

  const basic = await prisma.plan.findUnique({ where: { code: 'basic' } });
  const patched = await api(`/api/admin/plans/${basic.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { priceCents: 1234 },
  });
  assert.equal(patched.status, 200);
  await new Promise((resolve, reject) => {
    const seed = spawn(process.execPath, ['prisma/seed.js'], { cwd: apiDir, env: baseEnv, stdio: 'ignore' });
    seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
  });
  assert.equal((await prisma.plan.findUnique({ where: { code: 'basic' } })).priceCents, 1234);
});

test('errors are JSON and never crash the API', async () => {
  assert.equal((await api('/api/nope')).status, 404);
  const missing = await api('/api/admin/users/does-not-exist', {
    method: 'PATCH',
    token: adminToken,
    body: { name: 'x' },
  });
  assert.equal(missing.status, 404);
  const badJson = await api('/api/auth/login', { method: 'POST', body: '{not json' });
  assert.equal(badJson.status, 400);
  assert.equal((await api('/health')).status, 200);
});

test('register validation returns a readable message', async () => {
  const { status, data } = await api('/api/auth/register', {
    method: 'POST',
    body: { email: 'bad', password: 'x' },
  });
  assert.equal(status, 400);
  assert.equal(typeof data.error, 'string');
});

test('payment providers and mock gating', async () => {
  const real = await api('/api/payments/providers');
  assert.deepEqual(real.data.providers, {
    stripe: { available: false, mock: false },
    crypto: { available: true, mock: false },
  });
  const user = await registerUser('pay');
  const card = await api('/api/payments/checkout', {
    method: 'POST',
    token: user.token,
    body: { planCode: 'basic', provider: 'stripe' },
  });
  assert.equal(card.status, 503);
  assert.match(card.data.error, /not available/);
  assert.equal(
    (await api('/api/payments/mock/complete', { method: 'POST', token: user.token, body: { paymentId: 'x' } })).status,
    403
  );

  // Test server: mock checkout works, but only for payments it created in mock mode.
  const mock = await mockApi('/api/payments/checkout', {
    method: 'POST',
    token: user.token,
    body: { planCode: 'basic', provider: 'crypto' },
  });
  assert.equal(mock.status, 200);
  assert.equal(mock.data.mock, true);
  const realPending = await prisma.payment.create({
    data: {
      userId: user.id,
      planId: (await prisma.plan.findUnique({ where: { code: 'pro' } })).id,
      provider: 'nowpayments',
      amountCents: 1999,
      currency: 'usd',
    },
  });
  const forged = await mockApi('/api/payments/mock/complete', {
    method: 'POST',
    token: user.token,
    body: { paymentId: realPending.id },
  });
  assert.equal(forged.status, 400);
  const done = await mockApi('/api/payments/mock/complete', {
    method: 'POST',
    token: user.token,
    body: { paymentId: mock.data.paymentId },
  });
  assert.equal(done.status, 200);
  const sub = await api('/api/plans/subscription', { token: user.token });
  assert.equal(sub.data.subscription.plan.code, 'basic');
});

test('NOWPayments IPN requires a valid signature and completes exactly once', async () => {
  const user = await registerUser('ipn');
  const plan = await prisma.plan.findUnique({ where: { code: 'pro' } });
  const payment = await prisma.payment.create({
    data: { userId: user.id, planId: plan.id, provider: 'nowpayments', amountCents: plan.priceCents, currency: 'usd' },
  });
  const payload = {
    payment_id: 5077125051,
    payment_status: 'finished',
    order_id: payment.id,
    price_amount: plan.priceCents / 100,
    price_currency: 'usd',
    fee: { currency: 'usdttrc20', depositFee: 0, withdrawalFee: 0, serviceFee: 0 },
  };

  assert.equal((await api('/api/payments/crypto/ipn', { method: 'POST', body: payload })).status, 401);
  const wrong = await api('/api/payments/crypto/ipn', {
    method: 'POST',
    body: payload,
    headers: { 'x-nowpayments-sig': ipnSignature(payload, 'wrong-secret') },
  });
  assert.equal(wrong.status, 401);
  assert.equal((await prisma.payment.findUnique({ where: { id: payment.id } })).status, 'pending');

  // Providers retry; concurrent duplicates must extend the plan once.
  const signed = { 'x-nowpayments-sig': ipnSignature(payload) };
  const results = await Promise.all(
    Array.from({ length: 5 }, () => api('/api/payments/crypto/ipn', { method: 'POST', body: payload, headers: signed }))
  );
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results));
  const subs = await prisma.subscription.findMany({ where: { userId: user.id } });
  assert.equal(subs.length, 1);
  const days = (subs[0].endsAt - subs[0].startsAt) / 86400000;
  assert.ok(Math.abs(days - plan.durationDays) < 0.01, `extended ${days} days`);
  assert.equal((await prisma.payment.findUnique({ where: { id: payment.id } })).status, 'paid');
});

test('session lifecycle through the agent endpoints', async () => {
  const user = await registerUser('vpn');
  await grant(user.id, 'pro');
  const created = await api('/api/devices', {
    method: 'POST',
    token: user.token,
    body: { name: 'Windows-test-aaaa1111', nodeId },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const deviceId = created.data.device.id;

  // Double-click connect: one IP, same answer twice.
  const [c1, c2] = await Promise.all([
    api(`/api/devices/${deviceId}/connect`, { method: 'POST', token: user.token, body: {} }),
    api(`/api/devices/${deviceId}/connect`, { method: 'POST', token: user.token, body: {} }),
  ]);
  assert.equal(c1.status, 200, JSON.stringify(c1.data));
  assert.equal(c1.data.address, c2.data.address);

  const peers = await api(`/api/agent/peers?nodeId=${nodeId}&full=1`, { headers: agentHeaders });
  assert.equal(peers.status, 200);
  assert.equal(peers.data.full, true);
  const row = peers.data.peers.find((p) => p.id === deviceId);
  assert.equal(row.syncStatus, 'pending');
  assert.equal((await api(`/api/agent/peers?nodeId=${nodeId}`)).status, 401);

  await api('/api/agent/peers/ack', { method: 'POST', headers: agentHeaders, body: { applied: [deviceId] } });
  const config = await api(`/api/devices/${deviceId}/config`, { token: user.token });
  assert.equal(config.data.syncStatus, 'synced');
  assert.match(config.data.conf, /AllowedIPs = 0\.0\.0\.0\/0/);

  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  await prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: new Date(Date.now() - 3600_000) } });
  const report = await api('/api/agent/report', {
    method: 'POST',
    headers: agentHeaders,
    body: { nodeId, handshakes: { [device.clientPublicKey]: Math.floor(Date.now() / 1000) - 10 } },
  });
  assert.equal(report.data.active, 1);
  const refreshed = await prisma.device.findUnique({ where: { id: deviceId } });
  assert.ok(Date.now() - refreshed.lastSeenAt.getTime() < 10_000);
  assert.ok((await prisma.vpnNode.findUnique({ where: { id: nodeId } })).agentSeenAt);

  await api(`/api/devices/${deviceId}/disconnect`, { method: 'POST', token: user.token, body: {} });
  // A late "applied" ack must not undo the disconnect.
  await api('/api/agent/peers/ack', { method: 'POST', headers: agentHeaders, body: { applied: [deviceId] } });
  assert.equal((await prisma.device.findUnique({ where: { id: deviceId } })).syncStatus, 'release_pending');
  await api('/api/agent/peers/ack', { method: 'POST', headers: agentHeaders, body: { deleted: [deviceId] } });
  const idle = await prisma.device.findUnique({ where: { id: deviceId } });
  assert.equal(idle.syncStatus, 'idle');
  assert.equal(idle.clientIp, null);
});

test('concurrent connects on one node never share an IP', async () => {
  const user = await registerUser('race');
  await grant(user.id, 'pro');
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const d = await api('/api/devices', {
      method: 'POST',
      token: user.token,
      body: { name: `race-${i}`, nodeId },
    });
    assert.equal(d.status, 201, JSON.stringify(d.data));
    ids.push(d.data.device.id);
  }
  const results = await Promise.all(
    ids.map((id) => api(`/api/devices/${id}/connect`, { method: 'POST', token: user.token, body: {} }))
  );
  const addresses = results.map((r) => r.data.address);
  assert.equal(new Set(addresses).size, 3, addresses.join(', '));
});

test('sessions end with the plan, on cancel, on suspend, and when stale', async () => {
  async function connectedUser(prefix) {
    const user = await registerUser(prefix);
    await grant(user.id, 'basic');
    const d = await api('/api/devices', { method: 'POST', token: user.token, body: { name: prefix, nodeId } });
    await api(`/api/devices/${d.data.device.id}/connect`, { method: 'POST', token: user.token, body: {} });
    await prisma.device.update({
      where: { id: d.data.device.id },
      data: { syncStatus: 'synced', lastSeenAt: new Date() },
    });
    return { ...user, deviceId: d.data.device.id };
  }
  const status = async (id) => (await prisma.device.findUnique({ where: { id } })).syncStatus;

  const cancelled = await connectedUser('cancel');
  const res = await api(`/api/admin/users/${cancelled.id}/subscription/cancel`, { method: 'POST', token: adminToken });
  assert.equal(res.data.releasedSessions, 1);
  assert.equal(await status(cancelled.deviceId), 'release_pending');

  const expired = await connectedUser('expired');
  await prisma.subscription.updateMany({ where: { userId: expired.id }, data: { endsAt: new Date(Date.now() - 1000) } });
  await sweepSessions();
  assert.equal(await status(expired.deviceId), 'release_pending');

  const suspended = await connectedUser('suspended');
  await api(`/api/admin/users/${suspended.id}/suspend`, { method: 'POST', token: adminToken });
  assert.equal(await status(suspended.deviceId), 'delete_pending');
  assert.equal((await api('/api/devices', { token: suspended.token })).status, 403);
  await api(`/api/admin/users/${suspended.id}/unsuspend`, { method: 'POST', token: adminToken });
  const restored = await prisma.device.findUnique({ where: { id: suspended.deviceId } });
  assert.equal(restored.syncStatus, 'idle');
  assert.equal(restored.clientIp, null);

  // Stale reaping only trusts nodes whose agent is reporting.
  const stale = await connectedUser('stale');
  await prisma.device.update({ where: { id: stale.deviceId }, data: { lastSeenAt: new Date(Date.now() - 30 * 3600_000) } });
  await prisma.vpnNode.update({ where: { id: nodeId }, data: { agentSeenAt: null } });
  await sweepSessions();
  assert.equal(await status(stale.deviceId), 'synced');
  await prisma.vpnNode.update({ where: { id: nodeId }, data: { agentSeenAt: new Date() } });
  await sweepSessions();
  assert.equal(await status(stale.deviceId), 'release_pending');
});

test('password change and admin reset sign out old tokens', async () => {
  const user = await registerUser('pw');
  await new Promise((r) => setTimeout(r, 1100)); // tokens carry whole-second timestamps
  const wrong = await api('/api/auth/change-password', {
    method: 'POST',
    token: user.token,
    body: { currentPassword: 'nope', newPassword: 'Another-Pass-1' },
  });
  assert.equal(wrong.status, 400);
  const changed = await api('/api/auth/change-password', {
    method: 'POST',
    token: user.token,
    body: { currentPassword: 'Password-123', newPassword: 'Another-Pass-1' },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal((await api('/api/auth/me', { token: user.token })).status, 401);
  assert.equal((await api('/api/auth/me', { token: changed.data.token })).status, 200);

  await new Promise((r) => setTimeout(r, 1100));
  const reset = await api(`/api/admin/users/${user.id}/reset-password`, { method: 'POST', token: adminToken });
  assert.equal(reset.status, 200);
  assert.equal((await api('/api/auth/me', { token: changed.data.token })).status, 401);
  const relogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: user.email, password: reset.data.temporaryPassword },
  });
  assert.equal(relogin.status, 200);
});

test('login is rate limited per email', async () => {
  const user = await registerUser('brute');
  let last;
  for (let i = 0; i < 11; i++) {
    last = await api('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'wrong-password' } });
  }
  assert.equal(last.status, 429);
});

test(
  'vpn-agent restores synced peers, applies pending ones, prunes unknown peers, and reports',
  { skip: process.platform === 'win32' && 'needs a POSIX shell for the fake wg binary' },
  async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbvpn-agent-'));
    const dumpFile = path.join(dir, 'dump');
    const callsFile = path.join(dir, 'calls');
    const fakeWg = path.join(dir, 'wg');
    // Live interface after a "reboot": only a peer the API has never heard of.
    fs.writeFileSync(dumpFile, 'priv\tpub\t51820\toff\nUNKNOWNKEY=\t(none)\t(none)\t10.10.0.4/32\t0\t0\t0\toff\n');
    fs.writeFileSync(
      fakeWg,
      `#!/bin/sh\nif [ "$1" = show ]; then cat "${dumpFile}"; else echo "$@" >> "${callsFile}"; fi\n`,
      { mode: 0o755 }
    );

    const user = await registerUser('agent');
    await grant(user.id, 'pro');
    const make = async (name) => {
      const res = await api('/api/devices', { method: 'POST', token: user.token, body: { name, nodeId } });
      await api(`/api/devices/${res.data.device.id}/connect`, { method: 'POST', token: user.token, body: {} });
      return res.data.device.id;
    };
    const syncedId = await make('agent-synced');
    const pendingId = await make('agent-pending');
    await prisma.device.update({ where: { id: syncedId }, data: { syncStatus: 'synced' } });
    await prisma.vpnNode.update({ where: { id: nodeId }, data: { agentSeenAt: null } });

    const agent = spawn(process.execPath, ['src/index.js'], {
      cwd: path.resolve(apiDir, '..', 'server', 'vpn-agent'),
      env: {
        ...process.env,
        API_URL: 'http://127.0.0.1:4100',
        NODE_ID: nodeId,
        NODE_AGENT_SECRET: AGENT_SECRET,
        WG_BIN: fakeWg,
        POLL_INTERVAL_MS: '300',
        REPORT_INTERVAL_MS: '300',
        DRY_RUN: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    agent.stdout.on('data', (d) => (output += d));
    agent.stderr.on('data', (d) => (output += d));

    try {
      let pending;
      for (let i = 0; i < 40; i++) {
        pending = await prisma.device.findUnique({ where: { id: pendingId } });
        if (pending.syncStatus === 'synced') break;
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.equal(pending.syncStatus, 'synced', output);
      await new Promise((r) => setTimeout(r, 800));
    } finally {
      agent.kill();
    }

    const synced = await prisma.device.findUnique({ where: { id: syncedId } });
    const calls = fs.readFileSync(callsFile, 'utf8');
    assert.ok(
      calls.includes(`set wg0 peer ${synced.clientPublicKey} allowed-ips ${synced.clientIp}/32`),
      `synced peer not restored:\n${calls}`
    );
    assert.ok(calls.includes('set wg0 peer UNKNOWNKEY= remove'), `unknown peer not pruned:\n${calls}`);
    assert.equal(synced.syncStatus, 'synced');
    assert.ok((await prisma.vpnNode.findUnique({ where: { id: nodeId } })).agentSeenAt, output);
  }
);

test('admin search is case-insensitive and devices list works', async () => {
  const users = await api('/api/admin/users?q=ADMIN@RBVPN', { token: adminToken });
  assert.ok(users.data.users.some((u) => u.email === ADMIN_EMAIL));
  const devices = await api('/api/admin/devices?live=1', { token: adminToken });
  assert.equal(devices.status, 200);
  assert.ok(Array.isArray(devices.data.devices));
  const nodes = await api('/api/admin/nodes', { token: adminToken });
  assert.equal(typeof nodes.data.nodes[0].liveSessions, 'number');
});
