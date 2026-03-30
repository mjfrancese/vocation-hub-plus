'use client';

import { Fragment, useState, useCallback } from 'react';
import { Position, SortField, SortDirection } from '@/lib/types';
import StatusBadge from './StatusBadge';
import ParochialTrends from './ParochialTrends';
import { isGibberish } from '@/lib/gibberish-detector';
import ComparisonBar from './ComparisonBar';
import ComparisonModal from './ComparisonModal';

interface PositionTableProps {
  positions: Position[];
}

const COLUMNS: Array<{ key: SortField; label: string }> = [
  { key: 'name', label: 'Church' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'diocese', label: 'Diocese' },
  { key: 'position_type', label: 'Position' },
  { key: 'estimated_total_comp' as SortField, label: 'Est. Comp' },
  { key: 'receiving_names_from', label: 'Receiving Names' },
  { key: 'updated_on_hub', label: 'Updated' },
];

/** Get the display name for a position: prefer church_info.name, fall back to pos.name */
function getChurchName(pos: Position): { text: string; isEnriched: boolean } {
  if (pos.church_info?.name) return { text: pos.church_info.name, isEnriched: true };
  return { text: pos.name, isEnriched: false };
}

/** Get the city for a position: prefer church_info.city, fall back to pos.city */
function getCity(pos: Position): string {
  return pos.church_info?.city || pos.city || '';
}

/** Get the state for a position: prefer church_info.state, fall back to pos.state */
function getState(pos: Position): string {
  return pos.church_info?.state || pos.state || '';
}

/** Parse a date string in various formats (ISO, MM/DD/YYYY, "Month DD, YYYY") */
function parseAnyDate(s: string): Date | null {
  if (!s) return null;
  // Handle range like "02/18/2026 to 03/31/2026" or "03/12/2026 -" -- use first date
  const first = s.split(/\s+(?:to|-)\s*/)[0].trim();
  // MM/DD/YYYY
  const mdy = first.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
  // ISO or other parseable format
  const d = new Date(first);
  return isNaN(d.getTime()) ? null : d;
}

/** Compute human-readable time since listing was posted.
 *  Uses first_seen (if older than 1 day), falls back to receiving_names_from start date. */
function timeOnMarket(pos: Position): string {
  const now = new Date();
  const firstSeen = parseAnyDate(pos.first_seen);
  // Skip first_seen if it's less than 1 day old (likely a DB reset artifact)
  const usableFirstSeen = firstSeen && (now.getTime() - firstSeen.getTime()) > 86400000 ? firstSeen : null;
  const seen = usableFirstSeen || parseAnyDate(pos.receiving_names_from);
  if (!seen) return '';
  const diffMs = now.getTime() - seen.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return ''; // future date
  if (days < 1) return 'today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month';
  if (months < 12) return `${months} months`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1 year' : `${years} years`;
}

/** Compute ASA trend direction from parochial data (most recent 5 years) */
function getAsaTrend(pos: Position): 'up' | 'down' | 'flat' | null {
  if (!pos.parochial) return null;
  const years = Object.keys(pos.parochial.years).sort();
  const recent = years.slice(-5);
  const values = recent
    .map(y => pos.parochial!.years[y].averageAttendance)
    .filter((v): v is number => v !== null && v > 0);
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  const pctChange = (last - first) / first;
  if (pctChange > 0.1) return 'up';
  if (pctChange < -0.1) return 'down';
  return 'flat';
}

function TrendArrow({ trend }: { trend: 'up' | 'down' | 'flat' | null }) {
  if (!trend) return null;
  if (trend === 'up') return <span className="text-green-600 text-xs font-medium" title="ASA trending up">{'\u25B2'}</span>;
  if (trend === 'down') return <span className="text-red-500 text-xs font-medium" title="ASA trending down">{'\u25BC'}</span>;
  return <span className="text-gray-400 text-xs" title="ASA flat">{'\u2014'}</span>;
}

export default function PositionTable({ positions }: PositionTableProps) {
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [comparedIds, setComparedIds] = useState<Set<string>>(new Set());
  const [showComparison, setShowComparison] = useState(false);

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
    let aVal: string, bVal: string;
    if (sortField === 'name') {
      aVal = getChurchName(a).text;
      bVal = getChurchName(b).text;
    } else if (sortField === 'city') {
      aVal = getCity(a);
      bVal = getCity(b);
    } else if (sortField === 'state') {
      aVal = getState(a);
      bVal = getState(b);
    } else {
      aVal = String(a[sortField] || '');
      bVal = String(b[sortField] || '');
    }
    if (sortField === 'estimated_total_comp') {
      const aNum = a.estimated_total_comp || 0;
      const bNum = b.estimated_total_comp || 0;
      return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
    }
    // Date fields: parse various formats to compare chronologically
    if (sortField === 'receiving_names_from' || sortField === 'updated_on_hub') {
      const parseDate = (s: string) => {
        if (!s) return 0;
        // Handle range like "02/18/2026 to 03/31/2026" - use first date
        const first = s.split(' to ')[0].trim();

        // MM/DD/YYYY format
        const mdy = first.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2])).getTime();

        // "Today, HH:MM AM/PM" format
        if (first.startsWith('Today')) {
          const now = new Date();
          const timeMatch = first.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
          if (timeMatch) {
            let h = parseInt(timeMatch[1]);
            const m = parseInt(timeMatch[2]);
            if (timeMatch[3].toUpperCase() === 'PM' && h !== 12) h += 12;
            if (timeMatch[3].toUpperCase() === 'AM' && h === 12) h = 0;
            return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
          }
          return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        }

        // "Yesterday, HH:MM AM/PM" format
        if (first.startsWith('Yesterday')) {
          const now = new Date();
          return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
        }

        // "Month DD" format (no year - assume current year)
        const monthDay = first.match(/^([A-Z][a-z]+)\s+(\d{1,2})$/);
        if (monthDay) {
          const months: Record<string, number> = {
            January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
            July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
          };
          const mo = months[monthDay[1]];
          if (mo !== undefined) {
            return new Date(new Date().getFullYear(), mo, parseInt(monthDay[2])).getTime();
          }
        }

        // "Month DD, YYYY" format
        const monthDayYear = first.match(/^([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
        if (monthDayYear) {
          const months: Record<string, number> = {
            January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
            July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
          };
          const mo = months[monthDayYear[1]];
          if (mo !== undefined) {
            return new Date(parseInt(monthDayYear[3]), mo, parseInt(monthDayYear[2])).getTime();
          }
        }

        // Try native Date parsing as last resort
        const d = new Date(first);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };
      const aTime = parseDate(aVal);
      const bTime = parseDate(bVal);
      const cmp = aTime - bTime;
      return sortDir === 'asc' ? cmp : -cmp;
    }
    const cmp = aVal.localeCompare(bVal);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function toggleExpand(id: string) {
    setExpandedId(expandedId === id ? null : id);
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
            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
          >
            {COLUMNS.map(col => (
              <option key={col.key} value={col.key}>{col.label}</option>
            ))}
          </select>
          <button
            onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
            className="text-primary-600 font-medium"
          >
            {sortDir === 'asc' ? '\u2191' : '\u2193'}
          </button>
        </div>

        {sorted.map((pos) => (
          <div key={pos.id} id={`position-row-${pos.id}`}>
            <div
              onClick={() => toggleExpand(pos.id)}
              className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                expandedId === pos.id
                  ? 'bg-primary-50 border-l-4 border-l-primary-500 border-primary-200'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {(() => {
                    const church = getChurchName(pos);
                    return (
                      <p className={`font-medium text-sm leading-tight flex items-center gap-1.5 ${church.isEnriched ? 'text-gray-900' : 'text-gray-500 italic'}`}>
                        {church.text}
                        <TrendArrow trend={getAsaTrend(pos)} />
                      </p>
                    );
                  })()}
                  <p className="text-xs text-gray-500 mt-1">
                    {getCity(pos) && <>{getCity(pos)} &middot; </>}{getState(pos)} &middot; {pos.diocese}
                  </p>
                </div>
                {pos.vh_status ? (
                  <StatusBadge status={pos.vh_status} />
                ) : (
                  <StatusBadge status={pos.status === 'new' ? 'Receiving names' : pos.status} />
                )}
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                {pos.position_type && <span>{pos.position_type}</span>}
                {pos.receiving_names_from && (
                  <span>&middot; {pos.receiving_names_from}</span>
                )}
                {pos.estimated_total_comp && (
                  <span className="text-green-700 font-medium">&middot; ${pos.estimated_total_comp.toLocaleString()}</span>
                )}
                {timeOnMarket(pos) && (
                  <span className="text-gray-400">&middot; {timeOnMarket(pos)}</span>
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
              <div className="border border-t-0 border-primary-200 rounded-b-lg p-3 bg-primary-50/40 border-l-4 border-l-primary-500">
                <ExpandedDetail pos={pos} onNavigate={expandAndScrollTo} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop: table layout */}
      <div className={`hidden sm:block overflow-x-auto border border-gray-200 rounded-lg ${hasCompared ? 'pb-20' : ''}`}>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 w-10">
                <span className="sr-only">Compare</span>
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500
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
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sorted.map((pos) => (
              <Fragment key={pos.id}>
                <tr
                  id={`position-row-${pos.id}`}
                  onClick={() => toggleExpand(pos.id)}
                  className={`cursor-pointer transition-colors ${
                    expandedId === pos.id
                      ? 'bg-primary-50 border-l-4 border-l-primary-500'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="px-3 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={comparedIds.has(pos.id)}
                      disabled={!comparedIds.has(pos.id) && comparedIds.size >= MAX_COMPARE}
                      onChange={() => toggleCompare(pos.id)}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-40 disabled:cursor-not-allowed"
                      title={!comparedIds.has(pos.id) && comparedIds.size >= MAX_COMPARE ? `Max ${MAX_COMPARE} positions` : 'Select to compare'}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm font-medium max-w-xs truncate">
                    <span className="flex items-center gap-1.5">
                      {(() => {
                        const church = getChurchName(pos);
                        return (
                          <span className={church.isEnriched ? 'text-gray-900' : 'text-gray-500 italic'}>
                            {church.text}
                          </span>
                        );
                      })()}
                      <TrendArrow trend={getAsaTrend(pos)} />
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{getCity(pos)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{getState(pos)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{pos.diocese}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{pos.position_type}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {pos.estimated_total_comp ? (
                      <span title={
                        pos.comp_breakdown
                          ? `Stipend: $${pos.comp_breakdown.stipend.toLocaleString()}${pos.comp_breakdown.housing ? ` + Housing: ~$${pos.comp_breakdown.housing.toLocaleString()}` : ''}`
                          : undefined
                      }>
                        ${pos.estimated_total_comp.toLocaleString()} est.
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {pos.receiving_names_from ? (
                      <>
                        {pos.receiving_names_from}
                        {pos.receiving_names_to && pos.receiving_names_to !== 'Open ended'
                          && !pos.receiving_names_from.includes(' - ')
                          && ` to ${pos.receiving_names_to}`}
                      </>
                    ) : pos.vh_status ? (
                      <span className="text-gray-400 italic">{pos.vh_status}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <div>{pos.updated_on_hub}</div>
                    {timeOnMarket(pos) && (
                      <div className="text-xs text-gray-400">{timeOnMarket(pos)} listed</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {pos.vh_status ? (
                      <StatusBadge status={pos.vh_status} />
                    ) : (
                      <StatusBadge status={pos.status === 'new' ? 'Receiving names' : pos.status} />
                    )}
                  </td>
                </tr>
                {expandedId === pos.id && (
                  <tr key={`${pos.id}-detail`}>
                    <td colSpan={10} className="px-4 py-4 bg-primary-50/40 border-l-4 border-l-primary-500">
                      <ExpandedDetail pos={pos} onNavigate={expandAndScrollTo} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
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

function computeMetricTrend(
  years: Record<string, { averageAttendance: number | null; plateAndPledge: number | null; membership: number | null }>,
  metric: 'averageAttendance' | 'plateAndPledge' | 'membership',
): { direction: 'up' | 'down' | 'flat'; pct: number } | null {
  const sorted = Object.keys(years).sort();
  const recent = sorted.slice(-5);
  const values = recent
    .map(y => years[y][metric])
    .filter((v): v is number => v !== null && v > 0);
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  const pct = Math.round(((last - first) / first) * 100);
  const direction = pct > 10 ? 'up' : pct < -10 ? 'down' : 'flat';
  return { direction, pct };
}

function trendLabel(pct: number): string {
  const abs = Math.abs(pct);
  if (abs <= 10) return 'flat';
  return `${pct > 0 ? 'up' : 'down'} ${abs}%`;
}

function trendWord(direction: 'up' | 'down' | 'flat'): string {
  if (direction === 'up') return 'growing';
  if (direction === 'down') return 'declining';
  return 'stable';
}

function ParishSnapshot({ pos }: { pos: Position }) {
  if (!pos.parochial || Object.keys(pos.parochial.years).length === 0) return null;

  const asa = computeMetricTrend(pos.parochial.years, 'averageAttendance');
  const giving = computeMetricTrend(pos.parochial.years, 'plateAndPledge');
  const membership = computeMetricTrend(pos.parochial.years, 'membership');

  if (!asa && !giving && !membership) return null;

  // Determine overall assessment
  const directions = [asa?.direction, giving?.direction, membership?.direction].filter(Boolean);
  const upCount = directions.filter(d => d === 'up').length;
  const downCount = directions.filter(d => d === 'down').length;

  let overallLabel: string;
  let overallColor: string;
  if (upCount > downCount) {
    overallLabel = 'Growing parish';
    overallColor = 'text-green-700 bg-green-50 border-green-200';
  } else if (downCount > upCount) {
    overallLabel = 'Declining';
    overallColor = 'text-red-700 bg-red-50 border-red-200';
  } else {
    overallLabel = 'Stable parish';
    overallColor = 'text-amber-700 bg-amber-50 border-amber-200';
  }

  const parts: string[] = [];
  if (asa) parts.push(`ASA ${trendLabel(asa.pct)}`);
  if (giving) parts.push(`giving ${trendLabel(giving.pct)}`);
  if (membership) parts.push(`membership ${trendWord(membership.direction)}`);

  return (
    <div className={`rounded-lg border p-3 text-sm ${overallColor}`}>
      <span className="font-semibold">{overallLabel}</span>
      {parts.length > 0 && (
        <span className="ml-1"> &mdash; {parts.join(', ')}</span>
      )}
    </div>
  );
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  const mod10 = n % 10;
  if (mod10 === 1) return 'st';
  if (mod10 === 2) return 'nd';
  if (mod10 === 3) return 'rd';
  return 'th';
}

function formatDollarCompact(value: number): string {
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${value.toLocaleString()}`;
}

function DioceseContext({ pos }: { pos: Position }) {
  if (!pos.diocese_percentiles || !pos.diocese) return null;

  const dp = pos.diocese_percentiles;
  const items: string[] = [];

  if (dp.asa != null && dp.asa_value != null) {
    items.push(`ASA of ${dp.asa_value} \u2014 larger than ${dp.asa}% of parishes in the Diocese of ${pos.diocese}`);
  }
  if (dp.plate_pledge != null && dp.plate_pledge_value != null) {
    items.push(`Annual giving of ${formatDollarCompact(dp.plate_pledge_value)} \u2014 ${dp.plate_pledge}${ordinalSuffix(dp.plate_pledge)} percentile in diocese`);
  }
  if (dp.membership != null && dp.membership_value != null) {
    items.push(`Membership of ${dp.membership_value} \u2014 ${dp.membership}${ordinalSuffix(dp.membership)} percentile in diocese`);
  }

  if (items.length === 0) return null;

  return (
    <div className="border border-blue-200 rounded-lg p-3 bg-blue-50 text-sm text-blue-800">
      <div className="font-medium text-blue-700 mb-1">Diocese Context</div>
      {items.map((item, i) => (
        <div key={i}>{item}</div>
      ))}
    </div>
  );
}

function CommunityContext({ pos }: { pos: Position }) {
  if (!pos.census) return null;
  const { median_household_income, population } = pos.census;
  if (median_household_income == null && population == null) return null;

  // Compare stipend to area median household income when both are available
  let contextNote = '';
  if (median_household_income && pos.comp_breakdown?.stipend) {
    const ratio = (pos.comp_breakdown.stipend / median_household_income).toFixed(1);
    contextNote = `Stipend is ${ratio}x the area median household income`;
  }

  return (
    <div className="border border-teal-200 rounded-lg p-3 bg-teal-50 text-sm text-teal-800">
      <div className="font-medium text-teal-700 mb-1">Community Context</div>
      {median_household_income != null && (
        <div>Median household income: ${median_household_income.toLocaleString()}</div>
      )}
      {population != null && (
        <div>Area population: {population.toLocaleString()}</div>
      )}
      {contextNote && <div className="mt-1 text-teal-600">{contextNote}</div>}
    </div>
  );
}

function SimilarPositions({ pos, onNavigate }: { pos: Position; onNavigate: (id: string) => void }) {
  if (!pos.similar_positions || pos.similar_positions.length === 0) return null;

  return (
    <div className="border border-purple-200 rounded-lg p-3 bg-purple-50 text-sm">
      <div className="font-medium text-purple-700 mb-2">Similar Positions</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {pos.similar_positions.map((sim) => (
          <button
            key={sim.id}
            onClick={(e) => { e.stopPropagation(); onNavigate(sim.id); }}
            className="text-left border border-purple-200 rounded-lg p-2.5 bg-white hover:bg-purple-50 transition-colors"
          >
            <div className="font-medium text-purple-900 text-sm truncate">{sim.name}</div>
            <div className="text-xs text-purple-600 mt-0.5">
              {sim.city && <>{sim.city}, </>}{sim.state}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {sim.position_type && <span>{sim.position_type}</span>}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              {sim.asa != null && <span>ASA {sim.asa}</span>}
              {sim.estimated_total_comp != null && (
                <span className="text-green-700">${sim.estimated_total_comp.toLocaleString()}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ExpandedDetail({ pos, onNavigate }: { pos: Position; onNavigate: (id: string) => void }) {
  const fields = pos.deep_scrape_fields || [];
  const hasDeepData = fields.length > 0;

  // Parochial data is pre-computed at build time (attached to position)
  const hasParochial = !!pos.parochial && Object.keys(pos.parochial.years).length > 0;

  // Helper to find a field value by label keyword (skip gibberish)
  const findField = (...keywords: string[]): string => {
    for (const kw of keywords) {
      const lower = kw.toLowerCase();
      const match = fields.find((f) =>
        f.label.toLowerCase().includes(lower) && !isGibberish(f.value)
      );
      if (match?.value) return match.value;
    }
    return '';
  };

  // Filter out gibberish fields for display
  const cleanFields = fields.filter(f => !isGibberish(f.value));

  // Extract key fields from deep scrape data
  const salary = findField('Range', 'Stipend', 'Compensation', 'Salary');
  const housing = findField('Housing');
  const attendance = findField('Average Sunday', 'Attendance', 'ASA');
  const budget = findField('Annual Budget', 'Budget');
  const setting = findField('Ministry Setting', 'Setting');
  const workEnv = findField('Work Environment');
  const geoLocation = findField('Geographic Location');
  const fullPart = findField('Full Time', 'Part Time', 'Full-Time');
  const pension = findField('Pension');
  const healthcare = findField('Healthcare');
  const vacation = findField('Vacation');
  const leadershipSkills = findField('Leadership skills');
  const ministrySkills = findField('Ministry skills');
  const communityHopes = findField('hopes for this position', 'qualities');
  const congregation = findField('Congregation', 'Community Name');
  const order = findField('Order', 'Ministry');
  const reimbursement = findField('Reimbursement');

  if (!hasDeepData) {
    // Fallback to basic detail fields
    return (
      <div className="space-y-4">
        <ParishSnapshot pos={pos} />
        <DioceseContext pos={pos} />
        <CommunityContext pos={pos} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <DetailField label="Organization Type" value={pos.organization_type} />
          <DetailField label="Full/Part Time" value={pos.full_part_time} />
          <DetailField label="First Seen" value={pos.first_seen} />
          <DetailField label="Last Seen" value={pos.last_seen} />
        </div>
        {hasParochial && <ParochialTrends data={pos.parochial!} />}
        <SimilarPositions pos={pos} onNavigate={onNavigate} />
        {pos.profile_url && (
          <a
            href={pos.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary-600 hover:text-primary-800 underline"
            onClick={(e) => e.stopPropagation()}
          >
            View full profile on Vocation Hub
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Parish health snapshot */}
      <ParishSnapshot pos={pos} />
      <DioceseContext pos={pos} />
      <CommunityContext pos={pos} />

      {/* Key highlights */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <DetailField
          label="Compensation"
          value={
            pos.estimated_total_comp
              ? `$${pos.estimated_total_comp.toLocaleString()} est. total${
                  pos.comp_breakdown?.housing ? ` (Stipend: $${pos.comp_breakdown.stipend.toLocaleString()} + Housing: ~$${pos.comp_breakdown.housing.toLocaleString()})` : ''
                }`
              : salary
          }
          highlight
        />
        <DetailField label="Housing" value={housing} />
        <DetailField label="Avg Sunday Attendance" value={attendance} />
        <DetailField label="Annual Budget" value={budget ? `$${Number(budget).toLocaleString()}` : ''} />
      </div>

      {/* Position details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <DetailField label="Ministry Setting" value={setting} />
        <DetailField label="Work Environment" value={workEnv} />
        <DetailField label="Geographic Location" value={geoLocation} />
        <DetailField label="Orders" value={order} />
      </div>

      {/* Benefits */}
      {(pension || healthcare || vacation || reimbursement) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <DetailField label="Pension" value={pension} />
          <DetailField label="Healthcare" value={healthcare} />
          <DetailField label="Vacation" value={vacation} />
          <DetailField label="Reimbursement" value={reimbursement} />
        </div>
      )}

      {/* Parochial Report Trends */}
      {hasParochial && <ParochialTrends data={pos.parochial!} />}

      {/* Similar Positions */}
      <SimilarPositions pos={pos} onNavigate={onNavigate} />

      {/* Skills */}
      {(leadershipSkills || ministrySkills) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <DetailField label="Leadership Skills" value={leadershipSkills} />
          <DetailField label="Ministry Skills" value={ministrySkills} />
        </div>
      )}

      {/* Narrative / Community hopes */}
      {communityHopes && (
        <div className="text-sm">
          <span className="font-medium text-gray-500">Community Hopes</span>
          <p className="text-gray-900 mt-1 whitespace-pre-line">{communityHopes}</p>
        </div>
      )}

      {/* Church directory info */}
      {pos.church_info && (
        <div className="border border-gray-200 rounded-lg p-3 bg-white text-sm">
          <div className="font-medium text-gray-700 mb-2">Church Directory</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {pos.church_info.street && (
              <div>
                <span className="text-gray-500">Address</span>
                <p className="text-gray-900">{pos.church_info.street}, {pos.church_info.city}, {pos.church_info.state} {pos.church_info.zip}</p>
              </div>
            )}
            {pos.church_info.phone && (
              <div>
                <span className="text-gray-500">Phone</span>
                <p className="text-gray-900">{pos.church_info.phone}</p>
              </div>
            )}
            {pos.church_info.email && (
              <div>
                <span className="text-gray-500">Email</span>
                <p className="text-gray-900">{pos.church_info.email}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Links */}
      <div className="flex gap-4 text-sm">
        {pos.profile_url && (
          <a
            href={pos.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline"
            onClick={(e) => e.stopPropagation()}
          >
            View full profile on Vocation Hub
          </a>
        )}
        {(pos.website_url || pos.church_info?.website) && (
          <a
            href={(() => {
              const url = pos.website_url || pos.church_info?.website || '';
              return url.startsWith('http') ? url : `https://${url}`;
            })()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline"
            onClick={(e) => e.stopPropagation()}
          >
            Church website
          </a>
        )}
      </div>

      {/* All fields (collapsible, gibberish filtered) */}
      <details className="text-sm">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
          View all {cleanFields.length} profile fields
        </summary>
        <div className="mt-2 space-y-2 pl-4 border-l-2 border-gray-200">
          {cleanFields.map((f, i) => (
            <div key={i}>
              <span className="font-medium text-gray-500">{f.label || `Field ${i + 1}`}</span>
              <p className="text-gray-900 whitespace-pre-line">
                {f.value.length > 500 ? f.value.substring(0, 500) + '...' : f.value}
              </p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function DetailField({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <span className="font-medium text-gray-500">{label}</span>
      <p className={highlight ? 'text-gray-900 font-semibold' : 'text-gray-900'}>{value}</p>
    </div>
  );
}
