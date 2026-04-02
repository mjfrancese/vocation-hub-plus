# Phase 3: Navigation, Filtering & Information Architecture - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make filtered views shareable via URL, rename "Directory Only" to "Unlisted" with smarter defaults, add date-based sorting/filtering, enhance map pins with rich info cards, and update the About page.

**Architecture:** All filter state moves from React `useState` into URL search params via a `useFilterState()` hook. Components consume the same interface -- the URL persistence is transparent. The status model renames "Directory Only" to "Unlisted" and introduces a quality gate for default visibility.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, Leaflet (map), `next/navigation` (useSearchParams, useRouter)

---

## File Structure

```
web/src/
  hooks/
    useFilterState.ts        -- NEW: URL-persisted filter state hook
  lib/
    status-helpers.ts        -- MODIFY: rename Directory Only -> Unlisted, add isQualifyingUnlisted()
    types.ts                 -- MODIFY: expand SortField, update visibility type comments
    filter-defaults.ts       -- NEW: smart default logic, qualifying Unlisted threshold
  components/
    Filters.tsx              -- MODIFY: add "Posted" dropdown, remove hideClosed prop
    PositionTable.tsx        -- MODIFY: new sort fields, adaptive date column
    MapView.tsx              -- MODIFY: rich popup card, bounds fitting, navigation
    UnifiedStatusBadge.tsx   -- MODIFY: rename Directory Only -> Unlisted
    QualityBadge.tsx         -- MODIFY: rename Directory -> Unlisted
  app/
    page.tsx                 -- MODIFY: replace useState with useFilterState, new defaults
    about/page.tsx           -- MODIFY: add data sources, update text and labels
```

---

### Task 1: Rename "Directory Only" to "Unlisted" in status helpers

**Files:**
- Modify: `web/src/lib/status-helpers.ts`

- [ ] **Step 1: Update UnifiedStatus type and constants**

In `web/src/lib/status-helpers.ts`, change every occurrence of `'Directory Only'` to `'Unlisted'`:

```typescript
// Line 59 - Update the type
export type UnifiedStatus = 'Active' | 'Developing' | 'Interim' | 'Closed' | 'Unlisted';

// Line 61 - Update the array
export const UNIFIED_STATUSES: UnifiedStatus[] = ['Active', 'Developing', 'Interim', 'Closed', 'Unlisted'];

// Lines 63-69 - Update UNIFIED_STATUS_STYLES
export const UNIFIED_STATUS_STYLES: Record<UnifiedStatus, { bg: string; text: string }> = {
  Active: { bg: 'bg-green-100', text: 'text-green-700' },
  Developing: { bg: 'bg-blue-100', text: 'text-blue-700' },
  Interim: { bg: 'bg-amber-100', text: 'text-amber-700' },
  Closed: { bg: 'bg-gray-100', text: 'text-gray-600' },
  Unlisted: { bg: 'bg-blue-100', text: 'text-blue-700' },
};

// Lines 71-77 - Update UNIFIED_STATUS_CHIP_COLORS
export const UNIFIED_STATUS_CHIP_COLORS: Record<UnifiedStatus, { active: string; inactive: string }> = {
  Active: { active: 'bg-green-600 text-white', inactive: 'bg-white text-green-700 border border-green-300' },
  Developing: { active: 'bg-blue-600 text-white', inactive: 'bg-white text-blue-700 border border-blue-300' },
  Interim: { active: 'bg-amber-500 text-white', inactive: 'bg-white text-amber-700 border border-amber-300' },
  Closed: { active: 'bg-gray-600 text-white', inactive: 'bg-white text-gray-600 border border-gray-300' },
  Unlisted: { active: 'bg-blue-600 text-white', inactive: 'bg-white text-blue-700 border border-blue-300' },
};
```

- [ ] **Step 2: Update getUnifiedStatus() function**

In the same file, update the function that returns `'Directory Only'` to return `'Unlisted'`:

Find the line in `getUnifiedStatus()` that returns `'Directory Only'` (around line 108) and change it:

```typescript
// Was: return 'Directory Only';
return 'Unlisted';
```

- [ ] **Step 3: Add isQualifyingUnlisted() helper**

Add this function at the end of `status-helpers.ts`:

```typescript
/**
 * Determines if an Unlisted position qualifies for the default view.
 * Must have: quality score >= 85, receiving_names_from within 12 months, parochial data.
 */
export function isQualifyingUnlisted(pos: {
  visibility?: string;
  quality_score?: number;
  receiving_names_from?: string;
  parochials?: Array<{ years: Record<string, unknown> }>;
  vh_status?: string;
  status?: string;
}): boolean {
  const unified = getUnifiedStatus(pos.vh_status || pos.status, pos.visibility);
  if (unified !== 'Unlisted') return false;
  if ((pos.quality_score ?? 0) < 85) return false;

  // Must have a receiving_names_from date within 12 months
  const dateStr = pos.receiving_names_from;
  if (!dateStr) return false;
  const parsed = parseDate(dateStr);
  if (!parsed) return false;
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  if (parsed < oneYearAgo) return false;

  // Must have parochial data
  const parochial = pos.parochials?.[0];
  if (!parochial || Object.keys(parochial.years).length === 0) return false;

  return true;
}

function parseDate(str: string): Date | null {
  if (!str) return null;
  // Handle MM/DD/YYYY
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
  // Handle YYYY-MM-DD or ISO
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
```

- [ ] **Step 4: Build to verify no type errors**

Run: `cd web && npx next build`
Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/status-helpers.ts
git commit -m "feat: rename Directory Only to Unlisted, add qualifying Unlisted logic"
```

---

### Task 2: Rename "Directory" in badge components

**Files:**
- Modify: `web/src/components/UnifiedStatusBadge.tsx`
- Modify: `web/src/components/QualityBadge.tsx`

- [ ] **Step 1: Update UnifiedStatusBadge**

No code changes needed -- `UnifiedStatusBadge` calls `getUnifiedStatus()` which now returns `'Unlisted'` instead of `'Directory Only'`. The badge text updates automatically. Verify the re-export is correct.

- [ ] **Step 2: Update QualityBadge**

In `web/src/components/QualityBadge.tsx`, find the `badgeConfig()` function's `'extended'` case (around line 28) and change:

```typescript
// Was:
label: `Directory \u00B7 ${score}`,
// Change to:
label: `Unlisted \u00B7 ${score}`,
```

Also find the `'extended_hidden'` case (around line 33) and change:

```typescript
// Was (if it says "Directory" or "Incomplete"):
label: `Incomplete \u00B7 ${score}`,
// Keep as "Incomplete" -- this is fine, not a directory rename
```

- [ ] **Step 3: Build to verify**

Run: `cd web && npx next build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/QualityBadge.tsx
git commit -m "feat: rename Directory to Unlisted in quality badge"
```

---

### Task 3: Expand SortField type

**Files:**
- Modify: `web/src/lib/types.ts`

- [ ] **Step 1: Update SortField type**

In `web/src/lib/types.ts`, replace the SortField type (around line 273):

```typescript
export type SortField =
  | 'name'
  | 'diocese'
  | 'date'        // receiving_names_from (renamed from 'receiving_names_from')
  | 'updated'     // updated_on_hub
  | 'firstseen'   // first_seen
  | 'quality_score';
```

- [ ] **Step 2: Build to find all references that need updating**

Run: `cd web && npx next build 2>&1`
Expected: Type errors in `PositionTable.tsx` and `page.tsx` where `'receiving_names_from'` is used as a SortField. Note the line numbers for Task 7.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/types.ts
git commit -m "feat: expand SortField with date, updated, firstseen"
```

---

### Task 4: Create filter defaults module

**Files:**
- Create: `web/src/lib/filter-defaults.ts`

- [ ] **Step 1: Create the filter defaults module**

Create `web/src/lib/filter-defaults.ts`:

```typescript
import { Position } from './types';
import { getUnifiedStatus, UnifiedStatus, isQualifyingUnlisted } from './status-helpers';

/**
 * Default statuses shown on page load (chips pre-selected).
 */
export const DEFAULT_ACTIVE_STATUSES: UnifiedStatus[] = ['Active', 'Developing', 'Interim'];

/**
 * Check if a position should appear in the default view.
 * Active/New/Developing/Interim always show; qualifying Unlisted positions also show.
 */
export function passesDefaultFilter(pos: Position): boolean {
  const unified = getUnifiedStatus(pos.vh_status || pos.status, pos.visibility);
  if (unified === 'Active' || unified === 'Developing' || unified === 'Interim') return true;
  if (isQualifyingUnlisted(pos)) return true;
  return false;
}

/**
 * Duration shorthand to milliseconds for date range filtering.
 */
const DURATION_MS: Record<string, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '6m': 182 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

export const POSTED_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '6m', label: 'Last 6 months' },
  { value: '1y', label: 'Last year' },
] as const;

/**
 * Check if a position was posted within the given duration.
 * Uses receiving_names_from, falls back to first_seen.
 */
export function isPostedWithin(pos: Position, duration: string): boolean {
  const ms = DURATION_MS[duration];
  if (!ms) return true; // unknown duration = no filter

  const dateStr = pos.receiving_names_from || pos.first_seen;
  if (!dateStr) return false;

  const parsed = parseAnyDate(dateStr);
  if (!parsed) return false;

  const cutoff = Date.now() - ms;
  return parsed.getTime() >= cutoff;
}

function parseAnyDate(str: string): Date | null {
  if (!str) return null;
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/filter-defaults.ts
git commit -m "feat: add filter defaults with qualifying Unlisted and date range logic"
```

---

### Task 5: Create useFilterState hook

**Files:**
- Create: `web/src/hooks/useFilterState.ts`

- [ ] **Step 1: Create the hook**

Create `web/src/hooks/useFilterState.ts`:

```typescript
'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { SortField, SortDirection } from '@/lib/types';
import { DEFAULT_ACTIVE_STATUSES } from '@/lib/filter-defaults';

export interface FilterState {
  statuses: string[];
  states: string[];
  dioceses: string[];
  types: string[];
  compensationRanges: string[];
  regions: string[];
  settings: string[];
  housingTypes: string[];
  healthcareOptions: string[];
  postedWithin: string | null;
  sort: { field: SortField; direction: SortDirection };
  query: string;
  view: 'table' | 'map';
  expandedId: string | null;
}

export interface FilterActions {
  setStatuses: (v: string[]) => void;
  setStates: (v: string[]) => void;
  setDioceses: (v: string[]) => void;
  setTypes: (v: string[]) => void;
  setCompensationRanges: (v: string[]) => void;
  setRegions: (v: string[]) => void;
  setSettings: (v: string[]) => void;
  setHousingTypes: (v: string[]) => void;
  setHealthcareOptions: (v: string[]) => void;
  setPostedWithin: (v: string | null) => void;
  setSort: (field: SortField, direction: SortDirection) => void;
  setQuery: (v: string) => void;
  setView: (v: 'table' | 'map') => void;
  setExpandedId: (v: string | null) => void;
  clearAll: () => void;
}

const SORT_DEFAULT_FIELD: SortField = 'date';
const SORT_DEFAULT_DIR: SortDirection = 'desc';

function splitParam(val: string | null): string[] {
  if (!val) return [];
  return val.split(',').filter(Boolean);
}

function joinParam(arr: string[]): string | null {
  return arr.length > 0 ? arr.join(',') : null;
}

function parseSortParam(val: string | null): { field: SortField; direction: SortDirection } {
  if (!val) return { field: SORT_DEFAULT_FIELD, direction: SORT_DEFAULT_DIR };
  const [field, dir] = val.split(':');
  const validFields: SortField[] = ['name', 'diocese', 'date', 'updated', 'firstseen', 'quality_score'];
  const f = validFields.includes(field as SortField) ? (field as SortField) : SORT_DEFAULT_FIELD;
  const d: SortDirection = dir === 'asc' ? 'asc' : 'desc';
  return { field: f, direction: d };
}

export function useFilterState(): [FilterState, FilterActions] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const state: FilterState = useMemo(() => ({
    statuses: splitParam(searchParams.get('status')),
    states: splitParam(searchParams.get('state')),
    dioceses: splitParam(searchParams.get('diocese')),
    types: splitParam(searchParams.get('type')),
    compensationRanges: splitParam(searchParams.get('comp')),
    regions: splitParam(searchParams.get('region')),
    settings: splitParam(searchParams.get('setting')),
    housingTypes: splitParam(searchParams.get('housing')),
    healthcareOptions: splitParam(searchParams.get('healthcare')),
    postedWithin: searchParams.get('posted') || null,
    sort: parseSortParam(searchParams.get('sort')),
    query: searchParams.get('q') || '',
    view: (searchParams.get('view') === 'map' ? 'map' : 'table') as 'table' | 'map',
    expandedId: searchParams.get('expanded') || null,
  }), [searchParams]);

  const updateParams = useCallback((updates: Record<string, string | null>, push = false) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const str = params.toString();
    const url = str ? `${pathname}?${str}` : pathname;
    if (push) {
      router.push(url);
    } else {
      router.replace(url);
    }
  }, [searchParams, router, pathname]);

  const actions: FilterActions = useMemo(() => ({
    setStatuses: (v) => updateParams({ status: joinParam(v) }),
    setStates: (v) => updateParams({ state: joinParam(v) }),
    setDioceses: (v) => updateParams({ diocese: joinParam(v) }),
    setTypes: (v) => updateParams({ type: joinParam(v) }),
    setCompensationRanges: (v) => updateParams({ comp: joinParam(v) }),
    setRegions: (v) => updateParams({ region: joinParam(v) }),
    setSettings: (v) => updateParams({ setting: joinParam(v) }),
    setHousingTypes: (v) => updateParams({ housing: joinParam(v) }),
    setHealthcareOptions: (v) => updateParams({ healthcare: joinParam(v) }),
    setPostedWithin: (v) => updateParams({ posted: v }),
    setSort: (field, direction) => {
      const val = `${field}:${direction}`;
      const defaultVal = `${SORT_DEFAULT_FIELD}:${SORT_DEFAULT_DIR}`;
      updateParams({ sort: val === defaultVal ? null : val });
    },
    setQuery: (v) => updateParams({ q: v || null }),
    setView: (v) => updateParams({ view: v === 'table' ? null : v }, true),
    setExpandedId: (v) => updateParams({ expanded: v }, true),
    clearAll: () => {
      router.replace(pathname);
    },
  }), [updateParams, router, pathname]);

  return [state, actions];
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/hooks/useFilterState.ts
git commit -m "feat: add useFilterState hook for URL-persisted filter state"
```

---

### Task 6: Add "Posted" dropdown to Filters component

**Files:**
- Modify: `web/src/components/Filters.tsx`

- [ ] **Step 1: Update FiltersProps interface**

Remove `hideClosed` and `onHideClosedChange` props. Add `postedWithin` and `onPostedWithinChange`:

```typescript
interface FiltersProps {
  filters: FilterConfig[];
  onClear: () => void;
  postedWithin: string | null;
  onPostedWithinChange: (value: string | null) => void;
}
```

- [ ] **Step 2: Replace "Hide closed" checkbox with "Posted" dropdown**

Remove the "Hide closed" checkbox (lines 65-74 in current file). Replace with a "Posted" dropdown:

```tsx
{/* Posted Within filter */}
<div className="min-w-[140px]">
  <label className="block text-xs text-gray-500 mb-1">Posted</label>
  <select
    value={postedWithin || ''}
    onChange={(e) => onPostedWithinChange(e.target.value || null)}
    className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-primary-500"
  >
    <option value="">All time</option>
    <option value="7d">Last 7 days</option>
    <option value="30d">Last 30 days</option>
    <option value="90d">Last 90 days</option>
    <option value="6m">Last 6 months</option>
    <option value="1y">Last year</option>
  </select>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Filters.tsx
git commit -m "feat: replace Hide Closed checkbox with Posted Within dropdown"
```

---

### Task 7: Update PositionTable with new sort fields and date display

**Files:**
- Modify: `web/src/components/PositionTable.tsx`

- [ ] **Step 1: Update COLUMNS to use new SortField values**

Replace the COLUMNS array (around line 16):

```typescript
const COLUMNS: Array<{ key: SortField; label: string }> = [
  { key: 'name', label: 'Church' },
  { key: 'diocese', label: 'Location' },
  { key: 'date', label: 'Date Posted' },
  { key: 'quality_score', label: 'Status' },
];
```

- [ ] **Step 2: Add mobile sort options for new fields**

In the mobile sort dropdown (around line 214), add the new options. Replace the `<select>` options:

```tsx
<select
  value={sortField}
  onChange={(e) => { setSortField(e.target.value as SortField); setSortDir('desc'); }}
  className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
>
  <option value="name">Church Name</option>
  <option value="diocese">Diocese</option>
  <option value="date">Date Posted</option>
  <option value="updated">Last Updated</option>
  <option value="firstseen">First Seen</option>
  <option value="quality_score">Quality Score</option>
</select>
```

- [ ] **Step 3: Update sort logic for new fields**

Update the sort comparator (around line 153). Replace the `receiving_names_from` case and add new date field cases:

```typescript
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

  // String-based sorting
  let aVal: string, bVal: string;
  if (sortField === 'name') {
    aVal = getChurchName(a).text;
    bVal = getChurchName(b).text;
  } else if (sortField === 'diocese') {
    aVal = a.diocese || '';
    bVal = b.diocese || '';
  } else {
    aVal = String((a as Record<string, unknown>)[sortField] || '');
    bVal = String((b as Record<string, unknown>)[sortField] || '');
  }
  const cmp = aVal.localeCompare(bVal);
  return sortDir === 'asc' ? cmp : -cmp;
});
```

- [ ] **Step 4: Update date column display to adapt to sort field**

In the date column rendering (around lines 378-393), update to show the relevant date based on `sortField`:

```tsx
<td className="py-2 px-2 text-sm text-gray-600 whitespace-nowrap">
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
          <div className="text-xs text-gray-400">Updated {formatRelativeDate(secondaryField)}</div>
        )}
      </>
    );
  })()}
</td>
```

- [ ] **Step 5: Update default sort to date:desc**

Change the state initialization (around line 114):

```typescript
const [sortField, setSortField] = useState<SortField>(initialSortField ?? 'date');
const [sortDir, setSortDir] = useState<SortDirection>(initialSortDir ?? 'desc');
```

Update the PositionTable props interface to accept initial sort values:

```typescript
interface PositionTableProps {
  positions: Position[];
  onNavigate?: (id: string) => void;
  meData: PersonalData | null;
  initialSortField?: SortField;
  initialSortDir?: SortDirection;
  initialExpandedId?: string | null;
  onExpandedChange?: (id: string | null) => void;
}
```

- [ ] **Step 6: Build to verify**

Run: `cd web && npx next build`
Expected: May fail because page.tsx still uses old SortField values. That's expected -- fixed in Task 8.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/PositionTable.tsx
git commit -m "feat: add updated/firstseen sort, adaptive date column, default date:desc"
```

---

### Task 8: Integrate useFilterState into page.tsx

**Files:**
- Modify: `web/src/app/page.tsx`

This is the largest task. Replace all `useState` filter state with the `useFilterState` hook, remove "Hide closed" logic, and wire up the new defaults.

- [ ] **Step 1: Replace useState declarations with useFilterState**

At the top of the component, replace all the filter `useState` calls (lines 41-51, 159-161) with:

```typescript
import { useFilterState } from '@/hooks/useFilterState';
import { passesDefaultFilter, isPostedWithin } from '@/lib/filter-defaults';
import { getUnifiedStatus } from '@/lib/status-helpers';

// Inside the component:
const [filters, filterActions] = useFilterState();
```

- [ ] **Step 2: Update filter logic to use URL state**

Replace the `filtered` useMemo (lines 79-119) to use `filters` from the hook. The key changes:

1. Status filtering: if `filters.statuses` is empty (no URL param), use `passesDefaultFilter()`. If statuses are specified in URL, filter to those exact statuses.
2. Remove `hideClosed` logic entirely.
3. Add `postedWithin` filtering using `isPostedWithin()`.
4. All other filters read from `filters.states`, `filters.dioceses`, etc.

```typescript
const filtered = useMemo(() => {
  let result = positions;

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
    result = searchPositions(searchIndex, filters.query);
    // Re-apply other filters on search results
    // (search returns from full set, need to intersect)
    const resultIds = new Set(result.map(p => p.id));
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
      const canonical = p.position_types || [];
      return canonical.some(t => filters.types.includes(t)) ||
        filters.types.includes(p.position_type);
    });
  }
  if (filters.compensationRanges.length > 0) {
    result = result.filter(p => {
      const range = getCompensationRange(p);
      return range ? filters.compensationRanges.includes(range) : false;
    });
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
      const housing = categorizeHousing(p);
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
}, [positions, filters, searchIndex]);
```

- [ ] **Step 3: Update status chips to use URL state**

Replace the status chip rendering to:
1. Pre-select Active/Developing/Interim chips when no status params are in URL
2. Toggle chips by updating URL params via `filterActions.setStatuses()`
3. Remove the "Hide closed" interaction from the Closed chip

```typescript
const activeChips = filters.statuses.length === 0
  ? ['Active', 'Developing', 'Interim']  // visual default
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
```

- [ ] **Step 4: Wire up Filters component with new props**

Replace the `<Filters>` usage:

```tsx
<Filters
  filters={filterConfigs}
  onClear={filterActions.clearAll}
  postedWithin={filters.postedWithin}
  onPostedWithinChange={filterActions.setPostedWithin}
/>
```

Update `filterConfigs` to use `filterActions` setters instead of `useState` setters.

- [ ] **Step 5: Wire up view toggle and expanded state**

Replace viewMode state with `filters.view` and `filterActions.setView()`:

```tsx
<button onClick={() => filterActions.setView('table')} ...>Table</button>
<button onClick={() => filterActions.setView('map')} ...>Map</button>
```

Pass `filters.expandedId` and `filterActions.setExpandedId` to PositionTable:

```tsx
<PositionTable
  positions={sorted}
  meData={meData}
  initialSortField={filters.sort.field}
  initialSortDir={filters.sort.direction}
  initialExpandedId={filters.expandedId}
  onExpandedChange={filterActions.setExpandedId}
/>
```

- [ ] **Step 6: Wrap page in Suspense for useSearchParams**

Next.js requires `useSearchParams()` to be wrapped in `<Suspense>`. Extract the page content into an inner component:

```tsx
import { Suspense } from 'react';

export default function PositionsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400">Loading...</div>}>
      <PositionsPageContent />
    </Suspense>
  );
}

function PositionsPageContent() {
  // All existing page logic goes here
  const [filters, filterActions] = useFilterState();
  // ...
}
```

- [ ] **Step 7: Build and verify**

Run: `cd web && npx next build`
Expected: Build succeeds. All filters work via URL params.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/page.tsx
git commit -m "feat: integrate useFilterState, smart defaults, remove Hide Closed"
```

---

### Task 9: Enhance MapView with rich info cards

**Files:**
- Modify: `web/src/components/MapView.tsx`

- [ ] **Step 1: Update popup HTML to rich info card**

Replace the popup template (around lines 85-93) with a richer card:

```typescript
function buildPopupHtml(pos: Position): string {
  const church = pos.church_infos?.[0];
  const name = church?.name || pos.name || 'Unknown';
  const city = church?.city || pos.city || '';
  const st = church?.state || pos.state || '';
  const type = pos.position_types?.join(', ') || pos.position_type || '';
  const status = pos.visibility === 'public' ? 'Active' : 'Unlisted';
  const statusColor = status === 'Active'
    ? 'background:#dcfce7;color:#15803d'
    : 'background:#dbeafe;color:#1d4ed8';

  // ASA
  const firstParochial = pos.parochials?.[0];
  let asaStr = '';
  if (firstParochial?.years) {
    const years = Object.keys(firstParochial.years).sort();
    const latest = years.length > 0 ? firstParochial.years[years[years.length - 1]] : null;
    if (latest?.averageAttendance != null) {
      asaStr = `ASA: ${latest.averageAttendance}`;
    }
  }

  // Comp
  const compStr = pos.estimated_total_comp
    ? `Comp: $${Math.round(pos.estimated_total_comp / 1000)}k`
    : '';

  const statsLine = [asaStr, compStr].filter(Boolean).join('    ');

  return `
    <div style="min-width:220px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.4">
      <div style="font-weight:600;font-size:14px;margin-bottom:2px">${name}</div>
      <div style="color:#6b7280;margin-bottom:4px">${type}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:11px;font-weight:500;${statusColor}">${status}</span>
        <span style="color:#6b7280;font-size:12px">${city}${st ? ', ' + st : ''}</span>
      </div>
      ${statsLine ? `<div style="color:#374151;margin-bottom:8px">${statsLine}</div>` : ''}
      <button onclick="window.__vhNavigate && window.__vhNavigate('${pos.id}')"
        style="display:block;width:100%;padding:6px 0;background:#1e40af;color:white;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer">
        View full details
      </button>
    </div>
  `;
}
```

- [ ] **Step 2: Add navigation callback and props**

Update the MapView props and add the navigation handler:

```typescript
interface MapViewProps {
  positions: Position[];
  onNavigateToPosition?: (id: string) => void;
}

export default function MapView({ positions, onNavigateToPosition }: MapViewProps) {
  // Expose navigation function for popup button
  useEffect(() => {
    (window as Record<string, unknown>).__vhNavigate = (id: string) => {
      onNavigateToPosition?.(id);
    };
    return () => {
      delete (window as Record<string, unknown>).__vhNavigate;
    };
  }, [onNavigateToPosition]);

  // ... rest of component
```

- [ ] **Step 3: Fit bounds to filtered positions**

Replace the static continental US bounds (around lines 40-43) with dynamic bounds fitting:

```typescript
// After adding markers, fit to their bounds
if (mappable.length > 0) {
  const bounds = L.latLngBounds(mappable.map(p => [p.church_infos![0].lat!, p.church_infos![0].lng!]));
  mapRef.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
} else {
  // Fallback to continental US
  mapRef.current.fitBounds([[24.5, -125], [49.5, -66.5]]);
}
```

- [ ] **Step 4: Wire up navigation in page.tsx**

In `page.tsx`, pass the navigation handler to MapView:

```tsx
<MapView
  positions={sorted}
  onNavigateToPosition={(id) => {
    filterActions.setView('table');
    filterActions.setExpandedId(id);
  }}
/>
```

- [ ] **Step 5: Commit**

```bash
git add web/src/components/MapView.tsx web/src/app/page.tsx
git commit -m "feat: rich map pin cards with View Full Details navigation"
```

---

### Task 10: Update About page with data sources

**Files:**
- Modify: `web/src/app/about/page.tsx`

- [ ] **Step 1: Add Data Sources section and update content**

Add a new "Where the Data Comes From" section after the "How it works" section. Update the "How it works" text. Update status labels (replace any "Directory" with "Unlisted").

Add the data sources section:

```tsx
{/* Data Sources */}
<section className="mb-12">
  <h2 className="text-xl font-semibold text-gray-900 mb-4">Where the Data Comes From</h2>
  <p className="text-gray-600 mb-4">
    Vocation Hub+ collects data from multiple Episcopal Church sources and combines them into a single enriched view
    that no single source provides on its own.
  </p>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <DataSourceCard
      name="VocationHub"
      url="https://vocationhub.episcopalchurch.org"
      description="Position listings, profile fields, search status, contact information"
    />
    <DataSourceCard
      name="Episcopal Asset Map"
      url="https://www.episcopalassetmap.org"
      description="Church directory: addresses, phone, email, geographic coordinates"
    />
    <DataSourceCard
      name="ECDPlus"
      url="https://www.ecdplus.org"
      description="Extended church directory cross-reference"
    />
    <DataSourceCard
      name="Parochial Reports"
      url="https://www.episcopalchurch.org/research-and-statistics/"
      description="Annual congregation data: attendance, giving, membership (2015-2024)"
    />
    <DataSourceCard
      name="Church Pension Group"
      url="https://www.cpg.org"
      description="Clergy compensation benchmarks by diocese, position type, church size"
    />
    <DataSourceCard
      name="US Census Bureau (ACS)"
      url="https://www.census.gov/programs-surveys/acs"
      description="Median household income and population by zip code"
    />
  </div>
</section>
```

Add the DataSourceCard component at the bottom of the file:

```tsx
function DataSourceCard({ name, url, description }: { name: string; url: string; description: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="text-primary-600 font-medium hover:underline">
        {name}
      </a>
      <p className="text-sm text-gray-600 mt-1">{description}</p>
    </div>
  );
}
```

Update the "How it works" text:

```tsx
<p className="text-gray-600">
  We collect position data from VocationHub daily, then enrich each listing with church directory
  information, parochial report history, compensation benchmarks, and census demographics. The result
  is a unified view that no single source provides on its own.
</p>
```

Update the stats section to use "Unlisted" instead of any "Directory" label.

- [ ] **Step 2: Commit**

```bash
git add web/src/app/about/page.tsx
git commit -m "feat: add data sources section and update About page content"
```

---

### Task 11: Build verification and integration testing

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
1. Page loads with smart defaults (Active/Developing/Interim + qualifying Unlisted shown)
2. Status chips show correct counts and toggle correctly
3. URL updates when filters change
4. Copying URL and opening in new tab reproduces the filtered view
5. "Posted" dropdown filters by date range
6. Sort by "Last Updated" and "First Seen" work
7. Date column adapts to current sort
8. Map pins show rich info cards
9. "View full details" on map switches to table with position expanded
10. About page shows data sources
11. "Unlisted" appears everywhere (not "Directory Only")

- [ ] **Step 3: Fix any issues found**

Address build errors, runtime errors, or visual issues.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix: integration fixes for Phase 3 navigation and filtering"
```
