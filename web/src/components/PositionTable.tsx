'use client';

import { Fragment, useState, useCallback, useEffect, useMemo } from 'react';
import { Position, SortField, SortDirection } from '@/lib/types';
import UnifiedStatusBadge from './UnifiedStatusBadge';
import ScorePill from './ScorePill';
import StatusPopover from './StatusPopover';
import ComparisonBar from './ComparisonBar';
import ComparisonModal from './ComparisonModal';
import DetailPanel from './detail-panel/DetailPanel';
import type { PersonalData } from '@/lib/types';
import { ME_TOKEN_KEY } from '@/lib/constants';
import MatchBadge from './MatchBadge';
import type { SearchPreferences } from '@/lib/types';
import { scorePosition, type MatchResult } from '@/lib/match-helpers';
import { hasActivePreferences } from '@/hooks/usePreferences';
import { parseAnyDate } from '@/lib/date-utils';
import { getChurchName, getCity, getState } from '@/lib/position-helpers';

interface PositionTableProps {
  positions: Position[];
  onNavigate?: (id: string) => void;
  meData?: PersonalData | null;
  initialSortField?: SortField;
  initialSortDir?: SortDirection;
  initialExpandedId?: string | null;
  onExpandedChange?: (id: string | null) => void;
  preferences?: SearchPreferences;
}

const COLUMNS: Array<{ key: SortField; label: string }> = [
  { key: 'name', label: 'Church' },
  { key: 'diocese', label: 'Location' },
  { key: 'date', label: 'Date Posted' },
  { key: 'quality_score', label: 'Status' },
];

/** Get latest ASA value and year range for hover context */
function getLatestAsa(pos: Position): { value: number; range: string } | null {
  const parochial = pos.parochials?.[0];
  if (!parochial) return null;
  const sorted = Object.keys(parochial.years).sort();
  let earliest: number | null = null;
  let latest: number | null = null;

  for (const y of sorted) {
    const v = parochial.years[y].averageAttendance;
    if (v != null && v > 0) {
      if (earliest === null) earliest = v;
      latest = v;
    }
  }

  if (latest === null) return null;
  const range = earliest !== null && earliest !== latest
    ? `${sorted[0]}: ${earliest}, ${sorted[sorted.length - 1]}: ${latest}`
    : `${sorted[sorted.length - 1]}`;
  return { value: latest, range };
}

export default function PositionTable({
  positions,
  onNavigate: _onNavigate,
  meData: meDataProp,
  initialSortField,
  initialSortDir,
  initialExpandedId,
  onExpandedChange,
  preferences,
}: PositionTableProps) {
  const [sortField, setSortField] = useState<SortField>(initialSortField ?? 'date');
  const [sortDir, setSortDir] = useState<SortDirection>(initialSortDir ?? 'desc');
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId ?? null);
  const [comparedIds, setComparedIds] = useState<Set<string>>(new Set());
  const [showComparison, setShowComparison] = useState(false);
  const [meDataLocal, setMeDataLocal] = useState<PersonalData | null>(null);
  const meData = meDataProp ?? meDataLocal;

  useEffect(() => {
    if (meDataProp) return; // parent already provided meData, skip local fetch
    const params = new URLSearchParams(window.location.search);
    const token = params.get('me') || localStorage.getItem(ME_TOKEN_KEY);
    if (!token) return;

    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    fetch(`${base}/data/clergy/${token}.json`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setMeDataLocal(data);
      })
      .catch(() => {});
  }, [meDataProp]);

  const showMatch = preferences ? hasActivePreferences(preferences) : false;

  const matchScores = useMemo(() => {
    if (!showMatch || !preferences) return new Map<string, MatchResult>();
    const map = new Map<string, MatchResult>();
    for (const pos of positions) {
      map.set(pos.id, scorePosition(pos, preferences));
    }
    return map;
  }, [positions, preferences, showMatch]);

  const MAX_COMPARE = 3;

  const toggleCompare = useCallback((id: string) => {
    setComparedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_COMPARE) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearCompare = useCallback(() => setComparedIds(new Set()), []);

  const comparedPositions = positions.filter(p => comparedIds.has(p.id));

  const sorted = [...positions].sort((a, b) => {
    if (sortField === 'quality_score') {
      const aNum = a.quality_score ?? 0;
      const bNum = b.quality_score ?? 0;
      return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
    }
    // Date-based sorting
    if (sortField === 'date' || sortField === 'updated' || sortField === 'firstseen') {
      const dateField = sortField === 'date' ? 'receiving_names_from'
        : sortField === 'updated' ? 'updated_on_hub'
        : 'first_seen';
      const aTime = parseAnyDate(a[dateField as keyof Position] as string)?.getTime() || 0;
      const bTime = parseAnyDate(b[dateField as keyof Position] as string)?.getTime() || 0;
      return sortDir === 'asc' ? aTime - bTime : bTime - aTime;
    }
    let aVal: string, bVal: string;
    if (sortField === 'name') {
      aVal = getChurchName(a).text;
      bVal = getChurchName(b).text;
    } else if (sortField === 'diocese') {
      aVal = a.diocese || '';
      bVal = b.diocese || '';
    } else {
      aVal = String(a[sortField] || '');
      bVal = String(b[sortField] || '');
    }
    const cmp = aVal.localeCompare(bVal);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Apply match boost as a secondary sort (only breaks ties)
  if (showMatch) {
    sorted.sort((a, b) => {
      const scoreA = matchScores.get(a.id)?.score ?? 0;
      const scoreB = matchScores.get(b.id)?.score ?? 0;
      const tierA = scoreA >= 50 ? 1 : 0;
      const tierB = scoreB >= 50 ? 1 : 0;
      if (tierA !== tierB) return tierB - tierA;
      return scoreB - scoreA;
    });
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function toggleExpand(id: string) {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    onExpandedChange?.(next);
  }

  function expandAndScrollTo(posId: string) {
    setExpandedId(posId);
    setTimeout(() => {
      document.getElementById(`position-row-${posId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  if (positions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No positions found</p>
        <p className="text-sm mt-1">Try adjusting your search or filters</p>
      </div>
    );
  }

  const hasCompared = comparedIds.size > 0;

  return (
    <>
      {/* Mobile: card layout */}
      <div className={`sm:hidden space-y-2 ${hasCompared ? 'pb-20' : ''}`}>
        {/* Mobile sort control */}
        <div className="flex items-center gap-2 text-sm text-gray-500 px-1">
          <span>Sort by</span>
          <select
            value={sortField}
            onChange={(e) => { setSortField(e.target.value as SortField); setSortDir('asc'); }}
            aria-label="Sort by"
            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
          >
            <option value="name">Church Name</option>
            <option value="diocese">Diocese</option>
            <option value="date">Date Posted</option>
            <option value="updated">Last Updated</option>
            <option value="firstseen">First Seen</option>
            <option value="quality_score">Quality Score</option>
          </select>
          <button
            onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
            className="text-primary-600 font-medium"
          >
            {sortDir === 'asc' ? '\u2191' : '\u2193'}
          </button>
        </div>

        {sorted.map((pos) => {
          const church = getChurchName(pos);
          const city = getCity(pos);
          const state = getState(pos);
          const locationParts = [city && state ? `${city}, ${state}` : city || state, pos.diocese].filter(Boolean);
          const asa = getLatestAsa(pos);
          return (
            <div key={pos.id} id={`position-row-${pos.id}`}>
              <div
                onClick={() => toggleExpand(pos.id)}
                className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                  expandedId === pos.id
                    ? 'bg-primary-50 border-l-4 border-l-primary-500 border-primary-200'
                    : pos.visibility === 'extended_hidden'
                      ? 'bg-gray-50/60 border-gray-200 text-gray-400 hover:bg-gray-100'
                      : 'bg-white border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium text-sm leading-tight ${church.isEnriched ? 'text-gray-900' : 'text-gray-500 italic'}`}>
                      {church.text}
                      {church.suffix && <span className="ml-1.5 text-xs font-normal text-primary-600">{church.suffix}</span>}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {locationParts.join(' \u00B7 ') || '\u00A0'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {asa && <span className="text-xs text-gray-500" title={asa.range}>ASA {asa.value}</span>}
                    <StatusPopover pos={pos}>
                      <UnifiedStatusBadge vhStatus={pos.vh_status || pos.status} visibility={pos.visibility} />
                      {(pos.visibility === 'extended' || pos.visibility === 'extended_hidden') && (
                        <ScorePill score={pos.quality_score ?? 0} />
                      )}
                    </StatusPopover>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                  {pos.position_type && <span>{pos.position_type}</span>}
                  {pos.receiving_names_from && (
                    <span>&middot; {pos.receiving_names_from.split(' to ')[0].split(' - ')[0]}</span>
                  )}
                  {showMatch && matchScores.get(pos.id)?.tier !== 'none' && (
                    <MatchBadge
                      tier={matchScores.get(pos.id)!.tier}
                      reasons={[]}
                      detailed={false}
                    />
                  )}
                </div>
                <div className="mt-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleCompare(pos.id); }}
                    disabled={!comparedIds.has(pos.id) && comparedIds.size >= MAX_COMPARE}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      comparedIds.has(pos.id)
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : comparedIds.size >= MAX_COMPARE
                          ? 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed'
                          : 'bg-white border-gray-300 text-gray-600 hover:border-primary-300'
                    }`}
                    title={!comparedIds.has(pos.id) && comparedIds.size >= MAX_COMPARE ? `Max ${MAX_COMPARE} positions` : undefined}
                  >
                    {comparedIds.has(pos.id) ? '\u2713 Compare' : '+ Compare'}
                  </button>
                </div>
              </div>
              {expandedId === pos.id && (
                <div className="border border-t-0 border-primary-200 rounded-b-lg p-4 bg-white border-l-4 border-l-primary-600">
                  <DetailPanel pos={pos} onNavigate={expandAndScrollTo} meData={meData} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop: table layout */}
      <div className={`hidden sm:block overflow-x-auto border border-gray-200 rounded-lg ${hasCompared ? 'pb-20' : ''}`}>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-3 w-10">
                <span className="sr-only">Compare</span>
              </th>
              {showMatch && <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500">MATCH</th>}
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-3 py-3 text-left text-xs font-medium text-gray-500
                             uppercase tracking-wider cursor-pointer hover:bg-gray-100
                             select-none"
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    {sortField === col.key && (
                      <span className="text-primary-600">
                        {sortDir === 'asc' ? '\u2191' : '\u2193'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
              <th className="px-2 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider w-12">
                ASA
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sorted.map((pos) => {
              const church = getChurchName(pos);
              const city = getCity(pos);
              const state = getState(pos);
              const locationPrimary = city && state ? `${city}, ${state}` : city || state || '';
              const asa = getLatestAsa(pos);
              return (
                <Fragment key={pos.id}>
                  <tr
                    id={`position-row-${pos.id}`}
                    onClick={() => toggleExpand(pos.id)}
                    className={`cursor-pointer transition-colors ${
                      expandedId === pos.id
                        ? 'bg-primary-50 border-l-4 border-l-primary-500'
                        : pos.visibility === 'extended_hidden'
                          ? 'bg-gray-50/60 text-gray-400 hover:bg-gray-100'
                          : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-2 py-2 w-10" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={comparedIds.has(pos.id)}
                        disabled={!comparedIds.has(pos.id) && comparedIds.size >= MAX_COMPARE}
                        onChange={() => toggleCompare(pos.id)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label={`Compare ${church.text}`}
                        title={!comparedIds.has(pos.id) && comparedIds.size >= MAX_COMPARE ? `Max ${MAX_COMPARE} positions` : 'Select to compare'}
                      />
                    </td>
                    {showMatch && (
                      <td className="px-3 py-2">
                        {matchScores.get(pos.id) && matchScores.get(pos.id)!.tier !== 'none' && (
                          <MatchBadge
                            tier={matchScores.get(pos.id)!.tier}
                            reasons={matchScores.get(pos.id)!.reasons}
                            detailed={preferences?.showDetailedMatch ?? true}
                          />
                        )}
                      </td>
                    )}
                    {/* Church */}
                    <td className="px-3 py-2 text-sm max-w-xs">
                      <div className={`font-medium truncate ${church.isEnriched ? 'text-gray-900' : 'text-gray-500 italic'}`}>
                        {church.text}
                        {church.suffix && <span className="ml-1.5 text-xs font-normal text-primary-600">{church.suffix}</span>}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{pos.position_type || '\u00A0'}</div>
                    </td>
                    {/* Location */}
                    <td className="px-3 py-2 text-sm text-gray-600">
                      <div className="truncate">{locationPrimary || '\u00A0'}</div>
                      <div className="text-xs text-gray-500 truncate">{pos.diocese || '\u00A0'}</div>
                    </td>
                    {/* Date (adaptive based on sortField) */}
                    <td className="px-3 py-2 text-sm text-gray-600">
                      {(() => {
                        const primaryField = sortField === 'updated' ? pos.updated_on_hub
                          : sortField === 'firstseen' ? pos.first_seen
                          : pos.receiving_names_from;
                        const secondaryField = sortField === 'updated' ? pos.receiving_names_from
                          : sortField === 'firstseen' ? pos.receiving_names_from
                          : pos.updated_on_hub;
                        return (
                          <>
                            <div>{primaryField || <span className="text-gray-400">--</span>}</div>
                            {secondaryField && sortField !== 'date' && (
                              <div className="text-xs text-gray-400">Posted {secondaryField}</div>
                            )}
                            {secondaryField && sortField === 'date' && (
                              <div className="text-xs text-gray-400">Updated {secondaryField}</div>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    {/* Status */}
                    <td className="px-3 py-2">
                      <StatusPopover pos={pos}>
                        <UnifiedStatusBadge vhStatus={pos.vh_status || pos.status} visibility={pos.visibility} />
                        {(pos.visibility === 'extended' || pos.visibility === 'extended_hidden') && (
                          <ScorePill score={pos.quality_score ?? 0} />
                        )}
                      </StatusPopover>
                    </td>
                    {/* ASA */}
                    <td className="px-2 py-2 text-center w-12">
                      {asa && (
                        <span className="text-xs text-gray-500 cursor-help" title={asa.range}>
                          {asa.value}
                        </span>
                      )}
                    </td>
                  </tr>
                  {expandedId === pos.id && (
                    <tr key={`${pos.id}-detail`}>
                      <td colSpan={showMatch ? 7 : 6} className="px-4 py-4 bg-white border-l-4 border-l-primary-600">
                        <DetailPanel pos={pos} onNavigate={expandAndScrollTo} meData={meData} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <ComparisonBar
        selected={comparedPositions}
        onRemove={(id) => toggleCompare(id)}
        onClear={clearCompare}
        onCompare={() => setShowComparison(true)}
      />

      {showComparison && comparedPositions.length >= 2 && (
        <ComparisonModal
          positions={comparedPositions}
          onClose={() => setShowComparison(false)}
        />
      )}
    </>
  );
}
