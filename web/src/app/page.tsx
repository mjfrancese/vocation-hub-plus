'use client';

import { useMemo, useState } from 'react';
import { getPositions, getMeta, getUniqueValues, getChanges } from '@/lib/data';
import { createSearchIndex, searchPositions } from '@/lib/search';
import SearchBar from '@/components/SearchBar';
import Filters from '@/components/Filters';
import PositionTable from '@/components/PositionTable';
import ExportButton from '@/components/ExportButton';
import LastUpdated from '@/components/LastUpdated';
import ChangeLog from '@/components/ChangeLog';

export default function HomePage() {
  const allPositions = useMemo(() => getPositions(), []);
  const meta = useMemo(() => getMeta(), []);
  const changes = useMemo(() => getChanges(), []);
  const searchIndex = useMemo(() => createSearchIndex(allPositions), [allPositions]);

  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [dioceseFilter, setDioceseFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const states = useMemo(() => getUniqueValues(allPositions, 'state'), [allPositions]);
  const dioceses = useMemo(() => getUniqueValues(allPositions, 'diocese'), [allPositions]);
  const positionTypes = useMemo(() => getUniqueValues(allPositions, 'position_type'), [allPositions]);

  const filtered = useMemo(() => {
    let results = query ? searchPositions(searchIndex, query) : allPositions;

    if (stateFilter) results = results.filter((p) => p.state === stateFilter);
    if (dioceseFilter) results = results.filter((p) => p.diocese === dioceseFilter);
    if (typeFilter) results = results.filter((p) => p.position_type === typeFilter);
    if (statusFilter) results = results.filter((p) => p.status === statusFilter);

    return results;
  }, [allPositions, searchIndex, query, stateFilter, dioceseFilter, typeFilter, statusFilter]);

  function clearFilters() {
    setStateFilter('');
    setDioceseFilter('');
    setTypeFilter('');
    setStatusFilter('');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Position Search</h1>
          <LastUpdated timestamp={meta.lastUpdated} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            {meta.activeCount + meta.newCount} active positions
          </span>
          <ExportButton positions={filtered} />
        </div>
      </div>

      <SearchBar value={query} onChange={setQuery} resultCount={query ? filtered.length : undefined} />

      <Filters
        states={states}
        dioceses={dioceses}
        positionTypes={positionTypes}
        selectedState={stateFilter}
        selectedDiocese={dioceseFilter}
        selectedType={typeFilter}
        selectedStatus={statusFilter}
        onStateChange={setStateFilter}
        onDioceseChange={setDioceseFilter}
        onTypeChange={setTypeFilter}
        onStatusChange={setStatusFilter}
        onClear={clearFilters}
      />

      <PositionTable positions={filtered} />

      {changes.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Changes</h2>
          <ChangeLog changes={changes} limit={10} />
        </div>
      )}
    </div>
  );
}
