'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { getPositions } from '@/lib/data';
import { passesDefaultFilter } from '@/lib/filter-defaults';
import {
  median, quartiles, getLatestASA, getASABucket, sortASABuckets,
  getCompBucket, sortCompBuckets, getRegion, countBy, formatCompact,
} from '@/lib/analytics-helpers';

export default function AnalyticsPage() {
  const positions = useMemo(() => getPositions().filter(passesDefaultFilter), []);

  // --- Summary card computations ---
  const compValues = useMemo(() =>
    positions.map(p => p.estimated_total_comp).filter((v): v is number => v != null && v > 0),
  [positions]);
  const medianComp = useMemo(() => median(compValues), [compValues]);

  const allTypes = useMemo(() =>
    positions.flatMap(p => p.position_types || []).filter(Boolean),
  [positions]);
  const typeCounts = useMemo(() => countBy(allTypes), [allTypes]);
  const mostCommonType = typeCounts.length > 0 ? typeCounts[0].name : '--';

  const asaValues = useMemo(() =>
    positions.map(getLatestASA).filter((v): v is number => v != null),
  [positions]);
  const medianASA = useMemo(() => median(asaValues), [asaValues]);

  // --- Chart 1: Compensation Distribution ---
  const compDistribution = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (const v of compValues) {
      const b = getCompBucket(v);
      buckets[b] = (buckets[b] || 0) + 1;
    }
    return sortCompBuckets(Object.entries(buckets).map(([bucket, count]) => ({ bucket, count })));
  }, [compValues]);

  // --- Chart 2: Position Types (top 8 + Other) ---
  const positionTypeData = useMemo(() => {
    const top = typeCounts.slice(0, 8);
    const rest = typeCounts.slice(8).reduce((sum, t) => sum + t.count, 0);
    const result = top.map(t => ({ name: t.name, count: t.count }));
    if (rest > 0) result.push({ name: 'Other', count: rest });
    return result;
  }, [typeCounts]);

  // --- Chart 3: ASA Distribution ---
  const asaDistribution = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (const v of asaValues) {
      const b = getASABucket(v);
      buckets[b] = (buckets[b] || 0) + 1;
    }
    return sortASABuckets(Object.entries(buckets).map(([bucket, count]) => ({ bucket, count })));
  }, [asaValues]);

  // --- Chart 4: Comp by Position Type ---
  const compByType = useMemo(() => {
    const groups: Record<string, number[]> = {};
    for (const pos of positions) {
      if (!pos.estimated_total_comp || pos.estimated_total_comp <= 0) continue;
      for (const t of (pos.position_types || [])) {
        if (!groups[t]) groups[t] = [];
        groups[t].push(pos.estimated_total_comp);
      }
    }
    return Object.entries(groups)
      .filter(([, vals]) => vals.length >= 3)
      .map(([name, vals]) => {
        const q = quartiles(vals)!;
        return { name, p25: q.p25, median: q.median, p75: q.p75, count: vals.length };
      })
      .sort((a, b) => b.median - a.median);
  }, [positions]);

  // --- Chart 5: Comp by Church Size ---
  const compByASA = useMemo(() => {
    const groups: Record<string, number[]> = {};
    for (const pos of positions) {
      if (!pos.estimated_total_comp || pos.estimated_total_comp <= 0) continue;
      const asa = getLatestASA(pos);
      if (asa == null) continue;
      const bucket = getASABucket(asa);
      if (!groups[bucket]) groups[bucket] = [];
      groups[bucket].push(pos.estimated_total_comp);
    }
    return sortASABuckets(
      Object.entries(groups)
        .filter(([, vals]) => vals.length >= 3)
        .map(([bucket, vals]) => {
          const q = quartiles(vals)!;
          return { bucket, p25: q.p25, median: q.median, p75: q.p75, count: vals.length };
        })
    );
  }, [positions]);

  // --- Chart 6: Positions by Region ---
  const regionData = useMemo(() => {
    const regions = positions.map(p => getRegion(p.state)).filter(r => r !== 'Other');
    return countBy(regions);
  }, [positions]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Position Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">
          Market snapshot from {positions.length} open positions
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Open Positions" value={String(positions.length)} />
        <SummaryCard label="Median Total Comp" value={medianComp != null ? formatCompact(medianComp) : '--'} />
        <SummaryCard label="Most Common Type" value={mostCommonType} />
        <SummaryCard label="Median ASA" value={medianASA != null ? String(Math.round(medianASA)) : '--'} />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Chart 1: Compensation Distribution */}
        <ChartCard title="Compensation Distribution" subtitle={compValues.length > 0 ? `${compValues.length} positions with comp data` : undefined}>
          {compDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={compDistribution} layout="vertical" margin={{ left: 60, right: 30, top: 5, bottom: 5 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="bucket" tick={{ fontSize: 11 }} width={60} />
                <Tooltip formatter={(value) => [value, 'Positions']} />
                <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                {medianComp != null && <ReferenceLine x={0} stroke="transparent" />}
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        {/* Chart 2: Position Types */}
        <ChartCard title="Position Types">
          {positionTypeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={positionTypeData} layout="vertical" margin={{ left: 100, right: 30, top: 5, bottom: 5 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                <Tooltip formatter={(value) => [value, 'Positions']} />
                <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        {/* Chart 3: Church Size (ASA) */}
        <ChartCard title="Church Size (ASA)" subtitle={asaValues.length > 0 ? `${asaValues.length} positions with ASA data` : undefined}>
          {asaDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={asaDistribution} layout="vertical" margin={{ left: 60, right: 30, top: 5, bottom: 5 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="bucket" tick={{ fontSize: 11 }} width={60} />
                <Tooltip formatter={(value) => [value, 'Positions']} />
                <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        {/* Chart 4: Compensation by Position Type */}
        <ChartCard title="Compensation by Position Type" subtitle="25th-75th percentile range with median">
          {compByType.length > 0 ? (
            <div className="space-y-3 pt-2">
              {compByType.map(row => (
                <RangeRow key={row.name} label={row.name} p25={row.p25} median={row.median} p75={row.p75} color="#3b82f6" />
              ))}
            </div>
          ) : <EmptyChart />}
        </ChartCard>

        {/* Chart 5: Compensation by Church Size */}
        <ChartCard title="Compensation by Church Size" subtitle="25th-75th percentile range with median">
          {compByASA.length > 0 ? (
            <div className="space-y-3 pt-2">
              {compByASA.map(row => (
                <RangeRow key={row.bucket} label={`ASA ${row.bucket}`} p25={row.p25} median={row.median} p75={row.p75} color="#059669" />
              ))}
            </div>
          ) : <EmptyChart />}
        </ChartCard>

        {/* Chart 6: Positions by Region */}
        <ChartCard title="Positions by Region">
          {regionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={regionData} layout="vertical" margin={{ left: 80, right: 30, top: 5, bottom: 5 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                <Tooltip formatter={(value) => [value, 'Positions']} />
                <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>
      </div>
    </div>
  );
}

// --- Sub-components ---

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 text-center">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-gray-900 mb-1">{title}</div>
      {subtitle && <div className="text-xs text-gray-400 mb-3">{subtitle}</div>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex items-center justify-center h-40 text-sm text-gray-400">
      Not enough data
    </div>
  );
}

function RangeRow({ label, p25, p75, median: med, color }: { label: string; p25: number; p75: number; median: number; color: string }) {
  // Scale to 0-200k range for display
  const max = 200000;
  const leftPct = Math.min((p25 / max) * 100, 100);
  const rightPct = Math.max(100 - (p75 / max) * 100, 0);
  const medianPct = Math.min((med / max) * 100, 100);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-600 w-28 text-right truncate">{label}</span>
      <div className="flex-1 relative h-5">
        <div
          className="absolute top-0 h-full rounded"
          style={{ left: `${leftPct}%`, right: `${rightPct}%`, backgroundColor: `${color}20` }}
        />
        <div
          className="absolute top-0 w-0.5 h-full"
          style={{ left: `${medianPct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs text-gray-600 w-12">{formatCompact(med)}</span>
    </div>
  );
}
