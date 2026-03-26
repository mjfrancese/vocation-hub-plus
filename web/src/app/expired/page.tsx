'use client';

import { useMemo } from 'react';
import { getPositions, getMeta, formatRelativeTime } from '@/lib/data';
import PositionTable from '@/components/PositionTable';
import ExportButton from '@/components/ExportButton';
import LastUpdated from '@/components/LastUpdated';

export default function ExpiredPositionsPage() {
  const meta = useMemo(() => getMeta(), []);
  const expiredPositions = useMemo(() => {
    return getPositions()
      .filter((p) => p.status === 'expired')
      .sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime());
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Expired Positions</h1>
          <p className="text-sm text-gray-500">
            Positions that no longer appear on Vocation Hub (likely filled or closed)
          </p>
          <LastUpdated timestamp={meta.lastUpdated} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">{expiredPositions.length} expired</span>
          <ExportButton positions={expiredPositions} filename="expired-positions" />
        </div>
      </div>

      {expiredPositions.length > 0 ? (
        <div className="space-y-2">
          {expiredPositions.map((pos) => (
            <div
              key={pos.id}
              className="bg-white border border-gray-200 rounded-lg p-4 opacity-80"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-medium text-gray-700">{pos.name}</h3>
                  <p className="text-sm text-gray-500">
                    {pos.diocese} &middot; {pos.state}
                  </p>
                  <p className="text-sm text-gray-400 mt-1">{pos.position_type}</p>
                </div>
                <div className="text-right">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    Expired
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    Last seen {formatRelativeTime(pos.last_seen)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No expired positions tracked yet</p>
          <p className="text-sm mt-1">Positions will appear here once they are removed from Vocation Hub</p>
        </div>
      )}
    </div>
  );
}
