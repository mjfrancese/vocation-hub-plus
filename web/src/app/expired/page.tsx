'use client';

import { useMemo } from 'react';
import { getPositions, getMeta } from '@/lib/data';
import PositionTable from '@/components/PositionTable';
import ExportButton from '@/components/ExportButton';
import LastUpdated from '@/components/LastUpdated';
import { isClosedStatus } from '@/lib/status-helpers';

export default function ClosedPositionsPage() {
  const meta = useMemo(() => getMeta(), []);
  const closedPositions = useMemo(() => {
    return getPositions()
      .filter((p) => isClosedStatus(p.vh_status || '') || p.status === 'expired')
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Closed Positions</h1>
          <p className="text-sm text-gray-500">
            Positions marked as &ldquo;Search complete&rdquo; or &ldquo;No longer receiving names&rdquo; on Vocation Hub
          </p>
          <LastUpdated timestamp={meta.lastUpdated} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">{closedPositions.length} closed</span>
          <ExportButton positions={closedPositions} filename="closed-positions" />
        </div>
      </div>

      {closedPositions.length > 0 ? (
        <PositionTable positions={closedPositions} />
      ) : (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No closed positions tracked yet</p>
          <p className="text-sm mt-1">Positions will appear here when their search completes</p>
        </div>
      )}
    </div>
  );
}
