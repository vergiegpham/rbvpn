import crypto from 'crypto';
import { execFileSync } from 'child_process';

export function generateWireGuardKeyPair() {
  try {
    const privateKey = execFileSync('wg', ['genkey'], { encoding: 'utf8' }).trim();
    const publicKey = execFileSync('wg', ['pubkey'], {
      encoding: 'utf8',
      input: `${privateKey}\n`,
    }).trim();
    return { privateKey, publicKey };
  } catch {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
    const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    return {
      privateKey: Buffer.from(privDer).subarray(-32).toString('base64'),
      publicKey: Buffer.from(pubDer).subarray(-32).toString('base64'),
    };
  }
}

export function ipFromIndex(gatewayIp, index) {
  const parts = gatewayIp.split('.').map(Number);
  const base = (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  // gateway is .1, clients start at .2 — index is absolute last octet style from nextClientIp
  const ipNum = (base & ~0xff) + index;
  return [
    (ipNum >>> 24) & 255,
    (ipNum >>> 16) & 255,
    (ipNum >>> 8) & 255,
    ipNum & 255,
  ].join('.');
}

export function buildClientConfig({
  privateKey,
  address,
  dns = '8.8.8.8',
  serverPublicKey,
  endpoint,
  allowedIps = '0.0.0.0/0',
  mtu = 1280,
}) {
  // /24 puts the client on the VPN LAN (gateway + peers); server still pins each peer as ip/32.
  const ifaceAddress = String(address).includes('/') ? address : `${address}/24`;
  return [
    '[Interface]',
    `PrivateKey = ${privateKey}`,
    `Address = ${ifaceAddress}`,
    `DNS = ${dns}`,
    `MTU = ${mtu}`,
    '',
    '[Peer]',
    `PublicKey = ${serverPublicKey}`,
    `AllowedIPs = ${allowedIps}`,
    `Endpoint = ${endpoint}`,
    'PersistentKeepalive = 25',
    '',
  ].join('\n');
}
