/**
 * Bundle WireGuard amd64 as RB-VPN network runtime.
 * Downloads the official MSI, then administratively extracts WireGuard.exe
 * into vendor/tunnel/WireGuard so the MSI installer can ship binaries
 * (WiX/MSI does not run NSIS customInstall hooks).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const OUT_DIR = path.join(__dirname, '..', 'vendor', 'tunnel');
const OUT_MSI = path.join(OUT_DIR, 'rbvpn-network-runtime.msi');
const WG_DIR = path.join(OUT_DIR, 'WireGuard');
const WG_EXE = path.join(WG_DIR, 'wireguard.exe');
const SOURCE =
  process.env.RBVPN_RUNTIME_URL ||
  'https://download.wireguard.com/windows-client/wireguard-amd64-1.0.1.msi';

const MIN_BYTES = 1_000_000;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {}
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {}
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', (err) => {
        try {
          fs.unlinkSync(dest);
        } catch {}
        reject(err);
      });
  });
}

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function extractWireGuardFromMsi(msiPath) {
  if (fs.existsSync(WG_EXE) && fs.statSync(WG_EXE).size > 50_000) {
    console.log('WireGuard binaries already extracted:', WG_EXE);
    return;
  }

  const extractRoot = path.join(OUT_DIR, '_msi_extract');
  rmrf(extractRoot);
  fs.mkdirSync(extractRoot, { recursive: true });

  console.log('Extracting WireGuard from MSI (msiexec /a)...');
  execFileSync(
    'msiexec.exe',
    ['/a', msiPath, '/qn', `TARGETDIR=${extractRoot}`],
    { stdio: 'inherit', windowsHide: true }
  );

  const extracted = path.join(extractRoot, 'WireGuard');
  const extractedExe = path.join(extracted, 'wireguard.exe');
  if (!fs.existsSync(extractedExe)) {
    throw new Error(`msiexec /a did not produce ${extractedExe}`);
  }

  rmrf(WG_DIR);
  fs.cpSync(extracted, WG_DIR, { recursive: true });
  // Drop nested copy of the MSI left by administrative install.
  const nestedMsi = path.join(OUT_DIR, 'rbvpn-network-runtime.msi');
  // Keep OUT_MSI; remove any MSI copied into extract/WG folders.
  for (const p of [
    path.join(extractRoot, path.basename(msiPath)),
    path.join(WG_DIR, path.basename(msiPath)),
    path.join(WG_DIR, 'rbvpn-network-runtime.msi'),
  ]) {
    try {
      if (fs.existsSync(p) && path.resolve(p) !== path.resolve(nestedMsi)) fs.unlinkSync(p);
    } catch {}
  }
  rmrf(extractRoot);
  console.log('Extracted WireGuard to', WG_DIR);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const legacyExe = path.join(OUT_DIR, 'rbvpn-network-runtime.exe');
  if (fs.existsSync(legacyExe)) fs.unlinkSync(legacyExe);

  if (!fs.existsSync(OUT_MSI) || fs.statSync(OUT_MSI).size < MIN_BYTES) {
    if (fs.existsSync(OUT_MSI)) {
      console.log('Removing truncated runtime MSI...');
      fs.unlinkSync(OUT_MSI);
    }
    console.log('Downloading network runtime MSI...');
    const tmp = `${OUT_MSI}.download`;
    await download(SOURCE, tmp);
    const size = fs.statSync(tmp).size;
    if (size < MIN_BYTES) {
      fs.unlinkSync(tmp);
      throw new Error(`Runtime MSI too small (${size} bytes). Expected >= ${MIN_BYTES}.`);
    }
    fs.renameSync(tmp, OUT_MSI);
    console.log('Saved', OUT_MSI, `(${size} bytes)`);
    // Force re-extract after new download.
    rmrf(WG_DIR);
  } else {
    console.log('Runtime MSI already present:', OUT_MSI, `(${fs.statSync(OUT_MSI).size} bytes)`);
  }

  extractWireGuardFromMsi(OUT_MSI);
  if (!fs.existsSync(WG_EXE)) {
    throw new Error(`Missing ${WG_EXE} after extract`);
  }
  console.log('Ready:', WG_EXE, `(${fs.statSync(WG_EXE).size} bytes)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
