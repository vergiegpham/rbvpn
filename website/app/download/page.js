'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import SiteNav from '@/components/SiteNav';
import { getStoredUser, getToken } from '@/lib/api';

export default function DownloadPage() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (getToken()) setUser(getStoredUser());
  }, []);

  return (
    <div className="form-shell">
      <SiteNav />
      <section className="section">
        <h2>Download</h2>
        <p className="lead">
          Get the RB-VPN Windows app — a single installer. Sign in with your account and
          connect.
        </p>

        <div className="dash-grid">
          <div className="panel">
            <h3>Windows</h3>
            <p className="lead">
              Download <strong>RB-VPN Setup.msi</strong>, install, then open RB-VPN from the
              Start menu or desktop shortcut.
            </p>
            <a className="btn-primary" href="/downloads/RB-VPN-Setup.msi">
              Download for Windows
            </a>
            <p className="lead" style={{ marginTop: '0.75rem' }}>
              The Setup includes everything needed to connect. Install, sign in, and click
              Connect.
            </p>
          </div>
          <div className="panel">
            <h3>How to connect</h3>
            <ol className="lead">
              {user ? (
                <>
                  <li>Buy or extend a plan if you do not have one yet.</li>
                  <li>Install RB-VPN and sign in with this account.</li>
                  <li>Choose a location and click Connect.</li>
                  <li>Confirm your public IP matches the RB-VPN exit.</li>
                </>
              ) : (
                <>
                  <li>Create an account and buy a plan.</li>
                  <li>Install RB-VPN and sign in.</li>
                  <li>Click Connect (approve administrator if prompted).</li>
                  <li>Confirm your public IP matches the RB-VPN exit.</li>
                </>
              )}
            </ol>
            {user ? (
              <Link
                href={user.role === 'admin' ? '/admin' : '/dashboard'}
                className="btn-primary"
              >
                {user.role === 'admin' ? 'Open admin' : 'Go to dashboard'}
              </Link>
            ) : (
              <Link href="/register" className="btn-primary">
                Create account
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
