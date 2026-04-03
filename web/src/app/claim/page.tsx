'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Fuse from 'fuse.js';
import type { ClaimSearchEntry } from '@/lib/types';
import { ME_TOKEN_KEY } from '@/lib/constants';

export default function ClaimPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<ClaimSearchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [existingToken, setExistingToken] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(ME_TOKEN_KEY);
    if (saved) setExistingToken(saved);

    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    fetch(`${base}/data/clergy-search-index.json`)
      .then(r => r.json())
      .then((data: ClaimSearchEntry[]) => { setEntries(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const fuse = useMemo(() => {
    if (entries.length === 0) return null;
    return new Fuse(entries, {
      keys: ['name'],
      threshold: 0.3,
      includeScore: true,
    });
  }, [entries]);

  const results = useMemo(() => {
    if (!fuse || query.length < 3) return [];
    return fuse.search(query, { limit: 10 }).map(r => r.item);
  }, [fuse, query]);

  const handleClaim = useCallback((token: string) => {
    localStorage.setItem(ME_TOKEN_KEY, token);
    router.push(`/?me=${token}`);
  }, [router]);

  const handleSwitchIdentity = useCallback(() => {
    localStorage.removeItem(ME_TOKEN_KEY);
    setExistingToken(null);
    setQuery('');
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-gray-500">Loading clergy directory...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Find Yourself</h1>
      <p className="text-gray-600 mb-6">
        Search for your name to unlock personalized compensation benchmarks,
        career context, and position comparisons.
      </p>

      {existingToken && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-800">
            You already have a saved identity.{' '}
            <button
              onClick={() => router.push(`/me?me=${existingToken}`)}
              className="font-semibold underline hover:no-underline"
            >
              Go to your dashboard
            </button>
            {' '}or{' '}
            <button
              onClick={handleSwitchIdentity}
              className="font-semibold underline hover:no-underline"
            >
              switch identity
            </button>.
          </p>
        </div>
      )}

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Enter your name..."
        aria-label="Search by name"
        className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        autoFocus
      />

      {query.length > 0 && query.length < 3 && (
        <p className="text-sm text-gray-400 mt-2">Type at least 3 characters to search</p>
      )}

      {results.length > 0 && (
        <div className="mt-4 space-y-3">
          {results.map(entry => (
            <div
              key={entry.token}
              className="border border-gray-200 rounded-lg p-4 hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer"
              onClick={() => handleClaim(entry.token)}
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-gray-900">{entry.name}</h3>
                  <p className="text-sm text-gray-600">
                    {[entry.current_position, entry.current_parish].filter(Boolean).join(', ')}
                  </p>
                  <p className="text-sm text-gray-500">
                    {[entry.diocese, entry.city && entry.state ? `${entry.city}, ${entry.state}` : null].filter(Boolean).join(' \u00b7 ')}
                  </p>
                  {entry.ordination_year && (
                    <p className="text-xs text-gray-400 mt-1">Ordained {entry.ordination_year}</p>
                  )}
                </div>
                <button className="text-sm font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap ml-4">
                  This is me
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {query.length >= 3 && results.length === 0 && (
        <p className="text-gray-500 mt-4">No matching clergy found for &ldquo;{query}&rdquo;</p>
      )}
    </div>
  );
}
