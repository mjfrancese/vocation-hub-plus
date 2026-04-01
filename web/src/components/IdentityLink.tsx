'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ME_TOKEN_KEY } from '@/lib/constants';

export default function IdentityLink({ className }: { className?: string }) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('me');
    const savedToken = localStorage.getItem(ME_TOKEN_KEY);
    setToken(urlToken || savedToken || null);
  }, []);

  const defaultClass = className || 'text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors';

  if (token) {
    return <Link href={`/me?me=${token}`} className={defaultClass}>My Dashboard</Link>;
  }
  return <Link href="/claim/" className={defaultClass}>This is me</Link>;
}
