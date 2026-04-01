# Multi-Congregation Position Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support positions serving 2+ churches by matching all constituent parishes, storing results as arrays, and rendering them side-by-side in the frontend.

**Architecture:** The enrichment script gets a new `matchPositionToParishes()` orchestrator that splits position names and matches each part independently. The data model switches from singular `church_info`/`parish_context`/`parochial` fields to always-array versions. All frontend consumers are updated to read from arrays.

**Tech Stack:** Node.js (enrichment script), TypeScript/React/Next.js (frontend), Tailwind CSS

---

### Task 1: Fix /claim page 404

**Files:**
- Modify: `web/src/components/IdentityLink.tsx:22`

- [ ] **Step 1: Fix trailing slash**

In `web/src/components/IdentityLink.tsx`, line 22, change:

```typescript
return <Link href="/claim" className={defaultClass}>This is me</Link>;
```

to:

```typescript
return <Link href="/claim/" className={defaultClass}>This is me</Link>;
```

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/IdentityLink.tsx
git commit -m "fix: add trailing slash to /claim link for static export"
```

---

### Task 2: Update types.ts -- array data model

**Files:**
- Modify: `web/src/lib/types.ts`

- [ ] **Step 1: Extract ChurchInfo interface and add array fields**

In `web/src/lib/types.ts`, replace the inline `church_info` type (lines 62-74) with a named interface and switch to arrays. Apply these changes:

First, add the `ChurchInfo` interface after the `Position` interface closing brace and before the `PositionChange` interface (after line 144). Also add `ParochialData`:

```typescript
export interface ChurchInfo {
  nid?: number;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  website: string;
  type: string;
  lat: number | null;
  lng: number | null;
}

export interface ParochialData {
  congregationCity: string;
  years: Record<string, {
    averageAttendance: number | null;
    plateAndPledge: number | null;
    membership: number | null;
  }>;
}
```

Then in the `Position` interface, replace the singular fields:

Replace the `church_info` block (lines 62-74):
```typescript
  // OLD:
  church_info?: {
    name: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    email: string;
    website: string;
    type: string;
    lat: number | null;
    lng: number | null;
  };
```

with:

```typescript
  // Enriched church data (from church directory cross-reference)
  // Always an array: single-parish = [one], multi-parish = [one, two, ...]
  church_infos?: ChurchInfo[];
```

Replace the `parochial` block (lines 133-140):
```typescript
  // OLD:
  parochial?: {
    congregationCity: string;
    years: Record<string, {
      averageAttendance: number | null;
      plateAndPledge: number | null;
      membership: number | null;
    }>;
  };
```

with:

```typescript
  // Parochial report data (parallel with church_infos)
  parochials?: ParochialData[];
```

Replace the `parish_context` field (line 143):
```typescript
  // OLD:
  parish_context?: ParishContext;
```

with:

```typescript
  // Neutral parish context (parallel with church_infos)
  parish_contexts?: ParishContext[];
```

- [ ] **Step 2: Verify the build catches all consumers**

Run: `cd web && npx tsc --noEmit 2>&1 | head -60`
Expected: TypeScript errors in every file that references the old singular field names. This confirms we have a complete list of consumers to update.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/types.ts
git commit -m "refactor: switch church_info/parish_context/parochial to always-array types"
```

---

### Task 3: Update data.ts -- data loading layer

**Files:**
- Modify: `web/src/lib/data.ts:96,119,147,149`

- [ ] **Step 1: Update field references**

In `web/src/lib/data.ts`, update all references from singular to array fields.

Line 96 -- change `pos.church_info` to `pos.church_infos?.[0]`:
```typescript
state: pos.state || pos.church_infos?.[0]?.state || getStateForDiocese(pos.diocese || ''),
```

Line 119 -- change `e.church_info` to `e.church_infos`:
```typescript
const state = (e.state as string) || (e.church_infos as Position['church_infos'])?.[0]?.state || getStateForDiocese(diocese);
```

Line 147 -- change `church_info` to `church_infos`:
```typescript
church_infos: e.church_infos as Position['church_infos'],
```

Line 149 -- change `parochial` to `parochials`:
```typescript
parochials: e.parochials as Position['parochials'],
```

- [ ] **Step 2: Verify no TypeScript errors in data.ts**

Run: `cd web && npx tsc --noEmit 2>&1 | grep data.ts`
Expected: No errors from `data.ts`.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/data.ts
git commit -m "refactor: update data.ts to use array field names"
```

---

### Task 4: Update PositionTable.tsx -- helper functions and collapsed row

**Files:**
- Modify: `web/src/components/PositionTable.tsx:28,34,39,79-96`

- [ ] **Step 1: Update getChurchName to join multiple names**

Replace the `getChurchName` function (lines 27-30):

```typescript
/** Get the display name for a position: prefer church_infos names, fall back to pos.name */
function getChurchName(pos: Position): { text: string; isEnriched: boolean } {
  if (pos.church_infos && pos.church_infos.length > 0) {
    const names = pos.church_infos.map(c => c.name).filter(Boolean);
    if (names.length > 0) return { text: names.join(' & '), isEnriched: true };
  }
  return { text: pos.name, isEnriched: false };
}
```

- [ ] **Step 2: Update getCity to join distinct cities**

Replace the `getCity` function (lines 33-35):

```typescript
/** Get the city for a position: prefer church_infos cities, fall back to pos.city */
function getCity(pos: Position): string {
  if (pos.church_infos && pos.church_infos.length > 0) {
    const cities = [...new Set(pos.church_infos.map(c => c.city).filter(Boolean))];
    if (cities.length > 0) return cities.join(' & ');
  }
  return pos.city || '';
}
```

- [ ] **Step 3: Update getState to use first church_infos entry**

Replace the `getState` function (lines 38-40):

```typescript
/** Get the state for a position: prefer church_infos state, fall back to pos.state */
function getState(pos: Position): string {
  return pos.church_infos?.[0]?.state || pos.state || '';
}
```

- [ ] **Step 4: Update getLatestAsa to use first parochials entry**

Replace the `getLatestAsa` function (lines 78-96):

```typescript
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
```

- [ ] **Step 5: Verify build**

Run: `cd web && npx tsc --noEmit 2>&1 | grep PositionTable`
Expected: Remaining errors only in ExpandedDetail (church_info, parish_context, parochial references in the expanded view -- Task 5).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/PositionTable.tsx
git commit -m "refactor: update PositionTable helpers for array fields"
```

---

### Task 5: Update PositionTable.tsx -- ExpandedDetail component

**Files:**
- Modify: `web/src/components/PositionTable.tsx:526-760`

- [ ] **Step 1: Update hasParochial check**

In the `ExpandedDetail` function, line 531, change:

```typescript
const hasParochial = !!pos.parochial && Object.keys(pos.parochial.years).length > 0;
```

to:

```typescript
const hasParochial = pos.parochials?.some(p => Object.keys(p.years).length > 0) ?? false;
```

- [ ] **Step 2: Update parish_context references to use ParishContextSection with arrays**

Replace the two `parish_context` blocks. The one in the no-deep-data branch (around line 572-574):

```typescript
{pos.parish_context && (
  <ParishContextSection context={pos.parish_context} />
)}
```

becomes:

```typescript
{pos.parish_contexts && pos.parish_contexts.length > 0 && (
  <ParishContextSection
    contexts={pos.parish_contexts}
    churchNames={pos.church_infos?.map(c => c.name)}
  />
)}
```

And the one in the deep-data branch (around line 606-608), same replacement:

```typescript
{pos.parish_contexts && pos.parish_contexts.length > 0 && (
  <ParishContextSection
    contexts={pos.parish_contexts}
    churchNames={pos.church_infos?.map(c => c.name)}
  />
)}
```

- [ ] **Step 3: Update ParochialTrends references**

Replace the two `ParochialTrends` usages. The one around line 586:

```typescript
{hasParochial && <ParochialTrends data={pos.parochial!} />}
```

becomes:

```typescript
{hasParochial && pos.parochials!.map((p, i) => (
  <ParochialTrends
    key={i}
    data={p}
    label={pos.parochials!.length > 1 ? pos.church_infos?.[i]?.name : undefined}
  />
))}
```

Same for the one around line 685:

```typescript
{hasParochial && <ParochialTrends data={pos.parochial!} />}
```

becomes:

```typescript
{hasParochial && pos.parochials!.map((p, i) => (
  <ParochialTrends
    key={i}
    data={p}
    label={pos.parochials!.length > 1 ? pos.church_infos?.[i]?.name : undefined}
  />
))}
```

- [ ] **Step 4: Update church_info directory section**

Replace the church directory block (around lines 707-731). Change from single church_info to iterating church_infos:

```typescript
{pos.church_infos && pos.church_infos.length > 0 && (
  <div className={pos.church_infos.length > 1
    ? "grid grid-cols-1 sm:grid-cols-2 gap-3"
    : ""
  }>
    {pos.church_infos.map((church, i) => (
      <div key={i} className="border border-gray-200 rounded-lg p-3 bg-white text-sm">
        <div className="font-medium text-gray-700 mb-2">
          {pos.church_infos!.length > 1
            ? `${church.name || `Church ${i + 1}`}`
            : 'Church Directory'}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {church.street && (
            <div>
              <span className="text-gray-500">Address</span>
              <p className="text-gray-900">{church.street}, {church.city}, {church.state} {church.zip}</p>
            </div>
          )}
          {church.phone && (
            <div>
              <span className="text-gray-500">Phone</span>
              <p className="text-gray-900">{church.phone}</p>
            </div>
          )}
          {church.email && (
            <div>
              <span className="text-gray-500">Email</span>
              <p className="text-gray-900">{church.email}</p>
            </div>
          )}
        </div>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 5: Update website link**

Around line 746, change:

```typescript
{(pos.website_url || pos.church_info?.website) && (
```

to:

```typescript
{(pos.website_url || pos.church_infos?.[0]?.website) && (
```

And around line 749, change:

```typescript
const url = pos.website_url || pos.church_info?.website || '';
```

to:

```typescript
const url = pos.website_url || pos.church_infos?.[0]?.website || '';
```

- [ ] **Step 6: Add multi-congregation header**

At the top of the ExpandedDetail return (both branches), after `<DioceseContext pos={pos} />`, add:

```typescript
{pos.church_infos && pos.church_infos.length > 1 && (
  <p className="text-sm text-gray-600 font-medium">
    This position serves {pos.church_infos.length} congregations
  </p>
)}
```

- [ ] **Step 7: Verify build**

Run: `cd web && npx tsc --noEmit 2>&1 | grep PositionTable`
Expected: No errors from PositionTable.tsx.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/PositionTable.tsx
git commit -m "refactor: update ExpandedDetail for multi-parish arrays"
```

---

### Task 6: Update ParishContextSection.tsx -- multi-parish grid

**Files:**
- Modify: `web/src/components/ParishContextSection.tsx`

- [ ] **Step 1: Rewrite component for array support**

Replace the entire file content of `web/src/components/ParishContextSection.tsx`:

```typescript
'use client';

import type { ParishContext } from '@/lib/types';

interface Props {
  contexts: ParishContext[];
  churchNames?: string[];
}

function formatDollarCompact(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return `$${value}`;
}

function trendLine(label: string, trend: string | null, changePct: number | null): string | null {
  if (!trend || changePct == null) return null;
  const sign = changePct > 0 ? '+' : '';
  return `${label}: ${trend} (${sign}${changePct.toFixed(1)}%)`;
}

function SingleParishContext({ context, name }: { context: ParishContext; name?: string }) {
  const lines: string[] = [];

  if (context.clergy_count_10yr > 0) {
    const tenurePart = context.avg_tenure_years != null
      ? ` (avg tenure: ${context.avg_tenure_years} years)`
      : '';
    lines.push(`${context.clergy_count_10yr} clergy in the past 10 years${tenurePart}`);
  }

  const attLine = trendLine('Average Sunday Attendance', context.attendance_trend, context.attendance_change_pct);
  if (attLine) lines.push(attLine);

  const givLine = trendLine('Plate & Pledge', context.giving_trend, context.giving_change_pct);
  if (givLine) lines.push(givLine);

  const memLine = trendLine('Membership', context.membership_trend, context.membership_change_pct);
  if (memLine) lines.push(memLine);

  if (context.latest_operating_revenue) {
    lines.push(`Latest operating revenue: ${formatDollarCompact(context.latest_operating_revenue)}`);
  }

  if (lines.length === 0) return null;

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      {name && <div className="text-xs font-semibold text-gray-500 mb-1">{name}</div>}
      <h4 className="text-sm font-semibold text-gray-700 mb-2">Parish Context</h4>
      <ul className="text-sm text-gray-600 space-y-1">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {context.years_of_data > 0 && (
        <p className="text-xs text-gray-400 mt-2">Based on {context.years_of_data} years of parochial report data</p>
      )}
    </div>
  );
}

export default function ParishContextSection({ contexts, churchNames }: Props) {
  const rendered = contexts.map((ctx, i) => (
    <SingleParishContext
      key={i}
      context={ctx}
      name={contexts.length > 1 ? churchNames?.[i] : undefined}
    />
  )).filter(Boolean);

  if (rendered.length === 0) return null;

  if (rendered.length === 1) return <>{rendered[0]}</>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {rendered}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd web && npx tsc --noEmit 2>&1 | grep ParishContext`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ParishContextSection.tsx
git commit -m "refactor: ParishContextSection accepts array of contexts with grid layout"
```

---

### Task 7: Update ParochialTrends.tsx -- add optional label prop

**Files:**
- Modify: `web/src/components/ParochialTrends.tsx:9-14,43-48`

- [ ] **Step 1: Add label prop**

In `web/src/components/ParochialTrends.tsx`, update the props interface (lines 9-14):

```typescript
interface ParochialTrendsProps {
  data: {
    congregationCity: string;
    years: Record<string, YearData>;
  };
  label?: string;
}
```

Update the component signature (line 20):

```typescript
export default function ParochialTrends({ data, label }: ParochialTrendsProps) {
```

Update the header section (lines 42-48) to show the label when provided:

```typescript
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-sm font-semibold text-gray-700">
          {label ? `Parochial Report: ${label}` : 'Parochial Report Data'}
        </h4>
        <span className="text-xs text-gray-400">
          {data.congregationCity} | {years[0]}-{years[years.length - 1]}
        </span>
      </div>
```

- [ ] **Step 2: Verify build**

Run: `cd web && npx tsc --noEmit 2>&1 | grep ParochialTrends`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ParochialTrends.tsx
git commit -m "refactor: add label prop to ParochialTrends for multi-parish display"
```

---

### Task 8: Update remaining frontend consumers

**Files:**
- Modify: `web/src/components/MapView.tsx:33,74-77`
- Modify: `web/src/components/ComparisonModal.tsx:13,17,21,52-86,164-177`
- Modify: `web/src/components/ComparisonBar.tsx:24`
- Modify: `web/src/lib/personal-context.ts:159,181-198,202`

- [ ] **Step 1: Update MapView.tsx**

Line 33, change:
```typescript
(p) => p.church_info?.lat != null && p.church_info?.lng != null
```
to:
```typescript
(p) => p.church_infos?.[0]?.lat != null && p.church_infos?.[0]?.lng != null
```

Lines 74-77, change all `p.church_info` to `p.church_infos?.[0]`:
```typescript
const lat = p.church_infos![0].lat!;
const lng = p.church_infos![0].lng!;
const churchName = p.church_infos?.[0]?.name || p.name;
const cityState = [p.church_infos?.[0]?.city, p.church_infos?.[0]?.state]
```

- [ ] **Step 2: Update ComparisonModal.tsx**

Line 13, change:
```typescript
return pos.church_info?.name || pos.name;
```
to:
```typescript
return pos.church_infos?.[0]?.name || pos.name;
```

Line 17, change:
```typescript
return pos.church_info?.city || pos.city || '';
```
to:
```typescript
return pos.church_infos?.[0]?.city || pos.city || '';
```

Line 21, change:
```typescript
return pos.church_info?.state || pos.state || '';
```
to:
```typescript
return pos.church_infos?.[0]?.state || pos.state || '';
```

Lines 52-53, change:
```typescript
if (!pos.parochial) return null;
const years = Object.keys(pos.parochial.years).sort();
```
to:
```typescript
if (!pos.parochials?.[0]) return null;
const years = Object.keys(pos.parochials[0].years).sort();
```

Lines 58-62, change:
```typescript
if (!pos.parochial) return null;
const years = Object.keys(pos.parochial.years).sort();
```
to:
```typescript
if (!pos.parochials?.[0]) return null;
const years = Object.keys(pos.parochials[0].years).sort();
```

And line 62:
```typescript
.map(y => pos.parochial!.years[y].averageAttendance)
```
to:
```typescript
.map(y => pos.parochials![0].years[y].averageAttendance)
```

Lines 81-86, change all `pos.parochial` to `pos.parochials?.[0]` and `pos.parochial!` to `pos.parochials![0]`:
```typescript
if (!pos.parochials?.[0] || Object.keys(pos.parochials[0].years).length === 0) return '';
  const sorted = Object.keys(pos.parochials![0].years).sort();
```
and:
```typescript
.map(y => pos.parochials![0].years[y][metric])
```

Lines 164-177, same pattern -- change all `pos.parochial` to `pos.parochials?.[0]` and `pos.parochial!` to `pos.parochials![0]`.

- [ ] **Step 3: Update ComparisonBar.tsx**

Line 24, change:
```typescript
const name = pos.church_info?.name || pos.name;
```
to:
```typescript
const name = pos.church_infos?.[0]?.name || pos.name;
```

- [ ] **Step 4: Update personal-context.ts**

Line 159, change:
```typescript
const posChurch = position.church_info;
```
to:
```typescript
const posChurch = position.church_infos?.[0];
```

Lines 181-183, change:
```typescript
plate_pledge_comparison: (cp?.plate_pledge != null && position.parochial?.years)
  ? (() => {
      const years = Object.values(position.parochial!.years);
```
to:
```typescript
plate_pledge_comparison: (cp?.plate_pledge != null && position.parochials?.[0]?.years)
  ? (() => {
      const years = Object.values(position.parochials![0].years);
```

Lines 190-192, same pattern:
```typescript
membership_comparison: (cp?.membership != null && position.parochials?.[0]?.years)
  ? (() => {
      const years = Object.values(position.parochials![0].years);
```

Line 202, change:
```typescript
distance_km: computeDistanceKm(cp?.lat, cp?.lng, posChurch?.lat, posChurch?.lng),
```
No change needed -- `posChurch` already updated in step 4.

- [ ] **Step 5: Verify full build**

Run: `cd web && npx tsc --noEmit`
Expected: Zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/MapView.tsx web/src/components/ComparisonModal.tsx web/src/components/ComparisonBar.tsx web/src/lib/personal-context.ts
git commit -m "refactor: update all remaining consumers for array field names"
```

---

### Task 9: Add matchPositionToParishes() to enrichment script

**Files:**
- Modify: `web/scripts/enrich-positions-v2.js` (after `matchPositionToParish` function, around line 277)

- [ ] **Step 1: Add the new orchestrator function**

Insert after the closing `}` of `matchPositionToParish` (after line 277) and before `attachCompensation`:

```javascript
/**
 * Multi-parish matching orchestrator.
 * Splits position names on \n and " and ", matches each part independently,
 * and returns the set that produces the most matches.
 *
 * @param {object} position - { name, diocese, website_url, contact_email, contact_phone }
 * @returns {Array<{ parish, confidence, method }>} Array of match results (may be empty)
 */
function matchPositionToParishes(position) {
  // Try unsplit match first
  const unsplitMatch = matchPositionToParish(position);
  const unsplitResults = unsplitMatch ? [unsplitMatch] : [];

  // Split name into candidate parts
  const rawName = (position.name || '').replace(/,\s*Diocese of.*/i, '');
  let parts = rawName.split(/\n/).map(s => s.trim()).filter(Boolean);

  // Further split each part on " and " (but not if part looks like "Saints X and Y")
  const expandedParts = [];
  for (const part of parts) {
    // Skip splitting if it looks like a saint name: "Saints X and Y" or "SS. X and Y"
    if (/^(saints?|ss\.?)\s/i.test(part)) {
      expandedParts.push(part);
    } else {
      const subParts = part.split(/\s+and\s+/i).map(s => s.trim()).filter(Boolean);
      expandedParts.push(...subParts);
    }
  }

  // If we only got 1 part (no splitting happened), return the unsplit result
  if (expandedParts.length <= 1) {
    return unsplitResults;
  }

  // Match each part independently
  const splitResults = [];
  const seenParishIds = new Set();

  for (const part of expandedParts) {
    const syntheticPosition = {
      name: part,
      diocese: position.diocese,
      website_url: '', // Only use contact info for unsplit match
      contact_email: '',
      contact_phone: '',
    };

    const match = matchPositionToParish(syntheticPosition);
    if (match && !seenParishIds.has(match.parish.id)) {
      seenParishIds.add(match.parish.id);
      splitResults.push(match);
    }
  }

  // Use split results if they produced more distinct matches
  if (splitResults.length > unsplitResults.length) {
    console.log(`  Multi-parish split: "${position.name}" -> ${splitResults.length} matches (was ${unsplitResults.length})`);
    return splitResults;
  }

  return unsplitResults;
}
```

- [ ] **Step 2: Export the new function**

In the `module.exports` block (around line 1397), add `matchPositionToParishes`:

```javascript
module.exports = {
  matchPositionToParish,
  matchPositionToParishes,
```

- [ ] **Step 3: Commit**

```bash
git add web/scripts/enrich-positions-v2.js
git commit -m "feat: add matchPositionToParishes() multi-parish orchestrator"
```

---

### Task 10: Update enrichment pipeline to use arrays

**Files:**
- Modify: `web/scripts/enrich-positions-v2.js` (enrichPositions function, lines 1063-1121 for public, lines 1155-1291 for extended)

- [ ] **Step 1: Update public position enrichment**

Replace the matching block in the public positions loop (lines 1063-1122). Change from:

```javascript
    // Match position to parish via DB
    const matchResult = matchPositionToParish({
      name: pos.name,
      diocese: pos.diocese,
      website_url: pos.website_url || '',
      contact_email: pos.contact_email || '',
      contact_phone: pos.contact_phone || '',
    });

    if (matchResult) {
      // For duplicate VH IDs, cross-validate the church name
      // Skip this check for city-based matches (multi-congregation positions)
      let nameMatch = true;
      const isCityMatch = matchResult.method && /city|town|word/.test(matchResult.method);
      if (!isCityMatch && vhIdCounts[vhId] > 1 && pos.name && matchResult.parish) {
        const posNorm = normalizeChurchName(pos.name);
        const churchNorm = normalizeChurchName(matchResult.parish.name);
        if (posNorm && churchNorm) {
          const posWords = posNorm.split(/\s+/).filter(w => w.length >= 3);
          const churchWords = churchNorm.split(/\s+/).filter(w => w.length >= 3);
          const genericWords = new Set(['church', 'episcopal', 'parish', 'chapel', 'cathedral', 'mission', 'memorial']);
          const posKey = posWords.filter(w => !genericWords.has(w));
          const churchKey = churchWords.filter(w => !genericWords.has(w));
          if (posKey.length > 0 && churchKey.length > 0 && !posKey.some(w => churchKey.includes(w))) {
            nameMatch = false;
          }
        }
      }

      if (nameMatch) {
        churchMatches++;
        pos.church_info = buildChurchInfo(matchResult.parish);
        pos.match_confidence = matchResult.confidence;

        // Get parochial data: try by NID-based name, or by parish name + city
        const parishNameWithCity = matchResult.parish.city
          ? `${matchResult.parish.name} (${matchResult.parish.city})`
          : matchResult.parish.name;
        const parochial = getParochialByName(parishNameWithCity)
          || getParochialByName(matchResult.parish.name)
          || getParochialFromDb(matchResult.parish.nid);
        if (parochial) {
          parochialMatches++;
          pos.parochial = parochial;
        }

        // Attach compensation from DB
        const enriched = attachCompensation(pos);
        if (enriched.compensation) pos.compensation = enriched.compensation;

        // Attach clergy info from DB
        const clergyInfo = attachClergyInfo(matchResult.parish.id);
        if (clergyInfo.current_clergy || clergyInfo.parish_clergy_history.recent_count > 0) {
          pos.clergy = clergyInfo;
        }

        // Attach parish context
        pos.parish_context = computeParishContext(matchResult.parish.id);
      }
    }
```

to:

```javascript
    // Match position to parish(es) via DB
    const matchResults = matchPositionToParishes({
      name: pos.name,
      diocese: pos.diocese,
      website_url: pos.website_url || '',
      contact_email: pos.contact_email || '',
      contact_phone: pos.contact_phone || '',
    });

    if (matchResults.length > 0) {
      // For duplicate VH IDs, cross-validate the church name (only for single matches)
      let nameMatch = true;
      if (matchResults.length === 1) {
        const matchResult = matchResults[0];
        const isCityMatch = matchResult.method && /city|town|word/.test(matchResult.method);
        if (!isCityMatch && vhIdCounts[vhId] > 1 && pos.name && matchResult.parish) {
          const posNorm = normalizeChurchName(pos.name);
          const churchNorm = normalizeChurchName(matchResult.parish.name);
          if (posNorm && churchNorm) {
            const posWords = posNorm.split(/\s+/).filter(w => w.length >= 3);
            const churchWords = churchNorm.split(/\s+/).filter(w => w.length >= 3);
            const genericWords = new Set(['church', 'episcopal', 'parish', 'chapel', 'cathedral', 'mission', 'memorial']);
            const posKey = posWords.filter(w => !genericWords.has(w));
            const churchKey = churchWords.filter(w => !genericWords.has(w));
            if (posKey.length > 0 && churchKey.length > 0 && !posKey.some(w => churchKey.includes(w))) {
              nameMatch = false;
            }
          }
        }
      }

      if (nameMatch) {
        churchMatches++;
        pos.church_infos = matchResults.map(r => buildChurchInfo(r.parish));
        pos.match_confidence = matchResults[0].confidence;

        // Get parochial data for each matched parish
        const parochials = [];
        for (const r of matchResults) {
          const parishNameWithCity = r.parish.city
            ? `${r.parish.name} (${r.parish.city})`
            : r.parish.name;
          const parochial = getParochialByName(parishNameWithCity)
            || getParochialByName(r.parish.name)
            || getParochialFromDb(r.parish.nid);
          if (parochial) parochials.push(parochial);
        }
        if (parochials.length > 0) {
          parochialMatches++;
          pos.parochials = parochials;
        }

        // Attach compensation from DB (position-level, not per-parish)
        const enriched = attachCompensation(pos);
        if (enriched.compensation) pos.compensation = enriched.compensation;

        // Attach clergy info from first matched parish
        const clergyInfo = attachClergyInfo(matchResults[0].parish.id);
        if (clergyInfo.current_clergy || clergyInfo.parish_clergy_history.recent_count > 0) {
          pos.clergy = clergyInfo;
        }

        // Attach parish context for each matched parish
        pos.parish_contexts = matchResults.map(r => computeParishContext(r.parish.id));
      }
    }
```

- [ ] **Step 2: Update extended position enrichment**

In the extended positions loop, replace the matching block (around lines 1155-1291). Change the single-match pattern to multi-match. Replace from:

```javascript
      // Try matching via DB
      let matchResult = matchPositionToParish({
```

through:

```javascript
        // Attach parish context
        extPos.parish_context = computeParishContext(matchResult.parish.id);
      }
```

with:

```javascript
      // Try matching via DB
      const matchResults = matchPositionToParishes({
        name: profile.congregation || '',
        diocese: profile.diocese || '',
        website_url: profile.website || '',
        contact_email: '',
        contact_phone: '',
      });

      const matchResult = matchResults.length > 0 ? matchResults[0] : null;

      // Backfill diocese from church_info if profile has none
      let diocese = profile.diocese || '';
      if (diocese && /^https?:\/\/|\.org|\.com|\.net|\.edu/i.test(diocese)) diocese = '';
      if (!diocese && matchResult && matchResult.parish) {
        diocese = matchResult.parish.diocese || '';
      }

      // Apply manual overrides
      const override = dioceseOverrides[String(vhId)];
      if (override) {
        if (!diocese && override.diocese) diocese = override.diocese;
      }

      // Build church data from matches
      let churchInfos = null;
      let parochials = null;
      let parishContexts = null;
      let matchConfidence = null;

      if (matchResults.length > 0) {
        churchInfos = matchResults.map(r => buildChurchInfo(r.parish));
        matchConfidence = matchResults[0].confidence;

        const parochialList = [];
        for (const r of matchResults) {
          const parishNameWithCity = r.parish.city
            ? `${r.parish.name} (${r.parish.city})`
            : r.parish.name;
          const parochial = getParochialByName(parishNameWithCity)
            || getParochialByName(r.parish.name)
            || getParochialFromDb(r.parish.nid);
          if (parochial) parochialList.push(parochial);
        }
        if (parochialList.length > 0) parochials = parochialList;
        parishContexts = matchResults.map(r => computeParishContext(r.parish.id));
      }
```

- [ ] **Step 3: Update the extPos object construction**

In the extended positions `extPos` object (around line 1255), change the field names:

```javascript
        church_infos: churchInfos || undefined,
        match_confidence: matchConfidence || undefined,
        parochials: parochials || undefined,
```

And update the clergy/parish_context attachment block after the extPos construction:

```javascript
      // Attach clergy info from first matched parish
      if (matchResult && matchResult.parish) {
        const clergyInfo = attachClergyInfo(matchResult.parish.id);
        if (clergyInfo.current_clergy || clergyInfo.parish_clergy_history.recent_count > 0) {
          extPos.clergy = clergyInfo;
        }
      }

      // Attach parish contexts
      if (parishContexts) {
        extPos.parish_contexts = parishContexts;
      }
```

- [ ] **Step 4: Update computeSimilarPositions references**

In `computeSimilarPositions` (around lines 596-614), change `pos.parochial` to `pos.parochials?.[0]`:

```javascript
    if (pos.parochials && pos.parochials[0]) {
      const yearKeys = Object.keys(pos.parochials[0].years).sort();
      if (yearKeys.length > 0) {
        const latest = pos.parochials[0].years[yearKeys[yearKeys.length - 1]];
```

And change `pos.church_info` to `pos.church_infos?.[0]`:

```javascript
    const state = (pos.church_infos && pos.church_infos[0] && pos.church_infos[0].state) || pos.state || '';
    const positionType = pos.position_type || '';
    const housingType = (pos.housing_type || '').toLowerCase();
    const name = (pos.church_infos && pos.church_infos[0] && pos.church_infos[0].name) || pos.name || '';
    const city = (pos.church_infos && pos.church_infos[0] && pos.church_infos[0].city) || pos.city || '';
```

- [ ] **Step 5: Update attachCensusData references**

In `attachCensusData` (around line 684), change:

```javascript
const rawZip = (pos.church_info && pos.church_info.zip) || pos.postal_code || '';
```

to:

```javascript
const rawZip = (pos.church_infos && pos.church_infos[0] && pos.church_infos[0].zip) || pos.postal_code || '';
```

- [ ] **Step 6: Update gap report references**

In the gap report (around lines 1339, 1356), change:

```javascript
if (pos.vh_id && !pos.church_info) {
```
to:
```javascript
if (pos.vh_id && (!pos.church_infos || pos.church_infos.length === 0)) {
```

And:
```javascript
if (!ext.church_info && ext.vh_id) {
```
to:
```javascript
if ((!ext.church_infos || ext.church_infos.length === 0) && ext.vh_id) {
```

- [ ] **Step 7: Run enrichment script to verify**

Run: `cd web && node scripts/enrich-positions-v2.js`
Expected: Script completes. Look for "Multi-parish split:" log lines confirming multi-parish matching is working. Check that church match count is the same or higher.

- [ ] **Step 8: Commit**

```bash
git add web/scripts/enrich-positions-v2.js
git commit -m "feat: enrichment pipeline outputs array fields for multi-parish support"
```

---

### Task 11: Build and verify

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `cd web && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Verify enriched data structure**

Run:
```bash
cd web && node -e "
const d = require('./public/data/enriched-positions.json');
const mp = d.filter(p => p.church_infos && p.church_infos.length > 1);
console.log('Multi-parish positions:', mp.length);
mp.forEach(p => console.log('  ', p.name, '->', p.church_infos.length, 'churches'));
const sp = d.filter(p => p.church_infos && p.church_infos.length === 1);
console.log('Single-parish positions:', sp.length);
const none = d.filter(p => !p.church_infos);
console.log('Unmatched positions:', none.length);
"
```
Expected: Multi-parish positions > 0 (at least the 3 CongregationMP ones). Single-parish should be the majority.

- [ ] **Step 3: Verify extended data**

Run:
```bash
cd web && node -e "
const d = require('./public/data/enriched-extended.json');
const mp = d.filter(p => p.church_infos && p.church_infos.length > 1);
console.log('Extended multi-parish:', mp.length);
mp.forEach(p => console.log('  ', p.name, '->', p.church_infos.length, 'churches'));
"
```
Expected: Some of the 10 newline-separated positions now have multiple matches.

- [ ] **Step 4: Commit all generated data**

```bash
git add web/public/data/enriched-positions.json web/public/data/enriched-extended.json web/public/data/position-church-map.json web/public/data/needs-backfill.json
git commit -m "data: regenerate enriched data with multi-parish support"
```

---

### Task 12: Check admin page for church_info references

**Files:**
- Modify: `web/src/app/admin/page.tsx:746` (if needed)

- [ ] **Step 1: Check admin page references**

Run: `cd web && grep -n 'church_info\|parish_context\b\|\.parochial\b' src/app/admin/page.tsx`

If there are references to the old singular field names, update them to the array form (using `[0]` for display, same pattern as other consumers).

- [ ] **Step 2: Verify build**

Run: `cd web && npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 3: Commit if changes were made**

```bash
git add web/src/app/admin/page.tsx
git commit -m "refactor: update admin page for array field names"
```
