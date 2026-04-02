'use client';

import { Suspense, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { getPositions, getMeta, getUniqueValues, getChanges } from '@/lib/data';
import { createSearchIndex, searchPositions } from '@/lib/search';
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
} from '@/lib/status-helpers';
import { useFilterState } from '@/hooks/useFilterState';
import { passesDefaultFilter, isPostedWithin } from '@/lib/filter-defaults';
import SearchBar from '@/components/SearchBar';
import Filters, { FilterConfig } from '@/components/Filters';
import PositionTable from '@/components/PositionTable';
import ExportButton from '@/components/ExportButton';
import LastUpdated from '@/components/LastUpdated';
import ChangeLog from '@/components/ChangeLog';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

export default function PositionsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400">Loading...</div>}>
      <PositionsPageContent />
    </Suspense>
  );
}

function PositionsPageContent() {
  const [filters, filterActions] = useFilterState();

  const allPositions = useMemo(() => getPositions(), []);
  const meta = useMemo(() => getMeta(), []);
  const changes = useMemo(() => getChanges(), []);
  const searchIndex = useMemo(() => createSearchIndex(allPositions), [allPositions]);

  // Build filter options from data
  const states = useMemo(() => getUniqueValues(allPositions, 'state'), [allPositions]);
  const dioceses = useMemo(() => getUniqueValues(allPositions, 'diocese'), [allPositions]);
  const positionTypeOptions = useMemo(() => Object.keys(POSITION_TYPE_DISPLAY_GROUPS), []);
  const canonicalToGroupMap = useMemo(() => buildCanonicalToGroupMap(), []);
  const regions = useMemo(() => getUniqueProfileValues(allPositions, 'Geographic Location'), [allPositions]);
  const settings = useMemo(() => getUniqueProfileValues(allPositions, 'Ministry Setting'), [allPositions]);
  const housingTypes = useMemo(() => getUniqueHousingValues(allPositions), [allPositions]);
  const healthcareOptions = useMemo(() => getUniqueProfileValues(allPositions, 'Healthcare Options'), [allPositions]);
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

  // Active status chips: when no URL param, visually highlight defaults
  const activeChips = filters.statuses.length === 0
    ? ['Active', 'Developing', 'Interim']
    : filters.statuses;

  function toggleStatusChip(status: string) {
    const current = filters.statuses.length === 0
      ? ['Active', 'Developing', 'Interim']
      : [...filters.statuses];

    if (current.includes(status)) {
      filterActions.setStatuses(current.filter(s => s !== status));
    } else {
      filterActions.setStatuses([...current, status]);
    }
  }

  const filtered = useMemo(() => {
    let result = allPositions;

    // Status filter: empty = smart defaults, specified = exact match
    if (filters.statuses.length === 0) {
      result = result.filter(passesDefaultFilter);
    } else {
      result = result.filter(p => {
        const unified = getUnifiedStatus(p.vh_status || p.status, p.visibility);
        return filters.statuses.includes(unified);
      });
    }

    // Date range filter
    if (filters.postedWithin) {
      result = result.filter(p => isPostedWithin(p, filters.postedWithin!));
    }

    // Search query
    if (filters.query) {
      const searchResults = searchPositions(searchIndex, filters.query);
      const resultIds = new Set(searchResults.map(p => p.id));
      result = result.filter(p => resultIds.has(p.id));
    }

    // Multi-select filters
    if (filters.states.length > 0) {
      result = result.filter(p => filters.states.includes(p.state));
    }
    if (filters.dioceses.length > 0) {
      result = result.filter(p => filters.dioceses.includes(p.diocese));
    }
    if (filters.types.length > 0) {
      result = result.filter(p => {
        const types = p.position_types || [];
        return types.some(t => {
          const group = canonicalToGroupMap[t] || 'Other';
          return filters.types.includes(group);
        });
      });
    }
    if (filters.compensationRanges.length > 0) {
      result = result.filter(p => filters.compensationRanges.includes(getCompensationRange(p)));
    }
    if (filters.regions.length > 0) {
      result = result.filter(p => {
        const region = getProfileField(p, 'Geographic Location');
        return region ? filters.regions.includes(region) : false;
      });
    }
    if (filters.settings.length > 0) {
      result = result.filter(p => {
        const setting = getProfileField(p, 'Ministry Setting');
        return setting ? filters.settings.includes(setting) : false;
      });
    }
    if (filters.housingTypes.length > 0) {
      result = result.filter(p => {
        const housing = categorizeHousing(getProfileField(p, 'Type of Housing Provided'));
        return housing ? filters.housingTypes.includes(housing) : false;
      });
    }
    if (filters.healthcareOptions.length > 0) {
      result = result.filter(p => {
        const hc = getProfileField(p, 'Healthcare Options');
        return hc ? filters.healthcareOptions.includes(hc) : false;
      });
    }

    return result;
  }, [allPositions, filters, searchIndex, canonicalToGroupMap]);

  const filterConfigs: FilterConfig[] = [
    { key: 'state', label: 'State', options: states, selected: filters.states, onChange: filterActions.setStates, width: 'w-36' },
    { key: 'diocese', label: 'Diocese', options: dioceses, selected: filters.dioceses, onChange: filterActions.setDioceses, width: 'w-48' },
    { key: 'type', label: 'Position Type', options: positionTypeOptions, selected: filters.types, onChange: filterActions.setTypes, width: 'w-52' },
    { key: 'comp', label: 'Compensation', options: COMPENSATION_RANGES, selected: filters.compensationRanges, onChange: filterActions.setCompensationRanges, width: 'w-52' },
    { key: 'region', label: 'Region', options: regions, selected: filters.regions, onChange: filterActions.setRegions, width: 'w-40' },
    { key: 'setting', label: 'Setting', options: settings, selected: filters.settings, onChange: filterActions.setSettings, width: 'w-40' },
    { key: 'housing', label: 'Housing', options: housingTypes, selected: filters.housingTypes, onChange: filterActions.setHousingTypes, width: 'w-48' },
    { key: 'healthcare', label: 'Healthcare', options: healthcareOptions, selected: filters.healthcareOptions, onChange: filterActions.setHealthcareOptions, width: 'w-40' },
    { key: 'status', label: 'Status', options: statusOptions, selected: filters.statuses, onChange: filterActions.setStatuses, width: 'w-44' },
  ];

  const hasActiveFilters = filterConfigs.some(f => f.selected.length > 0);

  const [showNewOnly, setShowNewOnly] = useState(false);
  const [showHiddenListings, setShowHiddenListings] = useState(false);

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
            {hasActiveFilters || filters.query || showNewOnly ? ' (filtered)' : ''}
          </span>
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => filterActions.setView('table')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                filters.view === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => filterActions.setView('map')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                filters.view === 'map' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
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
              filterActions.setQuery(change.name);
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
          const isActive = activeChips.includes(status);
          return (
            <QuickChip
              key={status}
              label={`${status} (${statusCounts[status] || 0})`}
              active={isActive}
              onClick={() => {
                setShowNewOnly(false);
                toggleStatusChip(status);
              }}
              color={chipColors.color}
              activeColor={chipColors.activeColor}
            />
          );
        })}
      </div>

      <SearchBar
        value={filters.query}
        onChange={filterActions.setQuery}
        resultCount={filters.query || hasActiveFilters ? displayedPositions.length : undefined}
      />

      <Filters
        filters={filterConfigs}
        onClear={filterActions.clearAll}
        postedWithin={filters.postedWithin}
        onPostedWithinChange={filterActions.setPostedWithin}
      />

      {filters.view === 'table' ? (
        <>
          <PositionTable
            positions={displayedPositions}
            initialSortField={filters.sort.field}
            initialSortDir={filters.sort.direction}
            initialExpandedId={filters.expandedId}
            onExpandedChange={filterActions.setExpandedId}
          />
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
