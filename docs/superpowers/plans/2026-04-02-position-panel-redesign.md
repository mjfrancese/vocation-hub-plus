# Position Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic ExpandedDetail component with an integrated, tabbed detail panel that synthesizes data from all sources into a priest-focused experience.

**Architecture:** The panel is decomposed into a sticky header (church name, metadata, church selector, tab bar) and four tab content components. Data transformation happens in pure helper modules (`narrative-helpers.ts`, `cpg-mapping.ts`). Pipeline changes expand similar positions to 15 with match reasons, and add CPG position-type mapping to compensation lookups.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, better-sqlite3 (pipeline), static JSON (frontend)

---

## File Structure

```
web/scripts/stages/
  find-similar.js              -- MODIFY: 15 candidates + match_reasons
  compute-compensation.js      -- MODIFY: CPG position-type lookup

web/src/lib/
  types.ts                     -- MODIFY: match_reasons on similar_positions, cpg_position_type
  cpg-mapping.ts               -- CREATE: canonical type -> CPG category mapping
  narrative-helpers.ts          -- CREATE: derived value computation for narratives

web/src/components/
  detail-panel/
    DetailPanel.tsx             -- CREATE: main container (sticky header + tab content)
    DetailHeader.tsx            -- CREATE: church name, type pills, status, metadata, links
    ChurchSelector.tsx          -- CREATE: multi-church pill selector
    DetailTabs.tsx              -- CREATE: generic tab bar + content switching
    tabs/
      OverviewTab.tsx           -- CREATE: integrated narrative view
      ParishDataTab.tsx         -- CREATE: raw parochial data + diocese ranking
      CompensationTab.tsx       -- CREATE: comp + benefits + CPG benchmarks
      ProfileTab.tsx            -- CREATE: raw VH fields in key-value layout
  PositionTable.tsx             -- MODIFY: replace ExpandedDetail with DetailPanel
```

---

### Task 1: Update Similar Positions Pipeline (15 candidates + match_reasons)

**Files:**
- Modify: `web/scripts/stages/find-similar.js`

- [ ] **Step 1: Update the output structure to include match_reasons**

In `web/scripts/stages/find-similar.js`, replace the scored.push block (lines 110-120) and the slice (line 126) with match_reasons tracking and 15-candidate output:

```javascript
      if (score >= 3) {
        scored.push({
          id: b.id,
          vh_id: b.vh_id,
          name: b.name,
          city: b.city,
          state: b.state,
          position_type: b.positionType,
          asa: b.asa,
          estimated_total_comp: b.comp,
          score,
          match_reasons: {
            asa: a.asa != null && b.asa != null && (b.asa / a.asa) >= 0.75 && (b.asa / a.asa) <= 1.25,
            comp: a.comp != null && b.comp != null && (b.comp / a.comp) >= 0.8 && (b.comp / a.comp) <= 1.2,
            state: !!(a.state && b.state && a.state === b.state),
            type: (a.positionTypes.length > 0 && b.positionTypes.length > 0 && a.positionTypes.some(t => b.positionTypes.includes(t)))
                  || !!(a.positionType && b.positionType && a.positionType === b.positionType),
            housing: !!(a.housingType && b.housingType && a.housingType === b.housingType),
          },
        });
      }
```

And change the slice from 5 to 15:

```javascript
      a.pos.similar_positions = scored.slice(0, 15);
```

Also update the JSDoc comment at the top of the file (lines 1-10) to say "up to 15" instead of "up to 5" and mention match_reasons in the Attaches section:

```javascript
/**
 * Enrichment Stage: Find Similar Positions
 *
 * For each position, finds up to 15 most similar other positions based on
 * congregational size (ASA), compensation, state, position type, and housing type.
 *
 * ...
 *
 * Attaches:
 *   position.similar_positions = [
 *     { id, vh_id, name, city, state, position_type, asa, estimated_total_comp, score, match_reasons },
 *     ...
 *   ]
 */
```

- [ ] **Step 2: Verify the pipeline runs**

Run:
```bash
cd web && node -e "const fn = require('./scripts/stages/find-similar'); console.log(typeof fn)"
```
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add web/scripts/stages/find-similar.js
git commit -m "feat: expand similar positions to 15 candidates with match_reasons"
```

---

### Task 2: Add CPG Position-Type Mapping to Compensation Pipeline

**Files:**
- Modify: `web/scripts/stages/compute-compensation.js`

- [ ] **Step 1: Add CPG_TYPE_MAP and position-type lookup**

Add the CPG mapping constant and a lookup function after the existing `lookupDioceseComp` function (after line 52):

```javascript
/**
 * Map canonical position types to CPG compensation categories.
 * CPG reports use: Senior Rector, Solo Rector, Assistant, Specialty Minister, Parish Deacon.
 */
const CPG_TYPE_MAP = {
  'Rector': (asa) => asa >= 400 ? 'Senior Rector' : 'Solo Rector',
  'Vicar': () => 'Solo Rector',
  'Priest-in-Charge': () => 'Solo Rector',
  'Assistant': () => 'Assistant',
  'Associate': () => 'Assistant',
  'Curate': () => 'Assistant',
  'Senior Associate': () => 'Assistant',
  'Deacon': () => 'Parish Deacon',
};

/**
 * Look up position-type-specific compensation from CPG data.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} diocese
 * @param {string} cpgType - CPG position type (e.g., 'Solo Rector')
 * @returns {object|null} { median, count, year, position_type } or null
 */
function lookupPositionTypeComp(db, diocese, cpgType) {
  if (!diocese || !cpgType) return null;
  try {
    const row = db.prepare(`
      SELECT median, count, year, position_type
      FROM compensation_by_position
      WHERE LOWER(diocese) = LOWER(?)
        AND position_type = ?
        AND gender = 'all'
      ORDER BY year DESC LIMIT 1
    `).get(diocese, cpgType);
    return row ?? null;
  } catch {
    // Table may not exist yet
    return null;
  }
}

/**
 * Determine the CPG position type for a position based on its canonical types and ASA.
 *
 * @param {string[]} positionTypes - canonical position types array
 * @param {number|null} asa - average Sunday attendance
 * @returns {string|null} CPG position type or null if no mapping
 */
function getCpgPositionType(positionTypes, asa) {
  if (!Array.isArray(positionTypes)) return null;
  for (const pt of positionTypes) {
    const mapper = CPG_TYPE_MAP[pt];
    if (mapper) return mapper(asa);
  }
  return null;
}
```

- [ ] **Step 2: Add CPG lookup to Pass 1 (diocese benchmark)**

Replace the Pass 1 loop (lines 80-91) to also look up position-type-specific compensation and store the CPG position type:

```javascript
  // ------------------------------------------------------------------
  // Pass 1: diocese benchmark lookup + CPG position-type mapping
  // ------------------------------------------------------------------
  for (const pos of positions) {
    const comp = lookupDioceseComp(db, pos.diocese || '');
    if (comp) {
      pos.compensation = {
        diocese_median: comp.all_median,
        diocese_female_median: comp.female_median,
        diocese_male_median: comp.male_median,
        diocese_clergy_count: comp.all_count,
        year: comp.year,
      };
    }

    // CPG position-type mapping
    const positionTypes = pos.position_types || [];
    let asa = null;
    const firstParochial = pos.parochials && pos.parochials[0];
    if (firstParochial && firstParochial.years) {
      const yearKeys = Object.keys(firstParochial.years).sort();
      if (yearKeys.length > 0) {
        const latest = firstParochial.years[yearKeys[yearKeys.length - 1]];
        if (latest && latest.averageAttendance != null) asa = latest.averageAttendance;
      }
    }

    const cpgType = getCpgPositionType(positionTypes, asa);
    if (cpgType) {
      pos.cpg_position_type = cpgType;
      const ptComp = lookupPositionTypeComp(db, pos.diocese || '', cpgType);
      if (ptComp) {
        pos.compensation = pos.compensation || {};
        pos.compensation.position_type_median = ptComp.median;
        pos.compensation.position_type_count = ptComp.count;
        pos.compensation.position_type_label = cpgType;
      }
    }
  }
```

- [ ] **Step 3: Export getCpgPositionType for testing**

At the bottom of the file, update the exports:

```javascript
module.exports = computeCompensation;

// Also export internals for testing
module.exports.parseStipend = parseStipend;
module.exports.lookupDioceseComp = lookupDioceseComp;
module.exports.getCpgPositionType = getCpgPositionType;
module.exports.lookupPositionTypeComp = lookupPositionTypeComp;
```

- [ ] **Step 4: Verify the module loads**

Run:
```bash
cd web && node -e "const fn = require('./scripts/stages/compute-compensation'); console.log(typeof fn.getCpgPositionType)"
```
Expected: `function`

- [ ] **Step 5: Verify getCpgPositionType mapping logic**

Run:
```bash
cd web && node -e "
  const { getCpgPositionType } = require('./scripts/stages/compute-compensation');
  console.log(getCpgPositionType(['Rector'], 100));       // Solo Rector
  console.log(getCpgPositionType(['Rector'], 500));       // Senior Rector
  console.log(getCpgPositionType(['Assistant'], null));    // Assistant
  console.log(getCpgPositionType(['Vicar'], null));        // Solo Rector
  console.log(getCpgPositionType(['Deacon'], null));       // Parish Deacon
  console.log(getCpgPositionType(['Interim'], null));      // null
  console.log(getCpgPositionType(['Canon'], null));        // null
"
```
Expected:
```
Solo Rector
Senior Rector
Assistant
Solo Rector
Parish Deacon
null
null
```

- [ ] **Step 6: Commit**

```bash
git add web/scripts/stages/compute-compensation.js
git commit -m "feat: add CPG position-type mapping to compensation pipeline"
```

---

### Task 3: Update TypeScript Types

**Files:**
- Modify: `web/src/lib/types.ts`

- [ ] **Step 1: Add match_reasons to similar_positions type**

In `web/src/lib/types.ts`, replace the `similar_positions` type (lines 111-121):

```typescript
  // Similar positions (computed at build time)
  similar_positions?: Array<{
    id: string;
    vh_id?: number;
    name: string;
    city: string;
    state: string;
    position_type: string;
    asa?: number;
    estimated_total_comp?: number;
    score: number;
    match_reasons?: {
      asa: boolean;
      comp: boolean;
      state: boolean;
      type: boolean;
      housing: boolean;
    };
  }>;
```

- [ ] **Step 2: Add cpg_position_type and position-type compensation fields**

Add `cpg_position_type` to the Position interface (after the `compensation` block, around line 91):

```typescript
  // CPG position type mapping (e.g., 'Solo Rector', 'Assistant')
  cpg_position_type?: string;
```

Extend the `compensation` interface to include position-type fields (add after `year: number` on line 90):

```typescript
  compensation?: {
    diocese_median: number;
    diocese_female_median: number;
    diocese_male_median: number;
    diocese_clergy_count: number;
    year: number;
    position_type_median?: number;
    position_type_count?: number;
    position_type_label?: string;
  };
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/types.ts
git commit -m "feat: add match_reasons and CPG position type to Position interface"
```

---

### Task 4: Create CPG Mapping Module (Frontend)

**Files:**
- Create: `web/src/lib/cpg-mapping.ts`

- [ ] **Step 1: Create the CPG mapping module**

```typescript
/**
 * CPG (Church Pension Group) position-type mapping for frontend display.
 *
 * Maps canonical position types to CPG compensation categories.
 * Mirrors the pipeline logic in web/scripts/stages/compute-compensation.js.
 */

const CPG_TYPE_MAP: Record<string, (asa: number | null) => string> = {
  'Rector': (asa) => (asa != null && asa >= 400) ? 'Senior Rector' : 'Solo Rector',
  'Vicar': () => 'Solo Rector',
  'Priest-in-Charge': () => 'Solo Rector',
  'Assistant': () => 'Assistant',
  'Associate': () => 'Assistant',
  'Curate': () => 'Assistant',
  'Senior Associate': () => 'Assistant',
  'Deacon': () => 'Parish Deacon',
};

/**
 * Get the CPG position type for display purposes.
 * Returns null if no mapping exists (position falls back to diocese-wide median).
 */
export function getCpgDisplayType(positionTypes: string[], asa: number | null): string | null {
  for (const pt of positionTypes) {
    const mapper = CPG_TYPE_MAP[pt];
    if (mapper) return mapper(asa);
  }
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/cpg-mapping.ts
git commit -m "feat: add frontend CPG position-type mapping module"
```

---

### Task 5: Create Narrative Helpers Module

**Files:**
- Create: `web/src/lib/narrative-helpers.ts`

- [ ] **Step 1: Create the narrative helpers module**

```typescript
/**
 * Narrative helpers for the Overview tab.
 *
 * Pure functions that transform raw position data into display-ready strings.
 * The Overview tab calls these helpers -- it does not contain data
 * transformation logic itself.
 */

import { Position } from './types';

// ---------------------------------------------------------------------------
// Parochial data extraction
// ---------------------------------------------------------------------------

interface ParochialMetrics {
  latestAsa: number | null;
  latestAsaYear: string | null;
  latestPlatePledge: number | null;
  latestPlatePledgeYear: string | null;
  latestMembership: number | null;
  latestMembershipYear: string | null;
  asaTrend: TrendResult | null;
  givingTrend: TrendResult | null;
  membershipTrend: TrendResult | null;
  givingPerAttendee: number | null;
  yearRange: string | null;
}

interface TrendResult {
  pct: number;
  direction: 'up' | 'down' | 'flat';
  startYear: string;
  endYear: string;
  startValue: number;
  endValue: number;
}

/**
 * Extract all parochial metrics for the first (or selected) church.
 * Finds the latest year with data for each metric independently,
 * so membership can come from 2023 even if ASA is from 2024.
 */
export function extractParochialMetrics(pos: Position, churchIndex = 0): ParochialMetrics {
  const empty: ParochialMetrics = {
    latestAsa: null, latestAsaYear: null,
    latestPlatePledge: null, latestPlatePledgeYear: null,
    latestMembership: null, latestMembershipYear: null,
    asaTrend: null, givingTrend: null, membershipTrend: null,
    givingPerAttendee: null, yearRange: null,
  };

  const parochial = pos.parochials?.[churchIndex];
  if (!parochial) return empty;

  const years = Object.keys(parochial.years).sort();
  if (years.length === 0) return empty;

  // Find latest non-null value for each metric
  for (let i = years.length - 1; i >= 0; i--) {
    const d = parochial.years[years[i]];
    if (empty.latestAsa === null && d.averageAttendance != null && d.averageAttendance > 0) {
      empty.latestAsa = d.averageAttendance;
      empty.latestAsaYear = years[i];
    }
    if (empty.latestPlatePledge === null && d.plateAndPledge != null && d.plateAndPledge > 0) {
      empty.latestPlatePledge = d.plateAndPledge;
      empty.latestPlatePledgeYear = years[i];
    }
    if (empty.latestMembership === null && d.membership != null && d.membership > 0) {
      empty.latestMembership = d.membership;
      empty.latestMembershipYear = years[i];
    }
  }

  empty.asaTrend = computeTrend(years, y => parochial.years[y]?.averageAttendance);
  empty.givingTrend = computeTrend(years, y => parochial.years[y]?.plateAndPledge);
  empty.membershipTrend = computeTrend(years, y => parochial.years[y]?.membership);

  if (empty.latestAsa && empty.latestPlatePledge) {
    empty.givingPerAttendee = Math.round(empty.latestPlatePledge / empty.latestAsa);
  }

  empty.yearRange = years.length > 1 ? `${years[0]}-${years[years.length - 1]}` : years[0];

  return empty;
}

// ---------------------------------------------------------------------------
// Trend computation
// ---------------------------------------------------------------------------

function computeTrend(
  years: string[],
  getValue: (year: string) => number | null | undefined,
): TrendResult | null {
  let earliest: { value: number; year: string } | null = null;
  let latest: { value: number; year: string } | null = null;

  for (const y of years) {
    const v = getValue(y);
    if (v != null && v > 0) {
      if (!earliest) earliest = { value: v, year: y };
      latest = { value: v, year: y };
    }
  }

  if (!earliest || !latest || earliest.year === latest.year || earliest.value === 0) return null;

  const pct = ((latest.value - earliest.value) / earliest.value) * 100;
  const direction = pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat';
  return {
    pct,
    direction,
    startYear: earliest.year,
    endYear: latest.year,
    startValue: earliest.value,
    endValue: latest.value,
  };
}

// ---------------------------------------------------------------------------
// Display-ready string formatters
// ---------------------------------------------------------------------------

/**
 * "up 13% over 2014-2024" or "down 8% over 2018-2024" or "stable over 2014-2024"
 */
export function trendDescription(trend: TrendResult | null): string {
  if (!trend) return '';
  const period = `${trend.startYear}-${trend.endYear}`;
  if (trend.direction === 'flat') return `stable over ${period}`;
  const verb = trend.direction === 'up' ? 'up' : 'down';
  return `${verb} ${Math.abs(Math.round(trend.pct))}% over ${period}`;
}

/**
 * Trend CSS class: green for up, red for down, gray for flat/null.
 */
export function trendColorClass(trend: TrendResult | null): string {
  if (!trend || trend.direction === 'flat') return 'text-gray-500';
  return trend.direction === 'up' ? 'text-green-600' : 'text-red-600';
}

/**
 * "Annual plate & pledge / ASA" with the computed value.
 */
export function givingPerAttendeeDescription(givingPerAttendee: number | null): string {
  if (givingPerAttendee == null) return '';
  return `$${givingPerAttendee.toLocaleString()} per attendee`;
}

/**
 * "Stipend is 1.2x the area median household income"
 */
export function compToLocalIncomeRatio(totalComp: number | undefined, censusMedianIncome: number | undefined): string {
  if (!totalComp || !censusMedianIncome) return '';
  const ratio = (totalComp / censusMedianIncome).toFixed(1);
  return `Compensation is ${ratio}x the area median household income`;
}

/**
 * "larger than 67% of parishes in the diocese" or "42nd percentile in the diocese"
 */
export function diocesePercentileDescription(percentile: number | undefined, metric: string): string {
  if (percentile == null) return '';
  return `${metric} is larger than ${percentile}% of parishes in the diocese`;
}

/**
 * Format a dollar value compactly: $85k or $1.2M
 */
export function formatDollar(value: number | null | undefined): string {
  if (value == null) return '--';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value.toLocaleString()}`;
}

/**
 * Format a dollar value with full precision: $85,000
 */
export function formatDollarFull(value: number | null | undefined): string {
  if (value == null) return '--';
  return `$${value.toLocaleString()}`;
}

/**
 * Determine if a position is interim based on its position types or work type.
 */
export function isInterimPosition(pos: Position): boolean {
  const types = pos.position_types || [];
  if (types.includes('Interim') || types.includes('Supply')) return true;
  const pt = (pos.position_type || '').toLowerCase();
  return pt.includes('interim') || pt.includes('supply');
}

/**
 * Get the deep scrape field value by label keyword.
 * Skips gibberish values (same logic as existing findField).
 */
export function findField(fields: Array<{ label: string; value: string }>, ...keywords: string[]): string {
  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    const match = fields.find(f =>
      f.label.toLowerCase().includes(lower) && f.value && f.value.length < 5000
    );
    if (match?.value) return match.value;
  }
  return '';
}

/**
 * Compute time on market from receiving_names_from or first_seen.
 */
export function timeOnMarket(pos: Position): string {
  const now = new Date();
  const parseDate = (s: string): Date | null => {
    if (!s) return null;
    const first = s.split(/\s+(?:to|-)\s*/)[0].trim();
    const mdy = first.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
    const d = new Date(first);
    return isNaN(d.getTime()) ? null : d;
  };

  const firstSeen = parseDate(pos.first_seen);
  const usable = firstSeen && (now.getTime() - firstSeen.getTime()) > 86400000 ? firstSeen : null;
  const seen = usable || parseDate(pos.receiving_names_from);
  if (!seen) return '';

  const days = Math.floor((now.getTime() - seen.getTime()) / (1000 * 60 * 60 * 24));
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
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/narrative-helpers.ts
git commit -m "feat: add narrative helpers for position panel overview tab"
```

---

### Task 6: Create DetailTabs Component

**Files:**
- Create: `web/src/components/detail-panel/DetailTabs.tsx`

- [ ] **Step 1: Create the generic tab bar component**

```typescript
'use client';

import { useState, type ReactNode } from 'react';

export interface TabConfig {
  id: string;
  label: string;
  content: ReactNode;
}

interface DetailTabsProps {
  tabs: TabConfig[];
  defaultTab?: string;
}

/**
 * Generic tab bar + content area.
 * Adding a tab = adding a TabConfig entry. The tab bar and content switching
 * are handled here; each tab's content is rendered by its parent.
 */
export default function DetailTabs({ tabs, defaultTab }: DetailTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id || '');

  const active = tabs.find(t => t.id === activeTab) || tabs[0];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={(e) => { e.stopPropagation(); setActiveTab(tab.id); }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab.id === active?.id
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="pt-4">
        {active?.content}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/detail-panel/DetailTabs.tsx
git commit -m "feat: add generic DetailTabs component"
```

---

### Task 7: Create DetailHeader Component

**Files:**
- Create: `web/src/components/detail-panel/DetailHeader.tsx`

- [ ] **Step 1: Create the header component**

```typescript
'use client';

import { Position } from '@/lib/types';
import UnifiedStatusBadge from '../UnifiedStatusBadge';
import { isInterimPosition, timeOnMarket } from '@/lib/narrative-helpers';

interface DetailHeaderProps {
  pos: Position;
}

/**
 * Position header: church name, canonical type pills, status badge,
 * location, date line, and external links.
 */
export default function DetailHeader({ pos }: DetailHeaderProps) {
  const churchName = pos.church_infos?.[0]?.name || pos.name;
  const multiNames = pos.church_infos && pos.church_infos.length > 1
    ? pos.church_infos.map(c => c.name).filter(Boolean)
    : null;
  const displayName = multiNames && multiNames.length > 1
    ? multiNames.join(' & ')
    : churchName;

  const city = pos.church_infos?.[0]?.city || pos.city || '';
  const state = pos.church_infos?.[0]?.state || pos.state || '';
  const location = [city, state].filter(Boolean).join(', ');

  const canonicalTypes = pos.position_types || [];
  const isInterim = isInterimPosition(pos);
  const market = timeOnMarket(pos);

  // Parse receiving dates for display
  const receivingFrom = pos.receiving_names_from
    ? pos.receiving_names_from.split(' to ')[0].split(' - ')[0].trim()
    : '';
  const receivingTo = pos.receiving_names_to || '';
  const endLabel = receivingTo ? receivingTo : 'Open ended';

  const websiteUrl = pos.website_url || pos.church_infos?.[0]?.website || '';
  const normalizedUrl = websiteUrl && !websiteUrl.startsWith('http') ? `https://${websiteUrl}` : websiteUrl;

  return (
    <div className="space-y-1.5">
      {/* Row 1: Church name + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 leading-tight">{displayName}</h2>
        </div>
        <div className="flex-shrink-0">
          <UnifiedStatusBadge vhStatus={pos.vh_status || pos.status} visibility={pos.visibility} />
        </div>
      </div>

      {/* Row 2: Type pills + work type + location + diocese */}
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {canonicalTypes.map(t => (
          <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
            {t}
          </span>
        ))}
        {isInterim && (
          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
            Interim
          </span>
        )}
        {location && (
          <span className="text-gray-500 text-xs">{location}</span>
        )}
        {pos.diocese && (
          <span className="text-gray-400 text-xs">
            {location ? ' \u00B7 ' : ''}{pos.diocese}
          </span>
        )}
      </div>

      {/* Row 3: Date line */}
      {receivingFrom && (
        <div className="text-xs text-gray-500">
          Receiving names since {receivingFrom}
          {' | '}{endLabel}
          {market && <> | Posted {market}</>}
        </div>
      )}

      {/* Row 4: External links */}
      <div className="flex gap-3 text-xs">
        {pos.profile_url && (
          <a
            href={pos.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline"
            onClick={(e) => e.stopPropagation()}
          >
            VocationHub
          </a>
        )}
        {normalizedUrl && (
          <a
            href={normalizedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline"
            onClick={(e) => e.stopPropagation()}
          >
            Church website
          </a>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/detail-panel/DetailHeader.tsx
git commit -m "feat: add DetailHeader component with type pills and metadata"
```

---

### Task 8: Create ChurchSelector Component

**Files:**
- Create: `web/src/components/detail-panel/ChurchSelector.tsx`

- [ ] **Step 1: Create the church selector component**

```typescript
'use client';

import type { ChurchInfo } from '@/lib/types';

interface ChurchSelectorProps {
  churches: ChurchInfo[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/**
 * Multi-church pill selector. Only renders when position serves
 * multiple congregations. Filters parish-specific data throughout all tabs.
 */
export default function ChurchSelector({ churches, selectedIndex, onSelect }: ChurchSelectorProps) {
  if (churches.length <= 1) return null;

  return (
    <div className="flex items-center gap-2 py-2">
      <span className="text-xs text-gray-500 font-medium flex-shrink-0">
        Serving {churches.length} congregations
      </span>
      <div className="flex flex-wrap gap-1.5">
        {churches.map((church, i) => {
          const label = [church.name, church.city].filter(Boolean).join(', ') || `Church ${i + 1}`;
          return (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); onSelect(i); }}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                i === selectedIndex
                  ? 'bg-gray-700 text-white border-gray-700'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/detail-panel/ChurchSelector.tsx
git commit -m "feat: add ChurchSelector for multi-congregation positions"
```

---

### Task 9: Create ProfileTab Component

**Files:**
- Create: `web/src/components/detail-panel/tabs/ProfileTab.tsx`

- [ ] **Step 1: Create the Profile tab (raw VH fields)**

```typescript
'use client';

import { Position } from '@/lib/types';
import { findField } from '@/lib/narrative-helpers';

interface ProfileTabProps {
  pos: Position;
}

// Field groups with the labels to search for and display names
const FIELD_GROUPS: Array<{
  title: string;
  fields: Array<{ display: string; keywords: string[] }>;
}> = [
  {
    title: 'Position Details',
    fields: [
      { display: 'Position Type', keywords: ['Position Type', 'Type'] },
      { display: 'Diocese', keywords: ['Diocese'] },
      { display: 'Congregation', keywords: ['Congregation', 'Community Name'] },
      { display: 'Position Title/Role', keywords: ['Position Title', 'Role'] },
      { display: 'Type of Work', keywords: ['Full Time', 'Part Time', 'Full-Time'] },
      { display: 'Orders Required', keywords: ['Order', 'Ministry'] },
      { display: 'Current Status', keywords: ['Status'] },
      { display: 'Avg Sunday Attendance', keywords: ['Average Sunday', 'Attendance', 'ASA'] },
      { display: 'Annual Budget', keywords: ['Annual Budget', 'Budget'] },
    ],
  },
  {
    title: 'Description',
    fields: [
      { display: 'Position Description', keywords: ['hopes for this position', 'qualities', 'Description'] },
    ],
  },
  {
    title: 'How to Apply',
    fields: [
      { display: 'Application Instructions', keywords: ['How to Apply', 'Application', 'Submit'] },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { display: 'Contact Name', keywords: ['Contact Name', 'Contact Person'] },
      { display: 'Title', keywords: ['Contact Title'] },
      { display: 'Organization', keywords: ['Organization', 'Contact Organization'] },
      { display: 'Email', keywords: ['Contact Email', 'Email'] },
      { display: 'Phone', keywords: ['Contact Phone', 'Phone'] },
    ],
  },
  {
    title: 'Benefits & Leave',
    fields: [
      { display: 'Compensation Range', keywords: ['Range', 'Stipend', 'Compensation', 'Salary'] },
      { display: 'Housing', keywords: ['Housing'] },
      { display: 'Pension', keywords: ['Pension'] },
      { display: 'Healthcare', keywords: ['Healthcare'] },
      { display: 'Vacation', keywords: ['Vacation'] },
      { display: 'Continuing Education', keywords: ['Continuing Education', 'Education'] },
      { display: 'Travel/Auto', keywords: ['Reimbursement', 'Travel', 'Auto'] },
    ],
  },
  {
    title: 'Dates',
    fields: [
      { display: 'Receiving Names From', keywords: ['Receiving Names'] },
      { display: 'Receiving Names To', keywords: ['Receiving Names To', 'End Date'] },
    ],
  },
];

/**
 * Profile tab: all raw VocationHub deep scrape fields organized into
 * logical groups with a two-column key-value layout.
 */
export default function ProfileTab({ pos }: ProfileTabProps) {
  const fields = pos.deep_scrape_fields || [];

  if (fields.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-6 text-center">
        <p>No detailed profile data available.</p>
        {pos.profile_url && (
          <a
            href={pos.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline mt-1 inline-block"
            onClick={(e) => e.stopPropagation()}
          >
            View on VocationHub for full listing
          </a>
        )}
      </div>
    );
  }

  // Church directory info from enrichment
  const churchInfos = pos.church_infos || [];

  return (
    <div className="space-y-6">
      {FIELD_GROUPS.map(group => {
        const rows = group.fields
          .map(f => ({ label: f.display, value: findField(fields, ...f.keywords) }))
          .filter(r => r.value);

        if (rows.length === 0) return null;

        return (
          <div key={group.title}>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              {group.title}
            </h3>
            <div className="space-y-0">
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 py-1.5 border-b border-gray-100 text-sm">
                  <div className="text-gray-500">{row.label}</div>
                  <div className="col-span-2 text-gray-900 whitespace-pre-line">
                    {isUrl(row.value) ? (
                      <a
                        href={row.value.startsWith('http') ? row.value : `https://${row.value}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-600 underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.value}
                      </a>
                    ) : (
                      row.value.length > 500 ? row.value.substring(0, 500) + '...' : row.value
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Church Directory section */}
      {churchInfos.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Church Directory
          </h3>
          {churchInfos.map((church, i) => (
            <div key={i} className="space-y-0 mb-3">
              {churchInfos.length > 1 && (
                <div className="text-sm font-medium text-gray-700 mb-1">{church.name}</div>
              )}
              {[
                { label: 'Address', value: [church.street, church.city, church.state, church.zip].filter(Boolean).join(', ') },
                { label: 'Phone', value: church.phone },
                { label: 'Email', value: church.email },
                { label: 'Website', value: church.website },
              ].filter(r => r.value).map((row, j) => (
                <div key={j} className="grid grid-cols-3 gap-2 py-1.5 border-b border-gray-100 text-sm">
                  <div className="text-gray-500">{row.label}</div>
                  <div className="col-span-2 text-gray-900">
                    {row.label === 'Website' || row.label === 'Email' ? (
                      <a
                        href={row.label === 'Email' ? `mailto:${row.value}` : (row.value.startsWith('http') ? row.value : `https://${row.value}`)}
                        target={row.label === 'Email' ? undefined : '_blank'}
                        rel="noopener noreferrer"
                        className="text-primary-600 underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.value.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                      </a>
                    ) : row.value}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function isUrl(value: string): boolean {
  return /^https?:\/\//.test(value) || /^www\./.test(value);
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/detail-panel/tabs/ProfileTab.tsx
git commit -m "feat: add ProfileTab with organized key-value field display"
```

---

### Task 10: Create ParishDataTab Component

**Files:**
- Create: `web/src/components/detail-panel/tabs/ParishDataTab.tsx`

- [ ] **Step 1: Create the Parish Data tab**

```typescript
'use client';

import { Position } from '@/lib/types';
import {
  extractParochialMetrics,
  trendDescription,
  trendColorClass,
  formatDollarFull,
} from '@/lib/narrative-helpers';

interface ParishDataTabProps {
  pos: Position;
  churchIndex: number;
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

/**
 * Parish Data tab: raw parochial data for data-oriented users.
 * Shows summary metrics, diocese ranking, and yearly breakdown table.
 */
export default function ParishDataTab({ pos, churchIndex }: ParishDataTabProps) {
  const parochial = pos.parochials?.[churchIndex];
  if (!parochial || Object.keys(parochial.years).length === 0) {
    return (
      <div className="text-sm text-gray-500 py-6 text-center">
        No parochial report data available for this position.
      </div>
    );
  }

  const metrics = extractParochialMetrics(pos, churchIndex);
  const dp = pos.diocese_percentiles;
  const years = Object.keys(parochial.years).sort().reverse();

  return (
    <div className="space-y-6">
      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Avg Sunday Attendance"
          value={metrics.latestAsa != null ? String(metrics.latestAsa) : null}
          year={metrics.latestAsaYear}
          trend={metrics.asaTrend}
        />
        <MetricCard
          label="Membership"
          value={metrics.latestMembership != null ? metrics.latestMembership.toLocaleString() : null}
          year={metrics.latestMembershipYear}
          trend={metrics.membershipTrend}
        />
        <MetricCard
          label="Plate & Pledge"
          value={metrics.latestPlatePledge != null ? formatDollarFull(metrics.latestPlatePledge) : null}
          year={metrics.latestPlatePledgeYear}
          trend={metrics.givingTrend}
        />
      </div>

      {/* Diocese Ranking */}
      {dp && (dp.asa != null || dp.plate_pledge != null || dp.membership != null) && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Diocese Ranking
          </h3>
          <div className="flex flex-wrap gap-4 text-sm text-gray-700">
            {dp.asa != null && (
              <span>
                Attendance: <span className="font-semibold text-primary-900">{dp.asa}{ordinalSuffix(dp.asa)} percentile</span>
              </span>
            )}
            {dp.plate_pledge != null && (
              <span>
                Giving: <span className="font-semibold text-primary-900">{dp.plate_pledge}{ordinalSuffix(dp.plate_pledge)} percentile</span>
              </span>
            )}
            {dp.membership != null && (
              <span>
                Membership: <span className="font-semibold text-primary-900">{dp.membership}{ordinalSuffix(dp.membership)} percentile</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Yearly Breakdown Table */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Yearly Breakdown
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-200">
                <th className="text-left py-2 pr-4 font-medium">Year</th>
                <th className="text-right py-2 px-4 font-medium">ASA</th>
                <th className="text-right py-2 px-4 font-medium">Members</th>
                <th className="text-right py-2 px-4 font-medium">Plate & Pledge</th>
              </tr>
            </thead>
            <tbody>
              {years.map(year => {
                const d = parochial.years[year];
                return (
                  <tr key={year} className="border-b border-gray-100">
                    <td className="py-1.5 pr-4 font-medium text-gray-700">{year}</td>
                    <td className="text-right py-1.5 px-4">
                      {d?.averageAttendance != null ? d.averageAttendance : <span className="text-gray-400">--</span>}
                    </td>
                    <td className="text-right py-1.5 px-4">
                      {d?.membership != null ? d.membership.toLocaleString() : <span className="text-gray-400">--</span>}
                    </td>
                    <td className="text-right py-1.5 px-4">
                      {d?.plateAndPledge != null ? `$${d.plateAndPledge.toLocaleString()}` : <span className="text-gray-400">--</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  year,
  trend,
}: {
  label: string;
  value: string | null;
  year: string | null;
  trend: { pct: number; direction: 'up' | 'down' | 'flat'; startYear: string; endYear: string } | null;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-xl font-semibold text-gray-900">
        {value || <span className="text-gray-400">--</span>}
      </div>
      {year && (
        <div className="text-xs text-gray-400 mt-0.5">As of {year}</div>
      )}
      {trend && (
        <div className={`text-xs mt-1 ${trendColorClass(trend)}`}>
          {trendDescription(trend)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/detail-panel/tabs/ParishDataTab.tsx
git commit -m "feat: add ParishDataTab with summary metrics and yearly breakdown"
```

---

### Task 11: Create CompensationTab Component

**Files:**
- Create: `web/src/components/detail-panel/tabs/CompensationTab.tsx`

- [ ] **Step 1: Create the Compensation tab**

```typescript
'use client';

import { Position } from '@/lib/types';
import {
  findField,
  isInterimPosition,
  formatDollarFull,
  compToLocalIncomeRatio,
} from '@/lib/narrative-helpers';
import { getCpgDisplayType } from '@/lib/cpg-mapping';

interface CompensationTabProps {
  pos: Position;
}

/**
 * Compensation tab: all compensation and benefits data with diocese context.
 */
export default function CompensationTab({ pos }: CompensationTabProps) {
  const fields = pos.deep_scrape_fields || [];
  const isInterim = isInterimPosition(pos);

  const salary = findField(fields, 'Range', 'Stipend', 'Compensation', 'Salary');
  const housing = findField(fields, 'Housing');
  const budget = findField(fields, 'Annual Budget', 'Budget');
  const order = findField(fields, 'Order', 'Ministry');

  const pension = findField(fields, 'Pension');
  const healthcare = findField(fields, 'Healthcare');
  const vacation = findField(fields, 'Vacation');
  const contEd = findField(fields, 'Continuing Education', 'Education');
  const reimbursement = findField(fields, 'Reimbursement', 'Travel', 'Auto');

  const hasBenefits = pension || healthcare || vacation || contEd;

  const comp = pos.compensation;
  const cpgType = pos.cpg_position_type || getCpgDisplayType(pos.position_types || [], pos.parochials?.[0]?.years
    ? (() => {
        const yk = Object.keys(pos.parochials[0].years).sort();
        const latest = pos.parochials[0].years[yk[yk.length - 1]];
        return latest?.averageAttendance ?? null;
      })()
    : null
  );

  const incomeRatio = compToLocalIncomeRatio(pos.estimated_total_comp, pos.census?.median_household_income);

  return (
    <div className="space-y-6">
      {/* Summary Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard
          label="Estimated Total Comp"
          value={pos.estimated_total_comp ? formatDollarFull(pos.estimated_total_comp) : (salary || '--')}
          subtitle={pos.comp_breakdown?.housing ? `Stipend: ${formatDollarFull(pos.comp_breakdown.stipend)} + Housing: ~${formatDollarFull(pos.comp_breakdown.housing)}` : undefined}
          isInterim={isInterim}
        />
        <SummaryCard
          label="Housing"
          value={housing || 'Not specified'}
        />
        <SummaryCard
          label="Annual Budget"
          value={budget ? `$${Number(budget).toLocaleString()}` : 'Not specified'}
        />
        <SummaryCard
          label="Orders Required"
          value={order || 'Not specified'}
        />
      </div>

      {/* Benefits Grid */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Benefits
        </h3>
        {hasBenefits ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <BenefitCard label="Pension" value={pension} />
            <BenefitCard label="Healthcare" value={healthcare} />
            <BenefitCard label="Vacation" value={vacation} />
            <BenefitCard label="Continuing Education" value={contEd} />
          </div>
        ) : (
          <p className="text-sm text-gray-500">No detailed benefits data available</p>
        )}
      </div>

      {/* Additional Benefits */}
      {reimbursement && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Additional Benefits
          </h3>
          <div className="text-sm text-gray-700">{reimbursement}</div>
        </div>
      )}

      {/* Diocese Compensation Context */}
      {comp && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Diocese Compensation Context
          </h3>
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
            {/* Position-type-specific benchmark */}
            {comp.position_type_median && comp.position_type_label ? (
              <div>
                <span className="text-gray-600">The diocese median for </span>
                <span className="font-semibold text-primary-900">{comp.position_type_label}s</span>
                <span className="text-gray-600"> is </span>
                <span className="font-semibold text-primary-900">{formatDollarFull(comp.position_type_median)}</span>
                {pos.estimated_total_comp && (
                  <span className={pos.estimated_total_comp >= comp.position_type_median ? 'text-green-600 ml-1' : 'text-amber-600 ml-1'}>
                    ({pos.estimated_total_comp >= comp.position_type_median ? 'Above' : 'Below'} median)
                  </span>
                )}
              </div>
            ) : cpgType ? (
              <div className="text-gray-500 text-xs">
                No position-specific benchmark available for {cpgType}s in this diocese.
              </div>
            ) : null}

            {/* Diocese-wide median */}
            <div>
              <span className="text-gray-600">Diocese-wide median clergy compensation: </span>
              <span className="font-semibold text-primary-900">{formatDollarFull(comp.diocese_median)}</span>
              {pos.estimated_total_comp && (
                <span className={pos.estimated_total_comp >= comp.diocese_median ? 'text-green-600 ml-1' : 'text-amber-600 ml-1'}>
                  ({pos.estimated_total_comp >= comp.diocese_median ? 'Above' : 'Below'} median)
                </span>
              )}
            </div>

            {/* Metadata */}
            <div className="text-xs text-gray-400">
              {comp.year} data | {comp.diocese_clergy_count} clergy in diocese
            </div>
          </div>
        </div>
      )}

      {/* Local income context */}
      {incomeRatio && (
        <div className="text-sm text-gray-600">
          {incomeRatio}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  subtitle,
  isInterim,
}: {
  label: string;
  value: string;
  subtitle?: string;
  isInterim?: boolean;
}) {
  return (
    <div className={`rounded-lg p-3 ${
      isInterim ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'
    }`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-sm font-semibold ${isInterim ? 'text-amber-700' : 'text-gray-900'}`}>
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-gray-400 mt-0.5">{subtitle}</div>
      )}
    </div>
  );
}

function BenefitCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <div className="text-gray-500 text-xs mb-0.5">{label}</div>
      <div className="text-gray-900">{value || 'Not specified'}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/detail-panel/tabs/CompensationTab.tsx
git commit -m "feat: add CompensationTab with benefits and CPG diocese context"
```

---

### Task 12: Create OverviewTab Component

**Files:**
- Create: `web/src/components/detail-panel/tabs/OverviewTab.tsx`

This is the largest component. It synthesizes data from all sources into the narrative view.

- [ ] **Step 1: Create the Overview tab**

```typescript
'use client';

import { useState } from 'react';
import { Position } from '@/lib/types';
import {
  extractParochialMetrics,
  trendDescription,
  trendColorClass,
  givingPerAttendeeDescription,
  formatDollar,
  formatDollarFull,
  isInterimPosition,
  findField,
  timeOnMarket,
  compToLocalIncomeRatio,
  diocesePercentileDescription,
} from '@/lib/narrative-helpers';

interface OverviewTabProps {
  pos: Position;
  churchIndex: number;
  onNavigate: (id: string) => void;
}

type SimilarSort = 'best' | 'size' | 'nearby' | 'comp' | 'type';

const SIMILAR_SORT_OPTIONS: Array<{ value: SimilarSort; label: string }> = [
  { value: 'best', label: 'Best match' },
  { value: 'size', label: 'Similar size' },
  { value: 'nearby', label: 'Nearby' },
  { value: 'comp', label: 'Similar comp' },
  { value: 'type', label: 'Same type' },
];

const MATCH_REASON_LABELS: Record<string, string> = {
  asa: 'Similar size',
  comp: 'Similar comp',
  state: 'Same state',
  type: 'Same type',
  housing: 'Same housing',
};

/**
 * Overview tab: the integrated narrative view that synthesizes data
 * from all sources into priest-relevant insights.
 */
export default function OverviewTab({ pos, churchIndex, onNavigate }: OverviewTabProps) {
  const [similarSort, setSimilarSort] = useState<SimilarSort>('best');
  const metrics = extractParochialMetrics(pos, churchIndex);
  const fields = pos.deep_scrape_fields || [];
  const isInterim = isInterimPosition(pos);
  const dp = pos.diocese_percentiles;

  return (
    <div className="space-y-6">
      {/* At-a-Glance Metrics */}
      <AtAGlanceRow pos={pos} metrics={metrics} isInterim={isInterim} />

      {/* Parish Health */}
      <NarrativeSection pos={pos} metrics={metrics} dp={dp} />

      {/* Clergy Stability */}
      <ClergyStability pos={pos} fields={fields} isInterim={isInterim} />

      {/* What They're Looking For */}
      <WhatTheyWant fields={fields} />

      {/* Search Timeline */}
      <SearchTimeline pos={pos} />

      {/* Church & Community */}
      <ChurchCommunity pos={pos} churchIndex={churchIndex} />

      {/* Similar Positions */}
      <SimilarPositionsSection
        pos={pos}
        sort={similarSort}
        onSortChange={setSimilarSort}
        onNavigate={onNavigate}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// At-a-Glance Metrics Row
// ---------------------------------------------------------------------------

function AtAGlanceRow({
  pos,
  metrics,
  isInterim,
}: {
  pos: Position;
  metrics: ReturnType<typeof extractParochialMetrics>;
  isInterim: boolean;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Compensation */}
      <div className={`rounded-lg p-3 ${isInterim ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}>
        <div className="text-xs text-gray-500">Compensation</div>
        <div className={`text-lg font-semibold ${isInterim ? 'text-amber-700' : 'text-gray-900'}`}>
          {pos.estimated_total_comp
            ? formatDollar(pos.estimated_total_comp)
            : isInterim
              ? 'Interim Position'
              : '--'}
        </div>
        {pos.comp_breakdown?.housing ? (
          <div className="text-xs text-gray-400">Includes housing</div>
        ) : pos.estimated_total_comp ? (
          <div className="text-xs text-gray-400">Stipend only</div>
        ) : null}
      </div>

      {/* ASA */}
      <div className="bg-gray-50 rounded-lg p-3">
        <div className="text-xs text-gray-500">Avg Sunday Attendance</div>
        <div className="text-lg font-semibold text-gray-900">
          {metrics.latestAsa ?? '--'}
        </div>
        {metrics.asaTrend && (
          <div className={`text-xs ${trendColorClass(metrics.asaTrend)}`}>
            {trendDescription(metrics.asaTrend)}
          </div>
        )}
      </div>

      {/* Annual Giving */}
      <div className="bg-gray-50 rounded-lg p-3">
        <div className="text-xs text-gray-500">Annual Giving</div>
        <div className="text-lg font-semibold text-gray-900">
          {metrics.latestPlatePledge != null ? formatDollar(metrics.latestPlatePledge) : '--'}
        </div>
        {metrics.givingTrend && (
          <div className={`text-xs ${trendColorClass(metrics.givingTrend)}`}>
            {trendDescription(metrics.givingTrend)}
          </div>
        )}
      </div>

      {/* Giving per Attendee */}
      <div className="bg-gray-50 rounded-lg p-3">
        <div className="text-xs text-gray-500">Giving per Attendee</div>
        <div className="text-lg font-semibold text-gray-900">
          {metrics.givingPerAttendee != null ? formatDollar(metrics.givingPerAttendee) : '--'}
        </div>
        <div className="text-xs text-gray-400">Annual plate & pledge / ASA</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parish Health Narrative
// ---------------------------------------------------------------------------

function NarrativeSection({
  pos,
  metrics,
  dp,
}: {
  pos: Position;
  metrics: ReturnType<typeof extractParochialMetrics>;
  dp: Position['diocese_percentiles'];
}) {
  const hasAnyData = metrics.latestAsa != null || metrics.latestPlatePledge != null;
  if (!hasAnyData) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Parish Health
      </h3>
      <div className="text-sm text-gray-700 space-y-1.5">
        {/* ASA */}
        {metrics.latestAsa != null && (
          <p>
            Average Sunday attendance is{' '}
            <span className="font-semibold text-primary-900">{metrics.latestAsa}</span>
            {metrics.asaTrend && (
              <span className={trendColorClass(metrics.asaTrend)}>
                {', '}{trendDescription(metrics.asaTrend)}
              </span>
            )}
            {dp?.asa != null && (
              <span className="text-gray-500">
                {' '}- larger than {dp.asa}% of parishes in the diocese
              </span>
            )}
            .
          </p>
        )}

        {/* Giving */}
        {metrics.latestPlatePledge != null && (
          <p>
            Annual plate and pledge giving is{' '}
            <span className="font-semibold text-primary-900">
              {formatDollarFull(metrics.latestPlatePledge)}
            </span>
            {metrics.givingTrend && (
              <span className={trendColorClass(metrics.givingTrend)}>
                {', '}{trendDescription(metrics.givingTrend)}
              </span>
            )}
            {dp?.plate_pledge != null && (
              <span className="text-gray-500">
                {' '}- {dp.plate_pledge}th percentile in the diocese
              </span>
            )}
            .
            {/* Contextualize against attendance trend */}
            {metrics.asaTrend && metrics.givingTrend &&
              metrics.asaTrend.direction !== metrics.givingTrend.direction &&
              metrics.asaTrend.direction !== 'flat' && metrics.givingTrend.direction !== 'flat' && (
              <span className="text-gray-500">
                {' '}Giving has moved in the opposite direction from attendance.
              </span>
            )}
          </p>
        )}

        {/* Giving per attendee */}
        {metrics.givingPerAttendee != null && (
          <p>
            That works out to{' '}
            <span className="font-semibold text-primary-900">
              {formatDollarFull(metrics.givingPerAttendee)}
            </span>
            {' '}per attendee in annual giving, a signal of congregational commitment.
          </p>
        )}

        {/* Membership */}
        {metrics.latestMembership != null && (
          <p>
            Membership is{' '}
            <span className="font-semibold text-primary-900">
              {metrics.latestMembership.toLocaleString()}
            </span>
            {metrics.latestMembershipYear && metrics.latestMembershipYear !== metrics.latestAsaYear && (
              <span className="text-gray-400"> (as of {metrics.latestMembershipYear})</span>
            )}
            {metrics.membershipTrend && (
              <span className={trendColorClass(metrics.membershipTrend)}>
                {', '}{trendDescription(metrics.membershipTrend)}
              </span>
            )}
            .
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clergy Stability
// ---------------------------------------------------------------------------

function ClergyStability({
  pos,
  fields,
  isInterim,
}: {
  pos: Position;
  fields: Array<{ label: string; value: string }>;
  isInterim: boolean;
}) {
  const hasClergyData = pos.current_clergy || pos.parish_clergy_history;
  const order = findField(fields, 'Order', 'Ministry');

  if (!hasClergyData && !order) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Clergy Stability
      </h3>
      <div className="text-sm text-gray-700 space-y-1.5">
        {pos.current_clergy && (
          <p>
            Current clergy: <span className="font-semibold text-primary-900">{pos.current_clergy.name}</span>
            {pos.current_clergy.position_title && ` (${pos.current_clergy.position_title})`}
            {pos.current_clergy.years_tenure > 0 && `, ${pos.current_clergy.years_tenure} years`}
            .
          </p>
        )}
        {pos.parish_clergy_history && pos.parish_clergy_history.avg_tenure_years > 0 && (
          <p>
            Over the past decade, this parish has had{' '}
            <span className="font-semibold text-primary-900">{pos.parish_clergy_history.recent_count}</span>
            {' '}clergy with an average tenure of{' '}
            <span className="font-semibold text-primary-900">{pos.parish_clergy_history.avg_tenure_years} years</span>.
          </p>
        )}
        {isInterim && (
          <p>
            <span className="inline-flex items-center px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
              Interim
            </span>
            <span className="ml-1">This is an interim position.</span>
          </p>
        )}
        {order && (
          <p>Orders required: <span className="font-semibold text-primary-900">{order}</span></p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// What They're Looking For
// ---------------------------------------------------------------------------

function WhatTheyWant({ fields }: { fields: Array<{ label: string; value: string }> }) {
  const communityHopes = findField(fields, 'hopes for this position', 'qualities');
  const description = findField(fields, 'Description');
  const desiredSkills = findField(fields, 'Leadership skills', 'Ministry skills');
  const howToApply = findField(fields, 'How to Apply', 'Application', 'Submit');
  const contactName = findField(fields, 'Contact Name', 'Contact Person');
  const contactTitle = findField(fields, 'Contact Title');
  const contactEmail = findField(fields, 'Contact Email', 'Email');

  if (!communityHopes && !description && !desiredSkills && !howToApply && !contactName) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        What They&apos;re Looking For
      </h3>
      <div className="text-sm text-gray-700 space-y-2">
        {(communityHopes || description) && (
          <p className="whitespace-pre-line">
            {communityHopes || description}
          </p>
        )}
        {desiredSkills && (
          <p>
            <span className="text-gray-500">Desired skills: </span>
            {desiredSkills}
          </p>
        )}
        {howToApply && (
          <p>
            <span className="text-gray-500">How to apply: </span>
            {howToApply}
          </p>
        )}
        {contactName && (
          <p>
            <span className="text-gray-500">Contact: </span>
            {contactName}
            {contactTitle && `, ${contactTitle}`}
            {contactEmail && (
              <>
                {' - '}
                <a
                  href={`mailto:${contactEmail}`}
                  className="text-primary-600 underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {contactEmail}
                </a>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search Timeline
// ---------------------------------------------------------------------------

function SearchTimeline({ pos }: { pos: Position }) {
  const receivingFrom = pos.receiving_names_from
    ? pos.receiving_names_from.split(' to ')[0].split(' - ')[0].trim()
    : '';
  const receivingTo = pos.receiving_names_to || '';
  const market = timeOnMarket(pos);

  if (!receivingFrom && !market) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Search Timeline
      </h3>
      <div className="text-sm text-gray-700 space-y-1">
        {receivingFrom && <p>Receiving names since <span className="font-semibold text-primary-900">{receivingFrom}</span></p>}
        <p>{receivingTo ? `End date: ${receivingTo}` : 'Open-ended search'}</p>
        {market && <p>Time on market: <span className="font-semibold text-primary-900">{market}</span></p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Church & Community
// ---------------------------------------------------------------------------

function ChurchCommunity({ pos, churchIndex }: { pos: Position; churchIndex: number }) {
  const church = pos.church_infos?.[churchIndex];
  const census = pos.census;
  const fields = pos.deep_scrape_fields || [];
  const setting = findField(fields, 'Ministry Setting', 'Setting');
  const incomeRatio = compToLocalIncomeRatio(pos.estimated_total_comp, census?.median_household_income);

  if (!church && !census && !setting) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Church & Community
      </h3>
      <div className="text-sm text-gray-700 space-y-1.5">
        {church?.street && (
          <p>
            {church.street}, {church.city}, {church.state} {church.zip}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {church?.website && (
            <a
              href={church.website.startsWith('http') ? church.website : `https://${church.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 underline text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              {church.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          )}
          {church?.email && (
            <a href={`mailto:${church.email}`} className="text-primary-600 underline text-xs" onClick={(e) => e.stopPropagation()}>
              {church.email}
            </a>
          )}
          {church?.phone && (
            <span className="text-xs text-gray-500">{church.phone}</span>
          )}
        </div>
        {setting && <p>Ministry setting: <span className="font-semibold text-primary-900">{setting}</span></p>}
        {census?.median_household_income != null && (
          <p>
            Area median household income:{' '}
            <span className="font-semibold text-primary-900">
              {formatDollarFull(census.median_household_income)}
            </span>
          </p>
        )}
        {census?.population != null && (
          <p>Area population: <span className="font-semibold text-primary-900">{census.population.toLocaleString()}</span></p>
        )}
        {incomeRatio && <p className="text-gray-500">{incomeRatio}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Similar Positions
// ---------------------------------------------------------------------------

function SimilarPositionsSection({
  pos,
  sort,
  onSortChange,
  onNavigate,
}: {
  pos: Position;
  sort: SimilarSort;
  onSortChange: (s: SimilarSort) => void;
  onNavigate: (id: string) => void;
}) {
  const candidates = pos.similar_positions;
  if (!candidates || candidates.length === 0) return null;

  // Sort candidates based on selected criterion
  const sorted = [...candidates].sort((a, b) => {
    if (sort === 'best') return b.score - a.score;

    // For other sorts: give +10 weight to the selected criterion, then composite score as tiebreaker
    const weight = (item: typeof a): number => {
      const reasons = item.match_reasons;
      if (!reasons) return item.score;
      let bonus = 0;
      if (sort === 'size' && reasons.asa) bonus = 10;
      if (sort === 'nearby' && reasons.state) bonus = 10;
      if (sort === 'comp' && reasons.comp) bonus = 10;
      if (sort === 'type' && reasons.type) bonus = 10;
      return bonus + item.score;
    };

    return weight(b) - weight(a);
  });

  const displayed = sorted.slice(0, 3);

  return (
    <div className="border-t border-gray-200 pt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Similar Positions
        </h3>
        <select
          value={sort}
          onChange={(e) => { e.stopPropagation(); onSortChange(e.target.value as SimilarSort); }}
          onClick={(e) => e.stopPropagation()}
          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-600"
        >
          {SIMILAR_SORT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {displayed.map(sim => (
          <button
            key={sim.id}
            onClick={(e) => { e.stopPropagation(); onNavigate(sim.id); }}
            className="text-left border border-gray-200 rounded-lg p-3 bg-white hover:bg-gray-50 transition-colors"
          >
            <div className="font-medium text-gray-900 text-sm truncate">{sim.name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {sim.city && <>{sim.city}, </>}{sim.state}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{sim.position_type}</div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              {sim.asa != null && <span>ASA {sim.asa}</span>}
              {sim.estimated_total_comp != null && (
                <span className="text-green-700">{formatDollar(sim.estimated_total_comp)}</span>
              )}
            </div>

            {/* Match reason tags */}
            {sim.match_reasons && (
              <div className="flex flex-wrap gap-1 mt-2">
                {Object.entries(sim.match_reasons)
                  .filter(([, v]) => v)
                  .map(([key]) => (
                    <span
                      key={key}
                      className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]"
                    >
                      {MATCH_REASON_LABELS[key] || key}
                    </span>
                  ))
                }
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/detail-panel/tabs/OverviewTab.tsx
git commit -m "feat: add OverviewTab with narrative sections and similar positions"
```

---

### Task 13: Create DetailPanel Component

**Files:**
- Create: `web/src/components/detail-panel/DetailPanel.tsx`

- [ ] **Step 1: Create the main panel container**

```typescript
'use client';

import { useState } from 'react';
import { Position } from '@/lib/types';
import type { PersonalData } from '@/lib/types';
import DetailHeader from './DetailHeader';
import ChurchSelector from './ChurchSelector';
import DetailTabs, { type TabConfig } from './DetailTabs';
import OverviewTab from './tabs/OverviewTab';
import ParishDataTab from './tabs/ParishDataTab';
import CompensationTab from './tabs/CompensationTab';
import ProfileTab from './tabs/ProfileTab';

interface DetailPanelProps {
  pos: Position;
  onNavigate: (id: string) => void;
  meData: PersonalData | null;
}

/**
 * Main detail panel container.
 * Renders sticky header (church name, metadata, church selector, tab bar)
 * and the active tab's content.
 */
export default function DetailPanel({ pos, onNavigate, meData }: DetailPanelProps) {
  const [churchIndex, setChurchIndex] = useState(0);
  const churches = pos.church_infos || [];
  const isMultiChurch = churches.length > 1;

  const tabs: TabConfig[] = [
    {
      id: 'overview',
      label: 'Overview',
      content: <OverviewTab pos={pos} churchIndex={churchIndex} onNavigate={onNavigate} />,
    },
    {
      id: 'parish',
      label: 'Parish Data',
      content: <ParishDataTab pos={pos} churchIndex={churchIndex} />,
    },
    {
      id: 'compensation',
      label: 'Compensation',
      content: <CompensationTab pos={pos} />,
    },
    {
      id: 'profile',
      label: 'Profile',
      content: <ProfileTab pos={pos} />,
    },
  ];

  return (
    <div>
      {/* Sticky header area */}
      <div className="sticky top-0 bg-white z-10 pb-0 -mx-4 px-4 border-b border-gray-100">
        <DetailHeader pos={pos} />
        {isMultiChurch && (
          <ChurchSelector
            churches={churches}
            selectedIndex={churchIndex}
            onSelect={setChurchIndex}
          />
        )}
        <div className="-mb-px">
          {/* Tabs are rendered by DetailTabs which includes both the bar and content */}
        </div>
      </div>

      {/* Tab bar + content */}
      <div className="mt-3">
        <DetailTabs tabs={tabs} defaultTab="overview" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/detail-panel/DetailPanel.tsx
git commit -m "feat: add DetailPanel container with sticky header and tab switching"
```

---

### Task 14: Integrate DetailPanel into PositionTable

**Files:**
- Modify: `web/src/components/PositionTable.tsx`

- [ ] **Step 1: Add import for DetailPanel**

At the top of `web/src/components/PositionTable.tsx`, add the import (after the existing imports around line 13):

```typescript
import DetailPanel from './detail-panel/DetailPanel';
```

- [ ] **Step 2: Replace ExpandedDetail usage in mobile layout**

In the mobile layout (around lines 294-298), replace the `ExpandedDetail` call with `DetailPanel`:

Find:
```typescript
              {expandedId === pos.id && (
                <div className="border border-t-0 border-primary-200 rounded-b-lg p-3 bg-primary-50/40 border-l-4 border-l-primary-500">
                  <ExpandedDetail pos={pos} onNavigate={expandAndScrollTo} meData={meData} />
                </div>
              )}
```

Replace with:
```typescript
              {expandedId === pos.id && (
                <div className="border border-t-0 border-primary-200 rounded-b-lg p-4 bg-white border-l-4 border-l-primary-600">
                  <DetailPanel pos={pos} onNavigate={expandAndScrollTo} meData={meData} />
                </div>
              )}
```

- [ ] **Step 3: Replace ExpandedDetail usage in desktop layout**

In the desktop layout (around lines 417-422), replace the `ExpandedDetail` call with `DetailPanel`:

Find:
```typescript
                  {expandedId === pos.id && (
                    <tr key={`${pos.id}-detail`}>
                      <td colSpan={7} className="px-4 py-4 bg-primary-50/40 border-l-4 border-l-primary-500">
                        <ExpandedDetail pos={pos} onNavigate={expandAndScrollTo} meData={meData} />
                      </td>
                    </tr>
                  )}
```

Replace with:
```typescript
                  {expandedId === pos.id && (
                    <tr key={`${pos.id}-detail`}>
                      <td colSpan={7} className="px-4 py-4 bg-white border-l-4 border-l-primary-600">
                        <DetailPanel pos={pos} onNavigate={expandAndScrollTo} meData={meData} />
                      </td>
                    </tr>
                  )}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/PositionTable.tsx
git commit -m "feat: integrate DetailPanel into PositionTable, replacing ExpandedDetail"
```

---

### Task 15: Remove Old ExpandedDetail and Inlined Sub-components

**Files:**
- Modify: `web/src/components/PositionTable.tsx`

This task removes the now-unused components from PositionTable.tsx. These are all defined inline in the file and are no longer referenced after Task 14.

- [ ] **Step 1: Remove the ExpandedDetail function**

Delete the entire `ExpandedDetail` function (lines 551-852 approximately), the `DetailField` function (line 854-861), the `DioceseContext` function (lines 464-490), `CommunityContext` (lines 492-516), and `SimilarPositions` (lines 518-549).

Also remove the `ordinalSuffix` function (lines 449-457) and `formatDollarCompact` function (lines 459-462) as they are now handled by narrative-helpers.ts.

- [ ] **Step 2: Remove unused imports from PositionTable.tsx**

Remove imports that were only used by ExpandedDetail:
- `QualityScoreDetail` from `'./QualityBadge'` (keep `QualityBadge`)
- `ParochialTrends` from `'./ParochialTrends'`
- `isGibberish` from `'@/lib/gibberish-detector'`
- `ParishContextSection` from `'./ParishContextSection'`
- `PersonalContext` from `'./PersonalContext'`

Keep imports that are still used: `QualityBadge`, `UnifiedStatusBadge`, `ComparisonBar`, `ComparisonModal`, `Position`, `SortField`, `SortDirection`, `PersonalData`, `ME_TOKEN_KEY`, `Fragment`, `useState`, `useCallback`, `useEffect`.

- [ ] **Step 3: Verify the build succeeds**

Run:
```bash
cd web && npx next build
```
Expected: Build completes without errors. There may be warnings about unused files, but no compilation errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/PositionTable.tsx
git commit -m "refactor: remove old ExpandedDetail and inlined sub-components"
```

---

### Task 16: Visual Verification and Fixes

**Files:**
- Potentially any of the new components

- [ ] **Step 1: Start the dev server**

Run:
```bash
cd web && npm run dev
```

- [ ] **Step 2: Verify the panel renders**

Open the app in a browser. Click on a position row to expand it. Verify:
- Header shows church name, type pills, status badge, location, dates, links
- Four tabs appear: Overview, Parish Data, Compensation, Profile
- Clicking tabs switches content
- Overview tab shows at-a-glance metrics, narrative sections, similar positions
- Parish Data tab shows summary metrics and yearly breakdown table
- Compensation tab shows summary grid, benefits, diocese context
- Profile tab shows organized key-value fields

- [ ] **Step 3: Verify multi-church positions**

Find a position with multiple churches. Verify:
- Church selector appears between header and tabs
- Clicking a church pill updates parish-specific data in Overview and Parish Data tabs
- Shared data (compensation, profile) stays the same

- [ ] **Step 4: Verify interim position styling**

Find an interim position. Verify:
- Amber type pill in header
- Amber compensation card
- Amber inline badge in Clergy Stability section

- [ ] **Step 5: Verify similar positions sort**

In the Overview tab, change the similar positions sort selector. Verify:
- Cards re-sort immediately (no loading)
- Match reason tags appear on each card
- Selecting "Nearby" prioritizes same-state positions
- Selecting "Similar size" prioritizes ASA matches

- [ ] **Step 6: Fix any visual issues found**

If any visual discrepancies are found, fix them in the relevant component files.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: visual adjustments from panel redesign verification"
```

---

### Task 17: Run Enrichment Pipeline to Verify Pipeline Changes

**Files:**
- No new changes; this tests Tasks 1-2

- [ ] **Step 1: Run the enrichment pipeline**

Run:
```bash
cd web && node scripts/run-enrichment.js ../data public/data
```
Expected: Pipeline completes without errors. Console shows "Similar positions: N positions with recommendations".

- [ ] **Step 2: Verify similar positions have match_reasons in output**

Run:
```bash
cd web && node -e "const d=require('./public/data/enriched-positions.json'); const p=d.find(p=>p.similar_positions?.length>0); if(p){console.log(p.similar_positions[0])}else{console.log('no similar positions found')}"
```
Expected: Output includes a `match_reasons` object with boolean fields.

- [ ] **Step 3: Verify cpg_position_type in output (when data available)**

Run:
```bash
cd web && node -e "const d=require('./public/data/enriched-positions.json'); const p=d.find(p=>p.cpg_position_type); if(p){console.log(p.id, p.cpg_position_type)}else{console.log('no cpg types found (expected if compensation_by_position table is empty)')}"
```
Expected: Either shows a position with a CPG type, or the "expected" message if compensation data hasn't been loaded.

- [ ] **Step 4: Commit regenerated data**

```bash
git add web/public/data/enriched-positions.json web/public/data/enriched-extended.json
git commit -m "data: regenerate enriched data with match_reasons and CPG types"
```
