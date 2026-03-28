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
import { getStatusStyle, getStatusShortLabel, isClosedStatus } from '@/lib/status-helpers';
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
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [hideClosed, setHideClosed] = useState(true);

  // Build filter options from data
  const states = useMemo(() => getUniqueValues(allPositions, 'state'), [allPositions]);
  const dioceses = useMemo(() => getUniqueValues(allPositions, 'diocese'), [allPositions]);
  const positionTypes = useMemo(() => getUniqueValues(allPositions, 'position_type'), [allPositions]);
  const regions = useMemo(() => getUniqueProfileValues(allPositions, 'Geographic Location'), [allPositions]);
  const settings = useMemo(() => getUniqueProfileValues(allPositions, 'Ministry Setting'), [allPositions]);
  const housingTypes = useMemo(() => getUniqueHousingValues(allPositions), [allPositions]);
  const healthcareOptions = useMemo(() => getUniqueProfileValues(allPositions, 'Healthcare Options'), [allPositions]);
  const statusOptions = useMemo(() => {
    const vals = new Set<string>();
    for (const p of allPositions) {
      const s = p.vh_status || p.status;
      if (s && s.trim()) vals.add(s.trim());
    }
    return Array.from(vals).sort();
  }, [allPositions]);

  // Status counts for quick-filter chips
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of allPositions) {
      const s = p.vh_status || p.status || 'Unknown';
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [allPositions]);

  const newCount = useMemo(() => allPositions.filter(p => p.is_new).length, [allPositions]);

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
    if (selectedStatuses.length > 0)
      results = results.filter(p => selectedStatuses.includes(p.vh_status || p.status));
    if (hideClosed)
      results = results.filter(p => !isClosedStatus(p.vh_status || ''));

    return results;
  }, [allPositions, searchIndex, query, selectedStates, selectedDioceses, selectedTypes,
      selectedCompensation, selectedRegion, selectedSetting, selectedHousing, selectedHealthcare,
      selectedStatuses, hideClosed]);

  function clearFilters() {
    setSelectedStates([]);
    setSelectedDioceses([]);
    setSelectedTypes([]);
    setSelectedCompensation([]);
    setSelectedRegion([]);
    setSelectedSetting([]);
    setSelectedHousing([]);
    setSelectedHealthcare([]);
    setSelectedStatuses([]);
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
    { key: 'status', label: 'Status', options: statusOptions, selected: selectedStatuses, onChange: setSelectedStatuses, width: 'w-44' },
  ];

  const hasActiveFilters = filterConfigs.some(f => f.selected.length > 0);

  // Quick filter chip handler
  function toggleStatusChip(status: string) {
    if (selectedStatuses.includes(status)) {
      setSelectedStatuses(selectedStatuses.filter(s => s !== status));
    } else {
      setSelectedStatuses([status]);
      // When selecting a closed status chip, auto-uncheck hide closed
      if (isClosedStatus(status)) {
        setHideClosed(false);
      }
    }
  }

  function showNew() {
    setSelectedStatuses([]);
    setHideClosed(false);
    // We'll filter by is_new in the results instead
  }

  const [showNewOnly, setShowNewOnly] = useState(false);

  const displayedPositions = useMemo(() => {
    if (showNewOnly) return filtered.filter(p => p.is_new);
    return filtered;
  }, [filtered, showNewOnly]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Position Search</h1>
          <LastUpdated timestamp={meta.lastUpdated} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            {displayedPositions.length} of {allPositions.length} positions
            {hasActiveFilters || query || hideClosed || showNewOnly ? ' (filtered)' : ''}
          </span>
          <ExportButton positions={displayedPositions} />
        </div>
      </div>

      {/* Quick filter chips */}
      <div className="flex flex-wrap gap-2">
        <QuickChip
          label={`New (${newCount})`}
          active={showNewOnly}
          onClick={() => setShowNewOnly(!showNewOnly)}
          color="bg-emerald-50 text-emerald-700 border-emerald-200"
          activeColor="bg-emerald-600 text-white border-emerald-600"
        />
        <QuickChip
          label={`Receiving (${statusCounts['Receiving names'] || 0})`}
          active={selectedStatuses.includes('Receiving names')}
          onClick={() => { setShowNewOnly(false); toggleStatusChip('Receiving names'); }}
          color="bg-green-50 text-green-700 border-green-200"
          activeColor="bg-green-600 text-white border-green-600"
        />
        <QuickChip
          label={`Developing (${(statusCounts['Developing profile'] || 0) + (statusCounts['Beginning search'] || 0) + (statusCounts['Profile complete'] || 0) + (statusCounts['Developing self study'] || 0)})`}
          active={selectedStatuses.some(s => ['Developing profile', 'Beginning search', 'Profile complete', 'Developing self study'].includes(s))}
          onClick={() => {
            setShowNewOnly(false);
            const devStatuses = ['Developing profile', 'Beginning search', 'Profile complete', 'Developing self study'];
            const allSelected = devStatuses.every(s => selectedStatuses.includes(s));
            if (allSelected) {
              setSelectedStatuses(selectedStatuses.filter(s => !devStatuses.includes(s)));
            } else {
              setSelectedStatuses(devStatuses);
            }
          }}
          color="bg-blue-50 text-blue-700 border-blue-200"
          activeColor="bg-blue-600 text-white border-blue-600"
        />
        <QuickChip
          label={`Interim (${(statusCounts['Seeking interim'] || 0) + (statusCounts['Interim in place'] || 0)})`}
          active={selectedStatuses.some(s => ['Seeking interim', 'Interim in place'].includes(s))}
          onClick={() => {
            setShowNewOnly(false);
            const interimStatuses = ['Seeking interim', 'Interim in place'];
            const allSelected = interimStatuses.every(s => selectedStatuses.includes(s));
            if (allSelected) {
              setSelectedStatuses(selectedStatuses.filter(s => !interimStatuses.includes(s)));
            } else {
              setSelectedStatuses(interimStatuses);
              setHideClosed(false);
            }
          }}
          color="bg-yellow-50 text-yellow-700 border-yellow-200"
          activeColor="bg-yellow-600 text-white border-yellow-600"
        />
        <QuickChip
          label={`Closed (${(statusCounts['Search complete'] || 0) + (statusCounts['No longer receiving names'] || 0)})`}
          active={selectedStatuses.some(s => isClosedStatus(s)) && !hideClosed}
          onClick={() => {
            setShowNewOnly(false);
            const closedStatuses = ['Search complete', 'No longer receiving names'];
            const allSelected = closedStatuses.every(s => selectedStatuses.includes(s));
            if (allSelected && !hideClosed) {
              setSelectedStatuses(selectedStatuses.filter(s => !closedStatuses.includes(s)));
              setHideClosed(true);
            } else {
              setSelectedStatuses(closedStatuses);
              setHideClosed(false);
            }
          }}
          color="bg-gray-50 text-gray-600 border-gray-200"
          activeColor="bg-gray-600 text-white border-gray-600"
        />
      </div>

      <SearchBar
        value={query}
        onChange={setQuery}
        resultCount={query || hasActiveFilters ? displayedPositions.length : undefined}
      />

      <Filters
        filters={filterConfigs}
        onClear={clearFilters}
        hideClosed={hideClosed}
        onHideClosedChange={setHideClosed}
      />

      <PositionTable positions={displayedPositions} />

      {changes.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Changes</h2>
          <ChangeLog changes={changes} limit={10} />
        </div>
      )}
    </div>
  );
}

function QuickChip({
  label,
  active,
  onClick,
  color,
  activeColor,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color: string;
  activeColor: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
        active ? activeColor : color
      } hover:opacity-80`}
    >
      {label}
    </button>
  );
}
