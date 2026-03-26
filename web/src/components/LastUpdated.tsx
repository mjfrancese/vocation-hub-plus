'use client';

import { formatRelativeTime } from '@/lib/data';

interface LastUpdatedProps {
  timestamp: string | null;
}

export default function LastUpdated({ timestamp }: LastUpdatedProps) {
  if (!timestamp) {
    return (
      <span className="text-sm text-gray-500">
        No data yet (run the scraper to populate)
      </span>
    );
  }

  return (
    <span className="text-sm text-gray-500">
      Last updated: {formatRelativeTime(timestamp)} ({new Date(timestamp).toLocaleDateString()})
    </span>
  );
}
