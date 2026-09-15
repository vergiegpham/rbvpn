'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clearAuth, getStoredUser } from '@/lib/api';

const links = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/messages', label: 'Messages' },
  { href: '/admin/nodes', label: 'Nodes' },
  { href: '/admin/plans', label: 'Plans' },
];

export default function AdminShell({ children, title }) {
  const pathname = usePathname();
  const user = getStoredUser();

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">RB-VPN Admin</div>
        <p className="admin-user">{user?.email}</p>
        <nav className="admin-nav">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={pathname === l.href ? 'admin-nav-link active' : 'admin-nav-link'}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <Link href="/dashboard" className="admin-nav-link">
            User dashboard
          </Link>
          <button
            type="button"
            className="admin-nav-link admin-btn"
            onClick={() => {
              clearAuth();
              window.location.href = '/login';
            }}
          >
            Log out
          </button>
        </div>
      </aside>
      <main className="admin-main">
        {title && <h1 className="admin-title">{title}</h1>}
        {children}
      </main>
    </div>
  );
}
