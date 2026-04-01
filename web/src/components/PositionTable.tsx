'use client';

import { Fragment, useState, useCallback, useEffect } from 'react';
import { Position, SortField, SortDirection } from '@/lib/types';
import QualityBadge, { QualityScoreDetail } from './QualityBadge';
import ParochialTrends from './ParochialTrends';
import { isGibberish } from '@/lib/gibberish-detector';
import ComparisonBar from './ComparisonBar';
import ComparisonModal from './ComparisonModal';
import ParishContextSection from './ParishContextSection';
import PersonalContext from './PersonalContext';
import type { PersonalData } from '@/lib/types';

interface PositionTableProps {
  positions: Position[];
}

const COLUMNS: Array<{ key: SortField; label: string }> = [
  { key: 'name', label: 'Church' },
  { key: 'diocese', label: 'Location' },
  { key: 'receiving_names_from', label: 'Dates' },
  { key: 'quality_score', label: 'Status' },
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

/** Get latest ASA value and year range for hover context */
function getLatestAsa(pos: Position): { value: number; range: string } | null {
  if (!pos.parochial) return null;
  const sorted = Object.keys(pos.parochial.years).sort();
  let earliest: number | null = null;
  let latest: number | null = null;

  for (const y of sorted) {
    const v = pos.parochial.years[y].averageAttendance;
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

export default function PositionTable({ positions }: PositionTableProps) {
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [comparedIds, setComparedIds] = useState<Set<string>>(new Set());
  const [showComparison, setShowComparison] = useState(false);
  const [meData, setMeData] = useState<PersonalData | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('me') || localStorage.getItem('vh_me_token');
    if (!token) return;

    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    fetch(`${base}/data/clergy-tokens.json`)
      .then(r => r.json())
      .then(tokenMap => {
        if (tokenMap[token]) setMeData(tokenMap[token]);
      })
      .catch(() => {});
  }, []);

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
    if (sortField === 'receiving_names_from') {
      const aTime = parseAnyDate(a.receiving_names_from)?.getTime() || 0;
      const bTime = parseAnyDate(b.receiving_names_from)?.getTime() || 0;
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
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {locationParts.join(' \u00B7 ') || '\u00A0'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {asa && <span className="text-xs text-gray-400" title={asa.range}>ASA {asa.value}</span>}
                    <QualityBadge pos={pos} />
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                  {pos.position_type && <span>{pos.position_type}</span>}
                  {pos.receiving_names_from && (
                    <span>&middot; {pos.receiving_names_from.split(' to ')[0].split(' - ')[0]}</span>
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
                  <ExpandedDetail pos={pos} onNavigate={expandAndScrollTo} meData={meData} />
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
              const receivingStart = pos.receiving_names_from
                ? pos.receiving_names_from.split(' to ')[0].split(' - ')[0]
                : '';
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
                        title={!comparedIds.has(pos.id) && comparedIds.size >= MAX_COMPARE ? `Max ${MAX_COMPARE} positions` : 'Select to compare'}
                      />
                    </td>
                    {/* Church */}
                    <td className="px-3 py-2 text-sm max-w-xs">
                      <div className={`font-medium truncate ${church.isEnriched ? 'text-gray-900' : 'text-gray-500 italic'}`}>
                        {church.text}
                      </div>
                      <div className="text-xs text-gray-400 truncate">{pos.position_type || '\u00A0'}</div>
                    </td>
                    {/* Location */}
                    <td className="px-3 py-2 text-sm text-gray-600">
                      <div className="truncate">{locationPrimary || '\u00A0'}</div>
                      <div className="text-xs text-gray-400 truncate">{pos.diocese || '\u00A0'}</div>
                    </td>
                    {/* Dates */}
                    <td className="px-3 py-2 text-sm text-gray-600">
                      {receivingStart ? (
                        <>
                          <div>{receivingStart}</div>
                          <div className="text-xs text-gray-400">
                            {pos.updated_on_hub ? `Updated ${pos.updated_on_hub}` : '\u00A0'}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="italic text-gray-400">{pos.vh_status || '\u00A0'}</div>
                          <div className="text-xs text-gray-400">
                            {pos.updated_on_hub ? `Updated ${pos.updated_on_hub}` : '\u00A0'}
                          </div>
                        </>
                      )}
                    </td>
                    {/* Status (quality badge) */}
                    <td className="px-3 py-2">
                      <QualityBadge pos={pos} />
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
                      <td colSpan={7} className="px-4 py-4 bg-primary-50/40 border-l-4 border-l-primary-500">
                        <ExpandedDetail pos={pos} onNavigate={expandAndScrollTo} meData={meData} />
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

function ExpandedDetail({ pos, onNavigate, meData }: { pos: Position; onNavigate: (id: string) => void; meData: PersonalData | null }) {
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
        <DioceseContext pos={pos} />
        {pos.parish_context && (
          <ParishContextSection context={pos.parish_context} />
        )}
        {meData && (
          <PersonalContext user={meData} position={pos} />
        )}
        <CommunityContext pos={pos} />
        <QualityScoreDetail pos={pos} />
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
      <DioceseContext pos={pos} />
      {pos.parish_context && (
        <ParishContextSection context={pos.parish_context} />
      )}
      {meData && (
        <PersonalContext user={meData} position={pos} />
      )}
      <CommunityContext pos={pos} />
      <QualityScoreDetail pos={pos} />

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

      {/* Compensation Context */}
      {pos.compensation && (
        <div className="text-sm text-gray-600">
          <span className="font-medium">Diocese median:</span>{' '}
          ${pos.compensation.diocese_median?.toLocaleString()}
          {pos.estimated_total_comp && pos.compensation.diocese_median && (
            <span className={
              pos.estimated_total_comp >= pos.compensation.diocese_median
                ? 'text-green-600 ml-2'
                : 'text-amber-600 ml-2'
            }>
              ({pos.estimated_total_comp >= pos.compensation.diocese_median ? 'Above' : 'Below'} median)
            </span>
          )}
          <span className="text-xs text-gray-400 ml-1">
            ({pos.compensation.year}, n={pos.compensation.diocese_clergy_count})
          </span>
        </div>
      )}

      {/* Clergy Tenure */}
      {pos.parish_clergy_history && (
        <div className="text-sm text-gray-600">
          {pos.current_clergy ? (
            <span>Current: {pos.current_clergy.name} ({pos.current_clergy.position_title}, {pos.current_clergy.years_tenure} years)</span>
          ) : (
            pos.parish_clergy_history.avg_tenure_years > 0 && (
              <span>Avg. clergy tenure: {pos.parish_clergy_history.avg_tenure_years} years</span>
            )
          )}
        </div>
      )}

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
