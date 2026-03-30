'use client';

import { useEffect, useRef } from 'react';
import { Position } from '@/lib/types';
import { isGibberish } from '@/lib/gibberish-detector';

interface ComparisonModalProps {
  positions: Position[];
  onClose: () => void;
}

function getChurchName(pos: Position): string {
  return pos.church_info?.name || pos.name;
}

function getCity(pos: Position): string {
  return pos.church_info?.city || pos.city || '';
}

function getState(pos: Position): string {
  return pos.church_info?.state || pos.state || '';
}

function timeOnMarket(pos: Position): string {
  const now = new Date();
  const parseAnyDate = (s: string): Date | null => {
    if (!s) return null;
    const first = s.split(/\s+(?:to|-)\s*/)[0].trim();
    const mdy = first.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
    const d = new Date(first);
    return isNaN(d.getTime()) ? null : d;
  };
  const firstSeen = parseAnyDate(pos.first_seen);
  const usableFirstSeen = firstSeen && (now.getTime() - firstSeen.getTime()) > 86400000 ? firstSeen : null;
  const seen = usableFirstSeen || parseAnyDate(pos.receiving_names_from);
  if (!seen) return '';
  const diffMs = now.getTime() - seen.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return '';
  if (days < 1) return 'today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month';
  if (months < 12) return `${months} months`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1 year' : `${years} years`;
}

function getLatestParochialYear(pos: Position): string | null {
  if (!pos.parochial) return null;
  const years = Object.keys(pos.parochial.years).sort();
  return years.length > 0 ? years[years.length - 1] : null;
}

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

function trendArrowText(trend: 'up' | 'down' | 'flat' | null): string {
  if (trend === 'up') return ' \u25B2';
  if (trend === 'down') return ' \u25BC';
  if (trend === 'flat') return ' \u2014';
  return '';
}

function computeParishSnapshot(pos: Position): string {
  if (!pos.parochial || Object.keys(pos.parochial.years).length === 0) return '';
  const computeTrend = (metric: 'averageAttendance' | 'plateAndPledge' | 'membership') => {
    const sorted = Object.keys(pos.parochial!.years).sort();
    const recent = sorted.slice(-5);
    const values = recent
      .map(y => pos.parochial!.years[y][metric])
      .filter((v): v is number => v !== null && v > 0);
    if (values.length < 2) return null;
    const first = values[0];
    const last = values[values.length - 1];
    const pct = Math.round(((last - first) / first) * 100);
    return pct > 10 ? 'up' : pct < -10 ? 'down' : 'flat';
  };
  const asa = computeTrend('averageAttendance');
  const giving = computeTrend('plateAndPledge');
  const membership = computeTrend('membership');
  const dirs = [asa, giving, membership].filter(Boolean);
  const upCount = dirs.filter(d => d === 'up').length;
  const downCount = dirs.filter(d => d === 'down').length;
  if (upCount > downCount) return 'Growing';
  if (downCount > upCount) return 'Declining';
  return 'Stable';
}

function findDeepField(pos: Position, ...keywords: string[]): string {
  const fields = pos.deep_scrape_fields || [];
  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    const match = fields.find(
      (f) => f.label.toLowerCase().includes(lower) && !isGibberish(f.value)
    );
    if (match?.value) return match.value;
  }
  return '';
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

/** Identifies which column index has the "best" (highest) numeric value. Returns -1 if none. */
function bestIndex(values: (number | null | undefined)[]): number {
  let best = -1;
  let bestVal = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v != null && v > bestVal) {
      bestVal = v;
      best = i;
    }
  }
  // Only highlight if there are at least 2 non-null values and there is a clear winner
  const nonNull = values.filter(v => v != null);
  if (nonNull.length < 2) return -1;
  return best;
}

export default function ComparisonModal({ positions, onClose }: ComparisonModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  // Gather comparison data
  const latestYears = positions.map(getLatestParochialYear);

  const asaValues = positions.map((pos, i) => {
    const yr = latestYears[i];
    if (!yr || !pos.parochial) return null;
    return pos.parochial.years[yr]?.averageAttendance ?? null;
  });

  const platePledgeValues = positions.map((pos, i) => {
    const yr = latestYears[i];
    if (!yr || !pos.parochial) return null;
    return pos.parochial.years[yr]?.plateAndPledge ?? null;
  });

  const membershipValues = positions.map((pos, i) => {
    const yr = latestYears[i];
    if (!yr || !pos.parochial) return null;
    return pos.parochial.years[yr]?.membership ?? null;
  });

  const compValues = positions.map(p => p.estimated_total_comp ?? null);

  const bestComp = bestIndex(compValues);
  const bestAsa = bestIndex(asaValues);
  const bestPP = bestIndex(platePledgeValues);
  const bestMembership = bestIndex(membershipValues);

  type Row = {
    label: string;
    values: string[];
    highlightIndex?: number;
  };

  const rows: Row[] = [
    {
      label: 'Church',
      values: positions.map(getChurchName),
    },
    {
      label: 'Location',
      values: positions.map(p => [getCity(p), getState(p)].filter(Boolean).join(', ')),
    },
    {
      label: 'Diocese',
      values: positions.map(p => p.diocese),
    },
    {
      label: 'Position Type',
      values: positions.map(p => p.position_type || ''),
    },
    {
      label: 'Est. Total Compensation',
      values: positions.map(p => {
        if (!p.estimated_total_comp) return '';
        let s = `$${p.estimated_total_comp.toLocaleString()}`;
        if (p.comp_breakdown) {
          const parts: string[] = [`Stipend: $${p.comp_breakdown.stipend.toLocaleString()}`];
          if (p.comp_breakdown.housing) parts.push(`Housing: ~$${p.comp_breakdown.housing.toLocaleString()}`);
          s += ` (${parts.join(' + ')})`;
        }
        return s;
      }),
      highlightIndex: bestComp,
    },
    {
      label: `ASA (most recent year)`,
      values: positions.map((pos, i) => {
        const v = asaValues[i];
        if (v == null) return '';
        const trend = getAsaTrend(pos);
        return `${v}${trendArrowText(trend)}`;
      }),
      highlightIndex: bestAsa,
    },
    {
      label: 'Plate & Pledge',
      values: positions.map((_pos, i) => {
        const v = platePledgeValues[i];
        if (v == null) return '';
        return `$${v.toLocaleString()}`;
      }),
      highlightIndex: bestPP,
    },
    {
      label: 'Membership',
      values: positions.map((_pos, i) => {
        const v = membershipValues[i];
        if (v == null) return '';
        return v.toLocaleString();
      }),
      highlightIndex: bestMembership,
    },
    {
      label: 'Diocese Percentile',
      values: positions.map(p => {
        if (!p.diocese_percentiles) return '';
        const parts: string[] = [];
        if (p.diocese_percentiles.asa != null) {
          parts.push(`ASA: ${p.diocese_percentiles.asa}${ordinalSuffix(p.diocese_percentiles.asa)} %ile`);
        }
        if (p.diocese_percentiles.plate_pledge != null) {
          parts.push(`Giving: ${p.diocese_percentiles.plate_pledge}${ordinalSuffix(p.diocese_percentiles.plate_pledge)} %ile`);
        }
        return parts.join(', ');
      }),
    },
    {
      label: 'Housing',
      values: positions.map(p => p.housing_type || findDeepField(p, 'Housing') || ''),
    },
    {
      label: 'Benefits',
      values: positions.map(p => {
        const parts: string[] = [];
        const pension = findDeepField(p, 'Pension');
        const healthcare = findDeepField(p, 'Healthcare');
        const vacation = findDeepField(p, 'Vacation');
        if (pension) parts.push(`Pension: ${pension}`);
        if (healthcare) parts.push(`Healthcare: ${healthcare}`);
        if (vacation) parts.push(`Vacation: ${vacation}`);
        return parts.join('; ');
      }),
    },
    {
      label: 'Worship Style',
      values: positions.map(p => p.worship_style || findDeepField(p, 'Worship') || ''),
    },
    {
      label: 'Time on Market',
      values: positions.map(p => timeOnMarket(p)),
    },
    {
      label: 'Parish Health',
      values: positions.map(computeParishSnapshot),
    },
  ];

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Compare Positions ({positions.length})
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close comparison"
          >
            &times;
          </button>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 min-w-[140px]">
                  Field
                </th>
                {positions.map(pos => (
                  <th key={pos.id} className="text-left px-4 py-2 text-xs font-medium text-gray-700 min-w-[200px]">
                    {getChurchName(pos)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => {
                // Skip rows where all values are empty
                if (row.values.every(v => !v)) return null;
                return (
                  <tr key={row.label}>
                    <td className="px-4 py-2.5 font-medium text-gray-500 sticky left-0 bg-white border-r border-gray-100">
                      {row.label}
                    </td>
                    {row.values.map((val, i) => (
                      <td
                        key={i}
                        className={`px-4 py-2.5 text-gray-900 ${
                          row.highlightIndex === i && val ? 'bg-green-50 font-medium' : ''
                        }`}
                      >
                        {val || <span className="text-gray-300">-</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
