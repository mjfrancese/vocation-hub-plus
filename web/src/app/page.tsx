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
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedDioceses, setSelectedDioceses] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState('');

  const states = useMemo(() => getUniqueValues(allPositions, 'state'), [allPositions]);
  const dioceses = useMemo(() => getUniqueValues(allPositions, 'diocese'), [allPositions]);
  const positionTypes = useMemo(() => getUniqueValues(allPositions, 'position_type'), [allPositions]);

  const filtered = useMemo(() => {
    let results = query ? searchPositions(searchIndex, query) : allPositions;

    if (selectedStates.length > 0) {
      results = results.filter((p) => selectedStates.includes(p.state));
    }
    if (selectedDioceses.length > 0) {
      results = results.filter((p) => selectedDioceses.includes(p.diocese));
    }
    if (selectedTypes.length > 0) {
      results = results.filter((p) => selectedTypes.includes(p.position_type));
    }
    if (statusFilter) {
      results = results.filter((p) => p.status === statusFilter);
    }

    return results;
  }, [allPositions, searchIndex, query, selectedStates, selectedDioceses, selectedTypes, statusFilter]);

  function clearFilters() {
    setSelectedStates([]);
    setSelectedDioceses([]);
    setSelectedTypes([]);
    setStatusFilter('');
  }

  const hasActiveFilters = selectedStates.length > 0 || selectedDioceses.length > 0 ||
    selectedTypes.length > 0 || statusFilter;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Position Search</h1>
          <LastUpdated timestamp={meta.lastUpdated} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            {filtered.length} of {allPositions.length} positions
            {hasActiveFilters || query ? ' (filtered)' : ''}
          </span>
          <ExportButton positions={filtered} />
        </div>
      </div>

      <SearchBar
        value={query}
        onChange={setQuery}
        resultCount={query || hasActiveFilters ? filtered.length : undefined}
      />

      <Filters
        states={states}
        dioceses={dioceses}
        positionTypes={positionTypes}
        selectedStates={selectedStates}
        selectedDioceses={selectedDioceses}
        selectedTypes={selectedTypes}
        selectedStatus={statusFilter}
        onStatesChange={setSelectedStates}
        onDiocesesChange={setSelectedDioceses}
        onTypesChange={setSelectedTypes}
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
