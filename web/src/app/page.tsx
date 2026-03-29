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
  // Group position types into simplified categories for the filter dropdown
  const POSITION_TYPE_GROUPS: Record<string, string[]> = {
    'Rector / Vicar / Priest-in-Charge': [
      'Rector / Vicar / Priest-in-Charge',
      'Rector/Priest-in-Charge',
      'Vicar',
    ],
    'Rector / Vicar / PiC (Part-time)': [
      'Rector / Vicar / Priest-in-Charge (Part-time)',
      'Priest-in-Charge Shared Ministry',
      'Bi-vocational Priest',
    ],
    'Assistant / Associate / Curate': [
      'Assistant/Associate/Curate',
      'Assistant / Associate / Curate (Part-time)',
      'Associate Rector / Senior Associate Rector',
    ],
    'Dean / Cathedral': [
      'Cathedral Dean',
      'Dean',
      'Cathedral Staff',
    ],
    'Interim': ['Interim', 'Supply'],
    'Bishop': ['Bishop Diocesan'],
    'Canon / Diocesan Staff': [
      'Canon to the Ordinary',
      'Canon for Congregational Development',
      'Diocesan/Regional Staff',
      'Missioner',
    ],
    'Chaplain': [
      'Chaplain, School',
      'Chaplain, Care Facility',
      'Chaplain, Port',
      'Chaplain, Other',
    ],
    'Other': [
      'Director',
      'Director of Development',
      'Director of Peace & Justice',
      'Christian Education Director/DRE',
      'Camp/Conference Center Director',
      'Head of School',
      'Church Planter',
      'Youth Minister',
      'Academic Research',
    ],
  };
  const positionTypeOptions = useMemo(() => Object.keys(POSITION_TYPE_GROUPS), []);
  // Map from raw position_type to group label
  const positionTypeGroupMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [group, types] of Object.entries(POSITION_TYPE_GROUPS)) {
      for (const t of types) map[t] = group;
    }
    return map;
  }, []);
  const regions = useMemo(() => getUniqueProfileValues(allPositions, 'Geographic Location'), [allPositions]);
  const settings = useMemo(() => getUniqueProfileValues(allPositions, 'Ministry Setting'), [allPositions]);
  const housingTypes = useMemo(() => getUniqueHousingValues(allPositions), [allPositions]);
  const healthcareOptions = useMemo(() => getUniqueProfileValues(allPositions, 'Healthcare Options'), [allPositions]);
  // Group statuses into simplified categories for the filter dropdown
  const STATUS_GROUPS: Record<string, string[]> = {
    'Receiving': ['Receiving names', 'Reopened'],
    'Developing': ['Beginning search', 'Developing profile', 'Profile complete', 'Developing self study'],
    'Interim': ['Seeking interim', 'Interim in place'],
    'Closed': ['Search complete', 'No longer receiving names'],
    'Unknown': [],
  };
  const statusOptions = useMemo(() => Object.keys(STATUS_GROUPS), []);
  const statusGroupMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [group, statuses] of Object.entries(STATUS_GROUPS)) {
      for (const s of statuses) map[s] = group;
    }
    return map;
  }, []);

  // Status counts for quick-filter chips (use grouped statuses)
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of allPositions) {
      const s = p.vh_status || p.status || '';
      const group = statusGroupMap[s] || 'Unknown';
      counts[group] = (counts[group] || 0) + 1;
    }
    return counts;
  }, [allPositions, statusGroupMap]);

  const newCount = useMemo(() => allPositions.filter(p => p.is_new).length, [allPositions]);

  const filtered = useMemo(() => {
    let results = query ? searchPositions(searchIndex, query) : allPositions;

    if (selectedStates.length > 0)
      results = results.filter(p => selectedStates.includes(p.state));
    if (selectedDioceses.length > 0)
      results = results.filter(p => selectedDioceses.includes(p.diocese));
    if (selectedTypes.length > 0)
      results = results.filter(p => {
        const group = positionTypeGroupMap[p.position_type] || 'Other';
        return selectedTypes.includes(group);
      });
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
      results = results.filter(p => {
        const group = statusGroupMap[p.vh_status || p.status || ''] || 'Unknown';
        return selectedStatuses.includes(group);
      });
    if (hideClosed)
      results = results.filter(p => {
        const group = statusGroupMap[p.vh_status || ''] || 'Unknown';
        return group !== 'Closed';
      });

    return results;
  }, [allPositions, searchIndex, query, selectedStates, selectedDioceses, selectedTypes,
      selectedCompensation, selectedRegion, selectedSetting, selectedHousing, selectedHealthcare,
      selectedStatuses, hideClosed, positionTypeGroupMap, statusGroupMap]);

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
    { key: 'type', label: 'Position Type', options: positionTypeOptions, selected: selectedTypes, onChange: setSelectedTypes, width: 'w-52' },
    { key: 'comp', label: 'Compensation', options: COMPENSATION_RANGES, selected: selectedCompensation, onChange: setSelectedCompensation, width: 'w-52' },
    { key: 'region', label: 'Region', options: regions, selected: selectedRegion, onChange: setSelectedRegion, width: 'w-40' },
    { key: 'setting', label: 'Setting', options: settings, selected: selectedSetting, onChange: setSelectedSetting, width: 'w-40' },
    { key: 'housing', label: 'Housing', options: housingTypes, selected: selectedHousing, onChange: setSelectedHousing, width: 'w-48' },
    { key: 'healthcare', label: 'Healthcare', options: healthcareOptions, selected: selectedHealthcare, onChange: setSelectedHealthcare, width: 'w-40' },
    { key: 'status', label: 'Status', options: statusOptions, selected: selectedStatuses, onChange: setSelectedStatuses, width: 'w-44' },
  ];

  const hasActiveFilters = filterConfigs.some(f => f.selected.length > 0);

  // Quick filter chip handler (uses group names now)
  function toggleStatusChip(group: string) {
    if (selectedStatuses.includes(group)) {
      setSelectedStatuses(selectedStatuses.filter(s => s !== group));
    } else {
      setSelectedStatuses([group]);
      if (group === 'Closed') {
        setHideClosed(false);
      }
    }
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
          label={`Receiving (${statusCounts['Receiving'] || 0})`}
          active={selectedStatuses.includes('Receiving')}
          onClick={() => { setShowNewOnly(false); toggleStatusChip('Receiving'); }}
          color="bg-green-50 text-green-700 border-green-200"
          activeColor="bg-green-600 text-white border-green-600"
        />
        <QuickChip
          label={`Developing (${statusCounts['Developing'] || 0})`}
          active={selectedStatuses.includes('Developing')}
          onClick={() => { setShowNewOnly(false); toggleStatusChip('Developing'); }}
          color="bg-blue-50 text-blue-700 border-blue-200"
          activeColor="bg-blue-600 text-white border-blue-600"
        />
        <QuickChip
          label={`Interim (${statusCounts['Interim'] || 0})`}
          active={selectedStatuses.includes('Interim')}
          onClick={() => { setShowNewOnly(false); toggleStatusChip('Interim'); }}
          color="bg-yellow-50 text-yellow-700 border-yellow-200"
          activeColor="bg-yellow-600 text-white border-yellow-600"
        />
        <QuickChip
          label={`Closed (${statusCounts['Closed'] || 0})`}
          active={selectedStatuses.includes('Closed') && !hideClosed}
          onClick={() => {
            setShowNewOnly(false);
            if (selectedStatuses.includes('Closed') && !hideClosed) {
              setSelectedStatuses(selectedStatuses.filter(s => s !== 'Closed'));
              setHideClosed(true);
            } else {
              toggleStatusChip('Closed');
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
