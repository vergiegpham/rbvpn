/** Parse `wg show <iface> dump` into Map<publicKey, { allowedIps, latestHandshake }>. */
export function parseWgDump(text) {
  const peers = new Map();
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  // Line 1 describes the interface; each following line is one peer (8 tab-separated columns).
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    if (cols.length < 8) continue;
    const [publicKey, , , allowedIps, latestHandshake] = cols;
    peers.set(publicKey, {
      allowedIps: !allowedIps || allowedIps === '(none)' ? [] : allowedIps.split(','),
      latestHandshake: Number(latestHandshake) || 0,
    });
  }
  return peers;
}

/**
 * Decide which `wg set` calls bring the interface in line with the API.
 *
 * peers: API rows { id, clientPublicKey, clientIp, syncStatus }
 * live:  result of parseWgDump
 * prune: remove live peers the API does not know (only safe with a complete peer list)
 * keep:  public keys never pruned (e.g. a static admin peer)
 */
export function planReconcile(peers, live, { prune = false, keep = new Set() } = {}) {
  const desired = new Map();
  const removals = new Map();

  for (const peer of peers) {
    const key = peer.clientPublicKey;
    if (!key) continue;
    if ((peer.syncStatus === 'pending' || peer.syncStatus === 'synced') && peer.clientIp) {
      desired.set(key, peer);
    } else if (peer.syncStatus === 'release_pending' || peer.syncStatus === 'delete_pending') {
      if (!removals.has(key)) removals.set(key, []);
      removals.get(key).push(peer.id);
    }
  }

  const add = [];
  const ackApplied = [];
  for (const [key, peer] of desired) {
    const current = live.get(key);
    const want = `${peer.clientIp}/32`;
    const correct = current && current.allowedIps.length === 1 && current.allowedIps[0] === want;
    if (!correct) {
      add.push({ key, ip: peer.clientIp, id: peer.id, restore: peer.syncStatus === 'synced' });
    } else if (peer.syncStatus === 'pending') {
      ackApplied.push(peer.id);
    }
  }

  const remove = [];
  const ackDeleted = [];
  for (const [key, ids] of removals) {
    // Another row still wants this key, or it is already gone: just acknowledge.
    if (desired.has(key) || !live.has(key)) ackDeleted.push(...ids);
    else remove.push({ key, ids });
  }

  if (prune) {
    for (const key of live.keys()) {
      if (desired.has(key) || removals.has(key) || keep.has(key)) continue;
      remove.push({ key, ids: [] });
    }
  }

  return { add, remove, ackApplied, ackDeleted };
}
