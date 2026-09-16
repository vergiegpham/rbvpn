'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getStoredUser, getToken } from '@/lib/api';

export default function HeroCta({ variant = 'hero' }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (getToken()) setUser(getStoredUser());
  }, []);

  if (user) {
    return (
      <div className="cta-row">
        <Link href={user.role === 'admin' ? '/admin' : '/dashboard'} className="btn-primary">
          {user.role === 'admin' ? 'Open admin' : 'Go to dashboard'}
        </Link>
        <Link href="/download" className="btn-secondary">
          Download app
        </Link>
        {variant === 'footer' && (
          <Link href="/pricing" className="btn-secondary">
            View plans
          </Link>
        )}
      </div>
    );
  }

  if (variant === 'footer') {
    return (
      <div className="cta-row">
        <Link href="/register" className="btn-primary">
          Start free account
        </Link>
        <Link href="/pricing" className="btn-secondary">
          Compare plans
        </Link>
        <Link href="/download" className="btn-secondary">
          Download for Windows
        </Link>
      </div>
    );
  }

  return (
    <div className="cta-row">
      <Link href="/register" className="btn-primary">
        Start free account
      </Link>
      <Link href="/pricing" className="btn-secondary">
        View plans
      </Link>
    </div>
  );
}
