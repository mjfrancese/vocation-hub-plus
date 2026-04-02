# Phase 4A: Analytics Redesign & Status Display Unification - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify status display across the site (matching filter chips to table column), add a styled popover for status/quality info, and rebuild the analytics page with 6 useful charts + summary cards driven by real position data.

**Architecture:** The status column switches from QualityBadge (visibility-based) to UnifiedStatusBadge + ScorePill (vh_status-based, matching filter chips). A shared StatusPopover wraps both elements for hover/click info. The analytics page is rewritten to load positions via `getPositions()` + `passesDefaultFilter()`, with computation helpers in a new `analytics-helpers.ts` module.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, recharts (already installed)

---

## File Structure

```
web/src/
  components/
    StatusPopover.tsx       -- NEW: styled popover wrapping status badge + score pill
    ScorePill.tsx            -- NEW: small inline quality score indicator
    UnifiedStatusBadge.tsx   -- MODIFY: remove native title attribute
    PositionTable.tsx        -- MODIFY: replace QualityBadge with UnifiedStatusBadge + ScorePill + StatusPopover in STATUS column
  lib/
    analytics-helpers.ts     -- NEW: median, percentile, bucketing, region mapping, ASA extraction
  app/
    analytics/page.tsx       -- FULL REWRITE: new data source, summary cards, 6 charts
```

---

### Task 1: Create ScorePill component

**Files:**
- Create: `web/src/components/ScorePill.tsx`

- [ ] **Step 1: Create the ScorePill component**

Create `web/src/components/ScorePill.tsx`:

```typescript
'use client';

interface ScorePillProps {
  score: number;
  onClick?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export default function ScorePill({ score, onClick, onMouseEnter, onMouseLeave }: ScorePillProps) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500 border border-gray-200 cursor-help ml-1"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {score}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ScorePill.tsx
git commit -m "feat: add ScorePill component for inline quality score display"
```

---

### Task 2: Create StatusPopover component

**Files:**
- Create: `web/src/components/StatusPopover.tsx`

- [ ] **Step 1: Create the StatusPopover component**

Create `web/src/components/StatusPopover.tsx`:

```typescript
'use client';

import { useState, useRef, useEffect } from 'react';
import { Position } from '@/lib/types';
import { getUnifiedStatus, type UnifiedStatus } from '@/lib/status-helpers';

interface StatusPopoverProps {
  pos: Position;
  children: React.ReactNode;
}

const STATUS_DESCRIPTIONS: Record<UnifiedStatus, string> = {
  Active: "This position appears in VocationHub's active search results and is confirmed to be accepting applications.",
  Developing: 'This position is being developed and may not yet be accepting applications.',
  Interim: 'This is an interim position, typically filled on a temporary basis.',
  Closed: 'This position search has been completed or closed.',
  Unlisted: "This position was found in VocationHub's profile directory but is not in active search results.",
};

const ALL_CRITERIA = [
  'Active status (25)',
  'In-progress status (15)',
  'Recent date (15)',
  'Very recent date (5)',
  'Congregation identified (10)',
  'Position named (5)',
  'Church matched (10)',
  'Parochial data (10)',
  'Position type (5)',
  'State known (5)',
  'Exact match (5)',
  'End date set (5)',
];

export default function StatusPopover({ pos, children }: StatusPopoverProps) {
  const [show, setShow] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        wrapperRef.current && !wrapperRef.current.contains(e.target as Node) &&
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
      ) {
        setShow(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [show]);

  const unified = getUnifiedStatus(pos.vh_status || pos.status, pos.visibility);
  const hasScore = pos.visibility === 'extended' || pos.visibility === 'extended_hidden';
  const score = pos.quality_score ?? 0;
  const earned = pos.quality_components || [];

  return (
    <span
      className="relative inline-flex items-center"
      ref={wrapperRef}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => { e.stopPropagation(); setShow(!show); }}
    >
      {children}
      {show && (
        <div
          ref={popoverRef}
          className="absolute z-50 right-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {hasScore ? (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-900">Quality: {score}/100</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                <div
                  className="h-2 rounded-full bg-blue-500"
                  style={{ width: `${score}%` }}
                />
              </div>
              <div className="space-y-0.5">
                {ALL_CRITERIA.map((criterion) => {
                  const met = earned.includes(criterion);
                  return (
                    <div key={criterion} className={`flex items-center gap-1.5 text-xs ${met ? 'text-gray-800' : 'text-gray-400'}`}>
                      <span className={met ? 'text-green-600' : 'text-gray-300'}>{met ? '\u2713' : '\u2013'}</span>
                      <span>{criterion}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-3">
              <div className="text-sm font-semibold text-gray-900 mb-1">{unified}</div>
              <p className="text-xs text-gray-600">{STATUS_DESCRIPTIONS[unified]}</p>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/StatusPopover.tsx
git commit -m "feat: add StatusPopover with styled quality breakdown and status descriptions"
```

---

### Task 3: Update UnifiedStatusBadge to remove native title

**Files:**
- Modify: `web/src/components/UnifiedStatusBadge.tsx`

- [ ] **Step 1: Remove the title attribute**

In `web/src/components/UnifiedStatusBadge.tsx`, the `<span>` on line 19 has `title={tooltip}`. Remove the `title` attribute and the `tooltip` variable since the StatusPopover now handles hover info. Also change `cursor-default` to `cursor-help` since the popover is interactive:

```typescript
'use client';

import { getUnifiedStatus, UNIFIED_STATUS_STYLES, type UnifiedStatus } from '@/lib/status-helpers';

interface UnifiedStatusBadgeProps {
  vhStatus?: string;
  visibility?: string;
}

export default function UnifiedStatusBadge({ vhStatus, visibility }: UnifiedStatusBadgeProps) {
  const unified = getUnifiedStatus(vhStatus, visibility);
  const style = UNIFIED_STATUS_STYLES[unified];

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap cursor-help ${style}`}
    >
      {unified}
    </span>
  );
}

export { getUnifiedStatus, type UnifiedStatus };
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/UnifiedStatusBadge.tsx
git commit -m "feat: remove native title from UnifiedStatusBadge, popover handles hover"
```

---

### Task 4: Replace QualityBadge with unified status in PositionTable

**Files:**
- Modify: `web/src/components/PositionTable.tsx`

- [ ] **Step 1: Update imports**

In `web/src/components/PositionTable.tsx`, replace the QualityBadge import (line 5) with the new components:

Replace:
```typescript
import QualityBadge from './QualityBadge';
```

With:
```typescript
import UnifiedStatusBadge from './UnifiedStatusBadge';
import ScorePill from './ScorePill';
import StatusPopover from './StatusPopover';
```

- [ ] **Step 2: Replace the STATUS column cell**

Find the STATUS column rendering (line 421-424):

```typescript
                    {/* Status (quality badge) */}
                    <td className="px-3 py-2">
                      <QualityBadge pos={pos} />
                    </td>
```

Replace with:

```typescript
                    {/* Status */}
                    <td className="px-3 py-2">
                      <StatusPopover pos={pos}>
                        <UnifiedStatusBadge vhStatus={pos.vh_status || pos.status} visibility={pos.visibility} />
                        {(pos.visibility === 'extended' || pos.visibility === 'extended_hidden') && (
                          <ScorePill score={pos.quality_score ?? 0} />
                        )}
                      </StatusPopover>
                    </td>
```

- [ ] **Step 3: Also update the mobile card status rendering**

Search for any other QualityBadge usage in PositionTable.tsx (likely in the mobile card layout). Replace those similarly. Search for `<QualityBadge` in the file and replace each occurrence with the same StatusPopover + UnifiedStatusBadge + ScorePill pattern.

- [ ] **Step 4: Build to verify**

Run: `cd web && npx next build`
Expected: Build succeeds. QualityBadge import is no longer used in PositionTable.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PositionTable.tsx
git commit -m "feat: replace QualityBadge with UnifiedStatusBadge + ScorePill in status column"
```

---

### Task 5: Create analytics-helpers.ts

**Files:**
- Create: `web/src/lib/analytics-helpers.ts`

- [ ] **Step 1: Create the analytics helpers module**

Create `web/src/lib/analytics-helpers.ts`:

```typescript
import { Position } from './types';

/**
 * Compute median of a numeric array. Returns null if empty.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute percentile value from sorted array.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/**
 * Compute 25th percentile, median, and 75th percentile.
 */
export function quartiles(values: number[]): { p25: number; median: number; p75: number } | null {
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p25: percentile(sorted, 25),
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
  };
}

/**
 * Extract the latest ASA value from a position's parochial data.
 */
export function getLatestASA(pos: Position): number | null {
  const parochial = pos.parochials?.[0];
  if (!parochial?.years) return null;
  const years = Object.keys(parochial.years).sort();
  for (let i = years.length - 1; i >= 0; i--) {
    const asa = parochial.years[years[i]]?.averageAttendance;
    if (asa != null && asa > 0) return asa;
  }
  return null;
}

/**
 * Bucket ASA values into display ranges.
 */
export function getASABucket(asa: number): string {
  if (asa <= 50) return '0-50';
  if (asa <= 100) return '51-100';
  if (asa <= 200) return '101-200';
  if (asa <= 500) return '201-500';
  return '500+';
}

const ASA_BUCKET_ORDER = ['0-50', '51-100', '101-200', '201-500', '500+'];

/**
 * Sort ASA buckets in logical order.
 */
export function sortASABuckets<T extends { bucket: string }>(data: T[]): T[] {
  return [...data].sort((a, b) => ASA_BUCKET_ORDER.indexOf(a.bucket) - ASA_BUCKET_ORDER.indexOf(b.bucket));
}

/**
 * Bucket compensation values into display ranges.
 */
export function getCompBucket(comp: number): string {
  if (comp < 50000) return '$0-50k';
  if (comp < 75000) return '$50-75k';
  if (comp < 100000) return '$75-100k';
  if (comp < 125000) return '$100-125k';
  return '$125k+';
}

const COMP_BUCKET_ORDER = ['$0-50k', '$50-75k', '$75-100k', '$100-125k', '$125k+'];

/**
 * Sort compensation buckets in logical order.
 */
export function sortCompBuckets<T extends { bucket: string }>(data: T[]): T[] {
  return [...data].sort((a, b) => COMP_BUCKET_ORDER.indexOf(a.bucket) - COMP_BUCKET_ORDER.indexOf(b.bucket));
}

/**
 * Map US state abbreviations to regions.
 */
const STATE_TO_REGION: Record<string, string> = {
  CT: 'Northeast', ME: 'Northeast', MA: 'Northeast', NH: 'Northeast', RI: 'Northeast', VT: 'Northeast',
  NJ: 'Northeast', NY: 'Northeast', PA: 'Northeast',
  DE: 'Southeast', FL: 'Southeast', GA: 'Southeast', MD: 'Southeast', NC: 'Southeast', SC: 'Southeast',
  VA: 'Southeast', DC: 'Southeast', WV: 'Southeast', AL: 'Southeast', KY: 'Southeast', MS: 'Southeast',
  TN: 'Southeast', AR: 'Southeast', LA: 'Southeast',
  IL: 'Midwest', IN: 'Midwest', MI: 'Midwest', OH: 'Midwest', WI: 'Midwest',
  IA: 'Midwest', KS: 'Midwest', MN: 'Midwest', MO: 'Midwest', NE: 'Midwest', ND: 'Midwest', SD: 'Midwest',
  AZ: 'Southwest', NM: 'Southwest', OK: 'Southwest', TX: 'Southwest',
  AK: 'West', CA: 'West', CO: 'West', HI: 'West', ID: 'West', MT: 'West', NV: 'West',
  OR: 'West', UT: 'West', WA: 'West', WY: 'West',
};

export function getRegion(state: string): string {
  return STATE_TO_REGION[state] || 'Other';
}

/**
 * Count occurrences in an array, returning sorted {name, count} pairs.
 */
export function countBy(values: string[]): Array<{ name: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Format a number as a compact dollar string (e.g., 92000 -> "$92k").
 */
export function formatCompact(value: number): string {
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${value}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/analytics-helpers.ts
git commit -m "feat: add analytics computation helpers (median, percentiles, bucketing, regions)"
```

---

### Task 6: Rewrite analytics page - data loading and summary cards

**Files:**
- Modify: `web/src/app/analytics/page.tsx`

- [ ] **Step 1: Replace the full analytics page with data loading + summary cards**

Replace the entire contents of `web/src/app/analytics/page.tsx` with:

```typescript
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
                <Tooltip formatter={(value: number) => [value, 'Positions']} />
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
                <Tooltip formatter={(value: number) => [value, 'Positions']} />
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
                <Tooltip formatter={(value: number) => [value, 'Positions']} />
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
                <Tooltip formatter={(value: number) => [value, 'Positions']} />
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
```

- [ ] **Step 2: Build to verify**

Run: `cd web && npx next build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/analytics/page.tsx
git commit -m "feat: rewrite analytics page with summary cards and 6 focused charts"
```

---

### Task 7: Build verification and visual testing

**Files:**
- All modified files

- [ ] **Step 1: Run build**

```bash
cd web && npx next build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 2: Start dev server and verify**

```bash
cd web && npx next dev
```

Verify in browser:

1. **Positions page (/):**
   - STATUS column shows unified status badges (Active, Developing, Interim, Closed, Unlisted)
   - Extended positions show a small score pill (e.g., "72") after the status badge
   - Hovering over a status badge or score pill shows the styled popover
   - Public positions show brief status description in popover
   - Extended positions show quality score breakdown with progress bar and criteria checklist
   - Status badge text matches filter chip text (no more "Unlisted . 72" vs "Developing" mismatch)

2. **Analytics page (/analytics):**
   - Shows "Market snapshot from X open positions" with correct count
   - 4 summary cards: Open Positions, Median Total Comp, Most Common Type, Median ASA
   - 6 charts render with real data
   - Charts without enough data show "Not enough data" placeholder
   - Range charts (comp by type, comp by church size) show horizontal ranges with median lines
   - Mobile: cards are 2x2, charts stack to single column

- [ ] **Step 3: Fix any issues found**

Address build errors, runtime errors, or visual issues.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix: integration fixes for Phase 4A analytics and status unification"
```
