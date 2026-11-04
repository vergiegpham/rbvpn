import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWgDump, planReconcile } from '../src/reconcile.js';

const DUMP = [
  'privKEY=\tpubKEY=\t51820\toff',
  'keyA=\t(none)\t1.2.3.4:5000\t10.10.0.5/32\t1700000000\t100\t200\toff',
  'keyStale=\t(none)\t(none)\t10.10.0.4/32\t0\t0\t0\toff',
  'keyWrongIp=\t(none)\t(none)\t10.10.0.9/32\t0\t0\t0\toff',
].join('\n');

test('parseWgDump reads peers and skips the interface line', () => {
  const live = parseWgDump(DUMP);
  assert.equal(live.size, 3);
  assert.deepEqual(live.get('keyA='), { allowedIps: ['10.10.0.5/32'], latestHandshake: 1700000000 });
  assert.equal(live.has('pubKEY='), false);
});

test('restores synced peers missing after a reboot, without re-acking them', () => {
  const plan = planReconcile(
    [{ id: 'd1', clientPublicKey: 'keyB=', clientIp: '10.10.0.6', syncStatus: 'synced' }],
    new Map()
  );
  assert.deepEqual(plan.add, [{ key: 'keyB=', ip: '10.10.0.6', id: 'd1', restore: true }]);
  assert.deepEqual(plan.ackApplied, []);
});

test('applies pending peers and acks ones already correct', () => {
  const live = parseWgDump(DUMP);
  const plan = planReconcile(
    [
      { id: 'p1', clientPublicKey: 'keyA=', clientIp: '10.10.0.5', syncStatus: 'pending' },
      { id: 'p2', clientPublicKey: 'keyWrongIp=', clientIp: '10.10.0.7', syncStatus: 'pending' },
      { id: 'p3', clientPublicKey: 'keyNoIp=', clientIp: null, syncStatus: 'pending' },
    ],
    live
  );
  assert.deepEqual(plan.ackApplied, ['p1']);
  assert.deepEqual(plan.add, [{ key: 'keyWrongIp=', ip: '10.10.0.7', id: 'p2', restore: false }]);
});

test('removes released peers that are live and acks ones already gone', () => {
  const live = parseWgDump(DUMP);
  const plan = planReconcile(
    [
      { id: 'r1', clientPublicKey: 'keyA=', clientIp: '10.10.0.5', syncStatus: 'release_pending' },
      { id: 'r2', clientPublicKey: 'keyGone=', clientIp: '10.10.0.8', syncStatus: 'delete_pending' },
    ],
    live
  );
  assert.deepEqual(plan.remove, [{ key: 'keyA=', ids: ['r1'] }]);
  assert.deepEqual(plan.ackDeleted, ['r2']);
});

test('prunes unknown peers only when asked, honoring the keep list', () => {
  const live = parseWgDump(DUMP);
  const peers = [{ id: 's1', clientPublicKey: 'keyA=', clientIp: '10.10.0.5', syncStatus: 'synced' }];

  assert.deepEqual(planReconcile(peers, live).remove, []);

  const pruned = planReconcile(peers, live, { prune: true, keep: new Set(['keyWrongIp=']) });
  assert.deepEqual(pruned.remove, [{ key: 'keyStale=', ids: [] }]);
  assert.deepEqual(pruned.add, []);
});
