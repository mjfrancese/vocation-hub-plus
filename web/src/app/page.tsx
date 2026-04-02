'use client';

import { useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
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
import {
  POSITION_TYPE_DISPLAY_GROUPS,
  buildCanonicalToGroupMap,
} from '@/lib/position-type-helpers';
import {
  getUnifiedStatus,
  UNIFIED_STATUSES,
  UNIFIED_STATUS_CHIP_COLORS,
  type UnifiedStatus,
} from '@/lib/status-helpers';
import SearchBar from '@/components/SearchBar';
import Filters, { FilterConfig } from '@/components/Filters';
import PositionTable from '@/components/PositionTable';
import ExportButton from '@/components/ExportButton';
import LastUpdated from '@/components/LastUpdated';
import ChangeLog from '@/components/ChangeLog';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

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
  // Position type filter uses canonical types grouped into display labels
  const positionTypeOptions = useMemo(() => Object.keys(POSITION_TYPE_DISPLAY_GROUPS), []);
  // Map from canonical type to display group label
  const canonicalToGroupMap = useMemo(() => buildCanonicalToGroupMap(), []);
  const regions = useMemo(() => getUniqueProfileValues(allPositions, 'Geographic Location'), [allPositions]);
  const settings = useMemo(() => getUniqueProfileValues(allPositions, 'Ministry Setting'), [allPositions]);
  const housingTypes = useMemo(() => getUniqueHousingValues(allPositions), [allPositions]);
  const healthcareOptions = useMemo(() => getUniqueProfileValues(allPositions, 'Healthcare Options'), [allPositions]);
  // Unified status options for filter dropdown
  const statusOptions = useMemo(() => [...UNIFIED_STATUSES], []);

  // Status counts for quick-filter chips using unified model
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of allPositions) {
      const unified = getUnifiedStatus(p.vh_status || p.status, p.visibility);
      counts[unified] = (counts[unified] || 0) + 1;
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
      results = results.filter(p => {
        const types = p.position_types || [];
        // A position matches if any of its canonical types maps to a selected group
        return types.some(t => {
          const group = canonicalToGroupMap[t] || 'Other';
          return selectedTypes.includes(group);
        });
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
        const unified = getUnifiedStatus(p.vh_status || p.status, p.visibility);
        return selectedStatuses.includes(unified);
      });
    if (hideClosed)
      results = results.filter(p => {
        const unified = getUnifiedStatus(p.vh_status || p.status, p.visibility);
        return unified !== 'Closed';
      });

    return results;
  }, [allPositions, searchIndex, query, selectedStates, selectedDioceses, selectedTypes,
      selectedCompensation, selectedRegion, selectedSetting, selectedHousing, selectedHealthcare,
      selectedStatuses, hideClosed, canonicalToGroupMap]);

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
  const [showHiddenListings, setShowHiddenListings] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'map'>('table');

  const displayedPositions = useMemo(() => {
    let results = filtered;
    if (showNewOnly) results = results.filter(p => p.is_new);
    if (!showHiddenListings) results = results.filter(p => p.visibility !== 'extended_hidden');
    return results;
  }, [filtered, showNewOnly, showHiddenListings]);

  const hiddenCount = useMemo(() => {
    let results = filtered;
    if (showNewOnly) results = results.filter(p => p.is_new);
    return results.filter(p => p.visibility === 'extended_hidden').length;
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
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'map' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Map
            </button>
          </div>
          <ExportButton positions={displayedPositions} />
        </div>
      </div>

      {/* About this data */}
      <details className="text-sm text-gray-600">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-400 text-xs font-medium">i</span>
          About this data
        </summary>
        <div className="mt-2 space-y-2 pl-5 border-l-2 border-gray-200 text-gray-600">
          <p>
            <strong>Active Listings</strong> appear in the Episcopal Vocation Hub&#39;s current search results
            and are confirmed to be accepting applications.
          </p>
          <p>
            <strong>Directory Listings</strong> are positions found in the Vocation Hub&#39;s profile directory
            that are not currently in active search results. They may be in development, recently closed, or
            awaiting updates. We include them when they have enough information to be useful. Each directory
            listing shows a quality score (0-100) based on how complete and current the listing data is.
          </p>
          <p>
            All listings are enriched with data from the Episcopal Asset Map (church directory) and General
            Convention Parochial Reports (attendance, giving, and membership trends) where a match could be
            identified. This enrichment data is provided for context and may not reflect the current state
            of the parish.
          </p>
        </div>
      </details>

      {/* Recent Changes */}
      {changes.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-medium">
            Recent Changes ({changes.length})
          </summary>
          <div className="mt-2">
            <ChangeLog changes={changes} limit={8} onItemClick={(change) => {
              setQuery(change.name);
            }} />
          </div>
        </details>
      )}

      {/* Quick filter chips */}
      <div className="flex flex-wrap gap-2">
        <QuickChip
          label={`New (${newCount})`}
          active={showNewOnly}
          onClick={() => setShowNewOnly(!showNewOnly)}
          color="bg-emerald-50 text-emerald-700 border-emerald-200"
          activeColor="bg-emerald-600 text-white border-emerald-600"
        />
        {UNIFIED_STATUSES.map((status) => {
          const chipColors = UNIFIED_STATUS_CHIP_COLORS[status];
          const isClosedChip = status === 'Closed';
          const isActive = isClosedChip
            ? selectedStatuses.includes(status) && !hideClosed
            : selectedStatuses.includes(status);
          return (
            <QuickChip
              key={status}
              label={`${status} (${statusCounts[status] || 0})`}
              active={isActive}
              onClick={() => {
                setShowNewOnly(false);
                if (isClosedChip) {
                  if (selectedStatuses.includes('Closed') && !hideClosed) {
                    setSelectedStatuses(selectedStatuses.filter(s => s !== 'Closed'));
                    setHideClosed(true);
                  } else {
                    toggleStatusChip('Closed');
                    setHideClosed(false);
                  }
                } else {
                  toggleStatusChip(status);
                }
              }}
              color={chipColors.color}
              activeColor={chipColors.activeColor}
            />
          );
        })}
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

      {viewMode === 'table' ? (
        <>
          <PositionTable positions={displayedPositions} />
          {hiddenCount > 0 && (
            <div className="text-sm text-gray-500 mt-3 text-center">
              {showHiddenListings ? (
                <>
                  Showing all {displayedPositions.length} results, including {hiddenCount} below the quality threshold.{' '}
                  <button
                    onClick={() => setShowHiddenListings(false)}
                    className="text-primary-600 hover:text-primary-800 underline"
                  >
                    Hide low-quality listings
                  </button>
                </>
              ) : (
                <>
                  Showing {displayedPositions.length} results. {hiddenCount} additional listings did not meet the quality threshold.{' '}
                  <button
                    onClick={() => setShowHiddenListings(true)}
                    className="text-primary-600 hover:text-primary-800 underline"
                  >
                    Include all listings
                  </button>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <MapView positions={displayedPositions} />
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
