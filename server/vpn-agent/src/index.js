import dotenv from 'dotenv';
import { execFileSync } from 'child_process';

dotenv.config();

const API_URL = process.env.API_URL || 'http://127.0.0.1:4000';
const NODE_ID = process.env.NODE_ID;
const SECRET = process.env.NODE_AGENT_SECRET;
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 10000);
const WG_BIN = process.env.WG_BIN || 'wg';
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!NODE_ID || !SECRET) {
  console.error('NODE_ID and NODE_AGENT_SECRET are required');
  process.exit(1);
}

function wg(args) {
  if (DRY_RUN) {
    console.log('[dry-run] wg', args.join(' '));
    return '';
  }
  return execFileSync(WG_BIN, args, { encoding: 'utf8' });
}

async function syncOnce() {
  const res = await fetch(`${API_URL}/api/agent/peers?nodeId=${encodeURIComponent(NODE_ID)}`, {
    headers: { 'x-node-agent-secret': SECRET },
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const iface = data.node.interfaceName || 'wg0';
  const applied = [];
  const deleted = [];

  for (const peer of data.peers) {
    if (peer.syncStatus === 'pending') {
      wg([
        'set',
        iface,
        'peer',
        peer.clientPublicKey,
        'allowed-ips',
        `${peer.clientIp}/32`,
      ]);
      applied.push(peer.id);
      console.log(`Applied peer ${peer.id} (${peer.clientIp})`);
    } else if (peer.syncStatus === 'delete_pending') {
      wg(['set', iface, 'peer', peer.clientPublicKey, 'remove']);
      deleted.push(peer.id);
      console.log(`Removed peer ${peer.id}`);
    }
  }

  if (applied.length || deleted.length) {
    const ack = await fetch(`${API_URL}/api/agent/peers/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-node-agent-secret': SECRET,
      },
      body: JSON.stringify({ applied, deleted }),
    });
    if (!ack.ok) {
      throw new Error(`Ack failed ${ack.status}: ${await ack.text()}`);
    }
  } else {
    console.log(`[${new Date().toISOString()}] no peer changes`);
  }
}

async function loop() {
  console.log(`RB-VPN node agent started for ${NODE_ID}`);
  for (;;) {
    try {
      await syncOnce();
    } catch (err) {
      console.error('Sync error:', err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

loop();
