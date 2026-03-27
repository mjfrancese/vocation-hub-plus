'use client';

import { useMemo, useState } from 'react';
import { getPositions, getMeta, getUniqueValues, getChanges } from '@/lib/data';
import { createSearchIndex, searchPositions } from '@/lib/search';
import { Position } from '@/lib/types';
import SearchBar from '@/components/SearchBar';
import Filters from '@/components/Filters';
import PositionTable from '@/components/PositionTable';
import ExportButton from '@/components/ExportButton';
import LastUpdated from '@/components/LastUpdated';
import ChangeLog from '@/components/ChangeLog';

// Vocation Hub's predefined compensation ranges (from the dropdown on their site)
const COMPENSATION_RANGES = [
  '$0 - $25,000',
  '$25,001 - $50,000',
  '$50,001 - $75,000',
  '$75,001 - $100,000',
  '$100,001 - $125,000',
  '$125,001 - $150,000',
  '$150,001 - $175,000',
  '$175,001 - $200,000',
  '$200,001 and above',
];

/**
 * Extract the compensation range for a position from its deep scrape fields.
 * Returns the predefined range value if found, or the raw salary text.
 */
function getCompensationRange(pos: Position): string {
  const fields = pos.deep_scrape_fields || [];
  for (const f of fields) {
    const label = f.label.toLowerCase();
    if (label === 'range' || label.includes('compensation') || label.includes('stipend')) {
      // Check if it matches a predefined range
      for (const range of COMPENSATION_RANGES) {
        if (f.value.includes(range) || f.value.startsWith(range.split(' ')[0])) {
          return range;
        }
      }
      // Return raw value for non-standard entries
      return f.value;
    }
  }
  return '';
}

export default function HomePage() {
  const allPositions = useMemo(() => getPositions(), []);
  const meta = useMemo(() => getMeta(), []);
  const changes = useMemo(() => getChanges(), []);
  const searchIndex = useMemo(() => createSearchIndex(allPositions), [allPositions]);

  const [query, setQuery] = useState('');
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedDioceses, setSelectedDioceses] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedCompensation, setSelectedCompensation] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState('');

  const states = useMemo(() => getUniqueValues(allPositions, 'state'), [allPositions]);
  const dioceses = useMemo(() => getUniqueValues(allPositions, 'diocese'), [allPositions]);
  const positionTypes = useMemo(() => getUniqueValues(allPositions, 'position_type'), [allPositions]);

  // Only show the predefined VH compensation ranges
  const compensationOptions = COMPENSATION_RANGES;

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
    if (selectedCompensation.length > 0) {
      results = results.filter((p) => {
        const range = getCompensationRange(p);
        return selectedCompensation.includes(range);
      });
    }
    if (statusFilter) {
      results = results.filter((p) => p.status === statusFilter);
    }

    return results;
  }, [allPositions, searchIndex, query, selectedStates, selectedDioceses, selectedTypes, selectedCompensation, statusFilter]);

  function clearFilters() {
    setSelectedStates([]);
    setSelectedDioceses([]);
    setSelectedTypes([]);
    setSelectedCompensation([]);
    setStatusFilter('');
  }

  const hasActiveFilters = selectedStates.length > 0 || selectedDioceses.length > 0 ||
    selectedTypes.length > 0 || selectedCompensation.length > 0 || statusFilter;

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
        compensationRanges={compensationOptions}
        selectedStates={selectedStates}
        selectedDioceses={selectedDioceses}
        selectedTypes={selectedTypes}
        selectedCompensation={selectedCompensation}
        selectedStatus={statusFilter}
        onStatesChange={setSelectedStates}
        onDiocesesChange={setSelectedDioceses}
        onTypesChange={setSelectedTypes}
        onCompensationChange={setSelectedCompensation}
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
