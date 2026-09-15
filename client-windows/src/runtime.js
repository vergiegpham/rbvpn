/**
 * Locate bundled RB-VPN network runtime MSI (no internet download).
 */
const fs = require('fs');
const path = require('path');

function bundledRuntimePath() {
  const name = 'rbvpn-network-runtime.msi';
  const candidates = [
    // Packaged: resources/tunnel/
    path.join(process.resourcesPath || '', 'tunnel', name),
    // Dev: vendor/tunnel/
    path.join(__dirname, '..', 'vendor', 'tunnel', name),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p) && fs.statSync(p).size >= 1_000_000) return p;
  }
  return null;
}

function ensureRuntimeInstaller() {
  const bundled = bundledRuntimePath();
  if (bundled) return bundled;
  throw new Error(
    'RB-VPN network runtime is missing from this installation. Reinstall RB-VPN Setup.'
  );
}

module.exports = { ensureRuntimeInstaller, bundledRuntimePath };
