'use client';

import { useMemo, useState } from 'react';
import { getPositions, getMeta, getUniqueValues, getChanges } from '@/lib/data';
import { createSearchIndex, searchPositions } from '@/lib/search';
import { Position } from '@/lib/types';
import {
  getProfileField,
  getCompensationRange,
  categorizeHousing,
  getUniqueProfileValues,
  getUniqueHousingValues,
  COMPENSATION_RANGES,
} from '@/lib/profile-helpers';
import SearchBar from '@/components/SearchBar';
import Filters, { FilterConfig } from '@/components/Filters';
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
  const [selectedCompensation, setSelectedCompensation] = useState<string[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string[]>([]);
  const [selectedSetting, setSelectedSetting] = useState<string[]>([]);
  const [selectedHousing, setSelectedHousing] = useState<string[]>([]);
  const [selectedHealthcare, setSelectedHealthcare] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState('');

  // Build filter options from data
  const states = useMemo(() => getUniqueValues(allPositions, 'state'), [allPositions]);
  const dioceses = useMemo(() => getUniqueValues(allPositions, 'diocese'), [allPositions]);
  const positionTypes = useMemo(() => getUniqueValues(allPositions, 'position_type'), [allPositions]);
  const regions = useMemo(() => getUniqueProfileValues(allPositions, 'Geographic Location'), [allPositions]);
  const settings = useMemo(() => getUniqueProfileValues(allPositions, 'Ministry Setting'), [allPositions]);
  const housingTypes = useMemo(() => getUniqueHousingValues(allPositions), [allPositions]);
  const healthcareOptions = useMemo(() => getUniqueProfileValues(allPositions, 'Healthcare Options'), [allPositions]);

  const filtered = useMemo(() => {
    let results = query ? searchPositions(searchIndex, query) : allPositions;

    if (selectedStates.length > 0)
      results = results.filter(p => selectedStates.includes(p.state));
    if (selectedDioceses.length > 0)
      results = results.filter(p => selectedDioceses.includes(p.diocese));
    if (selectedTypes.length > 0)
      results = results.filter(p => selectedTypes.includes(p.position_type));
    if (selectedCompensation.length > 0)
      results = results.filter(p => selectedCompensation.includes(getCompensationRange(p)));
    if (selectedRegion.length > 0)
      results = results.filter(p => selectedRegion.includes(getProfileField(p, 'Geographic Location')));
    if (selectedSetting.length > 0)
      results = results.filter(p => selectedSetting.includes(getProfileField(p, 'Ministry Setting')));
    if (selectedHousing.length > 0)
      results = results.filter(p => selectedHousing.includes(categorizeHousing(getProfileField(p, 'Type of Housing Provided'))));
    if (selectedHealthcare.length > 0)
      results = results.filter(p => selectedHealthcare.includes(getProfileField(p, 'Healthcare Options')));
    if (statusFilter)
      results = results.filter(p => p.status === statusFilter);

    return results;
  }, [allPositions, searchIndex, query, selectedStates, selectedDioceses, selectedTypes,
      selectedCompensation, selectedRegion, selectedSetting, selectedHousing, selectedHealthcare, statusFilter]);

  function clearFilters() {
    setSelectedStates([]);
    setSelectedDioceses([]);
    setSelectedTypes([]);
    setSelectedCompensation([]);
    setSelectedRegion([]);
    setSelectedSetting([]);
    setSelectedHousing([]);
    setSelectedHealthcare([]);
    setStatusFilter('');
  }

  const filterConfigs: FilterConfig[] = [
    { key: 'state', label: 'State', options: states, selected: selectedStates, onChange: setSelectedStates, width: 'w-36' },
    { key: 'diocese', label: 'Diocese', options: dioceses, selected: selectedDioceses, onChange: setSelectedDioceses, width: 'w-48' },
    { key: 'type', label: 'Position Type', options: positionTypes, selected: selectedTypes, onChange: setSelectedTypes, width: 'w-52' },
    { key: 'comp', label: 'Compensation', options: COMPENSATION_RANGES, selected: selectedCompensation, onChange: setSelectedCompensation, width: 'w-52' },
    { key: 'region', label: 'Region', options: regions, selected: selectedRegion, onChange: setSelectedRegion, width: 'w-40' },
    { key: 'setting', label: 'Setting', options: settings, selected: selectedSetting, onChange: setSelectedSetting, width: 'w-40' },
    { key: 'housing', label: 'Housing', options: housingTypes, selected: selectedHousing, onChange: setSelectedHousing, width: 'w-48' },
    { key: 'healthcare', label: 'Healthcare', options: healthcareOptions, selected: selectedHealthcare, onChange: setSelectedHealthcare, width: 'w-40' },
  ];

  const hasActiveFilters = filterConfigs.some(f => f.selected.length > 0) || statusFilter;

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
        filters={filterConfigs}
        statusValue={statusFilter}
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
