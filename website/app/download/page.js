import Link from 'next/link';
import SiteNav from '@/components/SiteNav';

export default function DownloadPage() {
  return (
    <div className="form-shell">
      <SiteNav />
      <section className="section">
        <h2>Download</h2>
        <p className="lead">
          RB-VPN for Windows uses the official WireGuard driver. Install both pieces below.
        </p>

        <div className="dash-grid">
          <div className="panel">
            <h3>1. WireGuard for Windows</h3>
            <p className="lead">
              Required tunnel engine from the WireGuard project.
            </p>
            <a
              className="btn-primary"
              href="https://www.wireguard.com/install/"
              target="_blank"
              rel="noreferrer"
            >
              Get WireGuard
            </a>
          </div>
          <div className="panel">
            <h3>2. RB-VPN client</h3>
            <p className="lead">
              From this repo: <code>client-windows</code>. Run with npm after installing
              dependencies.
            </p>
            <pre
              style={{
                background: '#0f1a28',
                color: '#d7e6ff',
                padding: '0.9rem',
                borderRadius: '0.75rem',
                overflow: 'auto',
              }}
            >{`cd client-windows
npm install
npm start`}</pre>
          </div>
        </div>

        <div className="panel" style={{ marginTop: '1rem' }}>
          <h3>Connect flow</h3>
          <ol className="lead">
            <li>Create an account and buy a plan (Stripe or crypto).</li>
            <li>Open RB-VPN client → sign in with the same email.</li>
            <li>Click Connect — the app fetches a WireGuard config and activates the tunnel.</li>
            <li>Verify exit IP (e.g. visit ifconfig.me) matches your VPS.</li>
          </ol>
          <Link href="/register" className="btn-primary">
            Create account
          </Link>
        </div>
      </section>
    </div>
  );
}
