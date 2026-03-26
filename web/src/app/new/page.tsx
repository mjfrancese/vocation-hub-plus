'use client';

import { useMemo } from 'react';
import { getPositions, getMeta, formatRelativeTime } from '@/lib/data';
import PositionTable from '@/components/PositionTable';
import ExportButton from '@/components/ExportButton';
import LastUpdated from '@/components/LastUpdated';

export default function NewPositionsPage() {
  const meta = useMemo(() => getMeta(), []);
  const newPositions = useMemo(() => {
    const positions = getPositions();
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    return positions
      .filter((p) => {
        if (!p.first_seen) return false;
        return new Date(p.first_seen) >= fourteenDaysAgo;
      })
      .sort((a, b) => new Date(b.first_seen).getTime() - new Date(a.first_seen).getTime());
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Positions</h1>
          <p className="text-sm text-gray-500">
            Positions first seen in the last 14 days, sorted newest first
          </p>
          <LastUpdated timestamp={meta.lastUpdated} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">{newPositions.length} new positions</span>
          <ExportButton positions={newPositions} filename="new-positions" />
        </div>
      </div>

      {newPositions.length > 0 ? (
        <div className="space-y-2">
          {newPositions.map((pos) => (
            <div
              key={pos.id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:border-green-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900">{pos.name}</h3>
                  <p className="text-sm text-gray-600">
                    {pos.diocese} &middot; {pos.state}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">{pos.position_type}</p>
                </div>
                <div className="text-right">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    NEW
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    {formatRelativeTime(pos.first_seen)}
                  </p>
                </div>
              </div>
              {pos.receiving_names_from && (
                <p className="text-xs text-gray-500 mt-2">
                  Receiving names: {pos.receiving_names_from}
                  {pos.receiving_names_to ? ` to ${pos.receiving_names_to}` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No new positions in the last 14 days</p>
          <p className="text-sm mt-1">Check back after the next scrape</p>
        </div>
      )}
    </div>
  );
}
