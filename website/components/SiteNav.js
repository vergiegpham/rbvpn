'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clearAuth, getStoredUser, getToken } from '@/lib/api';

export default function SiteNav() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (getToken()) setUser(getStoredUser());
  }, []);

  function logout() {
    clearAuth();
    setUser(null);
    window.location.href = '/';
  }

  return (
    <nav className="nav">
      <Link href="/" className="nav-brand">
        RB-VPN
      </Link>
      <div className="nav-links">
        <Link href="/pricing">Pricing</Link>
        <Link href="/download">Download</Link>
        <Link href="/contact">Contact</Link>
        {user ? (
          <>
            <Link href="/dashboard">Dashboard</Link>
            {user.role === 'admin' && <Link href="/admin">Admin</Link>}
            <button type="button" className="nav-btn" onClick={logout}>
              Log out
            </button>
          </>
        ) : (
          <>
            <Link href="/login">Log in</Link>
            <Link href="/register" className="nav-cta">
              Get started
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
