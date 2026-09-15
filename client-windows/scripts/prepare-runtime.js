/**
 * Bundle the full WireGuard amd64 MSI as "RB-VPN network runtime".
 * The small wireguard-installer.exe only downloads this MSI at runtime —
 * we ship the MSI itself so Setup needs no internet for the tunnel stack.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, '..', 'vendor', 'tunnel');
const OUT_FILE = path.join(OUT_DIR, 'rbvpn-network-runtime.msi');
const SOURCE =
  process.env.RBVPN_RUNTIME_URL ||
  'https://download.wireguard.com/windows-client/wireguard-amd64-1.1.msi';

// Official amd64 MSI is ~3MB; reject truncated downloads that break NSIS.
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

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Drop legacy fetcher .exe if present
  const legacyExe = path.join(OUT_DIR, 'rbvpn-network-runtime.exe');
  if (fs.existsSync(legacyExe)) fs.unlinkSync(legacyExe);

  if (fs.existsSync(OUT_FILE) && fs.statSync(OUT_FILE).size >= MIN_BYTES) {
    console.log('Runtime MSI already present:', OUT_FILE, `(${fs.statSync(OUT_FILE).size} bytes)`);
    return;
  }
  if (fs.existsSync(OUT_FILE)) {
    console.log('Removing truncated runtime MSI...');
    fs.unlinkSync(OUT_FILE);
  }
  console.log('Downloading network runtime MSI...');
  const tmp = `${OUT_FILE}.download`;
  await download(SOURCE, tmp);
  const size = fs.statSync(tmp).size;
  if (size < MIN_BYTES) {
    fs.unlinkSync(tmp);
    throw new Error(`Runtime MSI too small (${size} bytes). Expected >= ${MIN_BYTES}.`);
  }
  fs.renameSync(tmp, OUT_FILE);
  console.log('Saved', OUT_FILE, `(${size} bytes)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
