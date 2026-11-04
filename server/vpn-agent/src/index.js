import dotenv from 'dotenv';
import { execFileSync } from 'child_process';
import { parseWgDump, planReconcile } from './reconcile.js';

dotenv.config();

const API_URL = (process.env.API_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const NODE_ID = process.env.NODE_ID;
const SECRET = process.env.NODE_AGENT_SECRET;
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 10000);
const REPORT_MS = Number(process.env.REPORT_INTERVAL_MS || 30000);
const WG_BIN = process.env.WG_BIN || 'wg';
const DRY_RUN = process.env.DRY_RUN === 'true';
// The agent owns the interface: peers the API does not know (stale, deleted users) are removed.
const PRUNE_UNKNOWN = process.env.PRUNE_UNKNOWN_PEERS !== 'false';
const KEEP_PEERS = new Set(
  String(process.env.KEEP_PEERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

if (!NODE_ID || !SECRET) {
  console.error('NODE_ID and NODE_AGENT_SECRET are required');
  process.exit(1);
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function wgRead(args) {
  return execFileSync(WG_BIN, args, { encoding: 'utf8', timeout: 10000 });
}

function wgWrite(args) {
  if (DRY_RUN) {
    log(`[dry-run] wg ${args.join(' ')}`);
    return '';
  }
  return execFileSync(WG_BIN, args, { encoding: 'utf8', timeout: 10000 });
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'x-node-agent-secret': SECRET,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = new Error(`API ${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

let iface = 'wg0';

async function syncOnce() {
  const data = await api(`/api/agent/peers?nodeId=${encodeURIComponent(NODE_ID)}&full=1`);
  iface = data.node?.interfaceName || 'wg0';

  // Never prune from a failed read: an exception here skips the whole cycle.
  const live = parseWgDump(wgRead(['show', iface, 'dump']));
  const plan = planReconcile(data.peers || [], live, {
    // Older APIs ignore full=1; pruning against a partial list would drop connected users.
    prune: PRUNE_UNKNOWN && data.full === true,
    keep: KEEP_PEERS,
  });

  const applied = [...plan.ackApplied];
  const deleted = [...plan.ackDeleted];

  for (const item of plan.add) {
    try {
      wgWrite(['set', iface, 'peer', item.key, 'allowed-ips', `${item.ip}/32`]);
      if (!item.restore) applied.push(item.id);
      log(`${item.restore ? 'Restored' : 'Applied'} peer ${item.id} (${item.ip})`);
    } catch (err) {
      console.error(`Failed to apply peer ${item.id}: ${err.message}`);
    }
  }

  for (const item of plan.remove) {
    try {
      wgWrite(['set', iface, 'peer', item.key, 'remove']);
      deleted.push(...item.ids);
      log(item.ids.length ? `Removed peer ${item.ids.join(', ')}` : `Pruned unknown peer ${item.key.slice(0, 8)}…`);
    } catch (err) {
      console.error(`Failed to remove peer ${item.key.slice(0, 8)}…: ${err.message}`);
    }
  }

  if (applied.length || deleted.length) {
    await api('/api/agent/peers/ack', { method: 'POST', body: { applied, deleted } });
  }
}

let reportSupported = true;

async function reportOnce() {
  if (!reportSupported) return;
  const live = parseWgDump(wgRead(['show', iface, 'dump']));
  const handshakes = {};
  for (const [key, peer] of live) {
    if (peer.latestHandshake > 0) handshakes[key] = peer.latestHandshake;
  }
  try {
    await api('/api/agent/report', { method: 'POST', body: { nodeId: NODE_ID, handshakes } });
  } catch (err) {
    if (err.status === 404 && !/Node not found/.test(err.message)) {
      // API predates /report — keep syncing peers, skip heartbeats.
      reportSupported = false;
      log('API has no /api/agent/report endpoint; heartbeats disabled');
      return;
    }
    throw err;
  }
}

async function loop() {
  log(`RB-VPN node agent started for ${NODE_ID} (prune unknown peers: ${PRUNE_UNKNOWN})`);
  let lastReport = 0;
  for (;;) {
    try {
      await syncOnce();
    } catch (err) {
      console.error('Sync error:', err.message);
    }
    if (Date.now() - lastReport >= REPORT_MS) {
      lastReport = Date.now();
      try {
        await reportOnce();
      } catch (err) {
        console.error('Report error:', err.message);
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => process.exit(0));
}

loop();
