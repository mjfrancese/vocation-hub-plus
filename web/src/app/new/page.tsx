'use client';

import { useMemo } from 'react';
import { getPositions, getMeta } from '@/lib/data';
import PositionTable from '@/components/PositionTable';
import ExportButton from '@/components/ExportButton';
import LastUpdated from '@/components/LastUpdated';
import StatusBadge from '@/components/StatusBadge';

export default function NewPositionsPage() {
  const meta = useMemo(() => getMeta(), []);
  const newPositions = useMemo(() => {
    return getPositions()
      .filter((p) => p.is_new)
      .sort((a, b) => {
        // Sort by receiving_names_from date, then by name
        if (a.receiving_names_from && b.receiving_names_from) {
          return new Date(b.receiving_names_from).getTime() - new Date(a.receiving_names_from).getTime();
        }
        if (a.receiving_names_from) return -1;
        if (b.receiving_names_from) return 1;
        return a.name.localeCompare(b.name);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Positions</h1>
          <p className="text-sm text-gray-500">
            Positions that began receiving names in the last 30 days
          </p>
          <LastUpdated timestamp={meta.lastUpdated} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">{newPositions.length} new positions</span>
          <ExportButton positions={newPositions} filename="new-positions" />
        </div>
      </div>

      {newPositions.length > 0 ? (
        <PositionTable positions={newPositions} />
      ) : (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No new positions in the last 30 days</p>
          <p className="text-sm mt-1">Check back after the next scrape</p>
        </div>
      )}
    </div>
  );
}
