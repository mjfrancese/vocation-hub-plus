# Phase 4B: Dashboard Preferences & Position Matching - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add search preferences that let any visitor describe what they're looking for, then use those preferences to pre-fill filters and score/label matching positions on the Positions page.

**Architecture:** Preferences stored in localStorage via a `usePreferences()` hook. A pure `scorePosition()` function computes match scores. The Positions page gains a conditional MATCH column and a collapsible PreferencesPanel. The /me dashboard gains a Preferences tab accessible to all visitors.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, localStorage

---

## File Structure

```
web/src/
  lib/
    types.ts                    -- MODIFY: add SearchPreferences interface
    match-helpers.ts            -- NEW: scorePosition(), match tier logic, reasons
  hooks/
    usePreferences.ts           -- NEW: localStorage read/write for SearchPreferences
  components/
    PreferencesForm.tsx         -- NEW: full preferences editor (toggle chips, ranges)
    PreferencesPanel.tsx        -- NEW: collapsible summary panel for Positions page
    MatchBadge.tsx              -- NEW: match tier badge + optional reasons
    PositionTable.tsx           -- MODIFY: add conditional MATCH column, sort boost
  app/
    me/page.tsx                 -- MODIFY: add Preferences tab, allow access without token
    page.tsx                    -- MODIFY: integrate PreferencesPanel, smart defaults, pass match data
  hooks/
    useFilterState.ts           -- MODIFY: accept preference-based initial values
```

---

### Task 1: Add SearchPreferences type and usePreferences hook

**Files:**
- Modify: `web/src/lib/types.ts`
- Create: `web/src/hooks/usePreferences.ts`

- [ ] **Step 1: Add SearchPreferences interface to types.ts**

Add to the end of `web/src/lib/types.ts`:

```typescript
/** User's search preferences, stored in localStorage */
export interface SearchPreferences {
  positionTypes: string[];
  regions: string[];
  states: string[];
  asaMin: number | null;
  asaMax: number | null;
  compMin: number | null;
  compMax: number | null;
  housing: 'rectory' | 'allowance' | 'either' | null;
  ministrySettings: string[];
  showDetailedMatch: boolean;
}
```

- [ ] **Step 2: Create usePreferences hook**

Create `web/src/hooks/usePreferences.ts`:

```typescript
'use client';

import { useState, useCallback, useEffect } from 'react';
import type { SearchPreferences } from '@/lib/types';

const STORAGE_KEY = 'vh_search_prefs';

const DEFAULT_PREFS: SearchPreferences = {
  positionTypes: [],
  regions: [],
  states: [],
  asaMin: null,
  asaMax: null,
  compMin: null,
  compMax: null,
  housing: null,
  ministrySettings: [],
  showDetailedMatch: true,
};

function loadPrefs(): SearchPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function hasActivePreferences(prefs: SearchPreferences): boolean {
  return (
    prefs.positionTypes.length > 0 ||
    prefs.regions.length > 0 ||
    prefs.states.length > 0 ||
    prefs.asaMin != null ||
    prefs.asaMax != null ||
    prefs.compMin != null ||
    prefs.compMax != null ||
    prefs.housing != null ||
    prefs.ministrySettings.length > 0
  );
}

export function countActivePreferences(prefs: SearchPreferences): number {
  let count = 0;
  if (prefs.positionTypes.length > 0) count++;
  if (prefs.regions.length > 0) count++;
  if (prefs.states.length > 0) count++;
  if (prefs.asaMin != null || prefs.asaMax != null) count++;
  if (prefs.compMin != null || prefs.compMax != null) count++;
  if (prefs.housing != null) count++;
  if (prefs.ministrySettings.length > 0) count++;
  return count;
}

export function usePreferences(): [SearchPreferences, (prefs: SearchPreferences) => void, () => void] {
  const [prefs, setPrefsState] = useState<SearchPreferences>(DEFAULT_PREFS);

  useEffect(() => {
    setPrefsState(loadPrefs());
  }, []);

  const save = useCallback((updated: SearchPreferences) => {
    setPrefsState(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const clear = useCallback(() => {
    setPrefsState(DEFAULT_PREFS);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return [prefs, save, clear];
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/types.ts web/src/hooks/usePreferences.ts
git commit -m "feat: add SearchPreferences type and usePreferences localStorage hook"
```

---

### Task 2: Create match-helpers.ts

**Files:**
- Create: `web/src/lib/match-helpers.ts`

- [ ] **Step 1: Create the match scoring module**

Create `web/src/lib/match-helpers.ts`:

```typescript
import type { Position, SearchPreferences } from './types';
import { getRegion } from './analytics-helpers';

interface MatchResult {
  score: number;
  tier: 'strong' | 'good' | 'partial' | 'none';
  reasons: string[];
}

const WEIGHTS = {
  positionType: 25,
  region: 15,
  state: 15,
  asa: 15,
  comp: 15,
  housing: 5,
  ministrySetting: 10,
};

export function scorePosition(pos: Position, prefs: SearchPreferences): MatchResult {
  let earned = 0;
  let possible = 0;
  const reasons: string[] = [];

  // Position type
  if (prefs.positionTypes.length > 0) {
    possible += WEIGHTS.positionType;
    const posTypes = pos.position_types || [];
    if (posTypes.some(t => prefs.positionTypes.includes(t))) {
      earned += WEIGHTS.positionType;
      reasons.push(posTypes.find(t => prefs.positionTypes.includes(t)) || 'Type');
    }
  }

  // Region
  if (prefs.regions.length > 0) {
    possible += WEIGHTS.region;
    if (pos.state) {
      const region = getRegion(pos.state);
      if (prefs.regions.includes(region)) {
        earned += WEIGHTS.region;
        reasons.push(region);
      }
    }
  }

  // State
  if (prefs.states.length > 0) {
    possible += WEIGHTS.state;
    if (pos.state && prefs.states.includes(pos.state)) {
      earned += WEIGHTS.state;
      reasons.push(pos.state);
    }
  }

  // ASA range
  if (prefs.asaMin != null || prefs.asaMax != null) {
    possible += WEIGHTS.asa;
    const asa = getPositionASA(pos);
    if (asa != null) {
      const min = prefs.asaMin ?? 0;
      const max = prefs.asaMax ?? Infinity;
      if (asa >= min && asa <= max) {
        earned += WEIGHTS.asa;
        reasons.push('ASA range');
      } else {
        // Half points if within 25% of bounds
        const tolerance = Math.max((max - min) * 0.25, 25);
        if (asa >= min - tolerance && asa <= max + tolerance) {
          earned += WEIGHTS.asa / 2;
          reasons.push('ASA (near)');
        }
      }
    }
  }

  // Compensation range
  if (prefs.compMin != null || prefs.compMax != null) {
    possible += WEIGHTS.comp;
    const comp = pos.estimated_total_comp;
    if (comp != null && comp > 0) {
      const min = prefs.compMin ?? 0;
      const max = prefs.compMax ?? Infinity;
      if (comp >= min && comp <= max) {
        earned += WEIGHTS.comp;
        reasons.push('Comp range');
      } else {
        // Half points if within 15% of bounds
        const tolerance = Math.max((max - min) * 0.15, 10000);
        if (comp >= min - tolerance && comp <= max + tolerance) {
          earned += WEIGHTS.comp / 2;
          reasons.push('Comp (near)');
        }
      }
    }
  }

  // Housing
  if (prefs.housing != null && prefs.housing !== 'either') {
    possible += WEIGHTS.housing;
    const posHousing = getPositionHousing(pos);
    if (posHousing) {
      const match = (prefs.housing === 'rectory' && posHousing.includes('Rectory')) ||
                    (prefs.housing === 'allowance' && posHousing.includes('Allowance'));
      if (match) {
        earned += WEIGHTS.housing;
        reasons.push('Housing');
      }
    }
  } else if (prefs.housing === 'either') {
    // "Either" means any housing is fine -- always matches
    possible += WEIGHTS.housing;
    earned += WEIGHTS.housing;
  }

  // Ministry setting
  if (prefs.ministrySettings.length > 0) {
    possible += WEIGHTS.ministrySetting;
    const setting = getPositionSetting(pos);
    if (setting && prefs.ministrySettings.includes(setting)) {
      earned += WEIGHTS.ministrySetting;
      reasons.push(setting);
    }
  }

  // Normalize score to 0-100
  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;

  let tier: MatchResult['tier'] = 'none';
  if (score >= 75) tier = 'strong';
  else if (score >= 50) tier = 'good';
  else if (score >= 25) tier = 'partial';

  return { score, tier, reasons };
}

function getPositionASA(pos: Position): number | null {
  const parochial = pos.parochials?.[0];
  if (!parochial?.years) return null;
  const years = Object.keys(parochial.years).sort();
  for (let i = years.length - 1; i >= 0; i--) {
    const asa = parochial.years[years[i]]?.averageAttendance;
    if (asa != null && asa > 0) return asa;
  }
  return null;
}

function getPositionHousing(pos: Position): string {
  const fields = pos.deep_scrape_fields || [];
  const field = fields.find(f => f.label === 'Type of Housing Provided');
  return field?.value || '';
}

function getPositionSetting(pos: Position): string {
  const fields = pos.deep_scrape_fields || [];
  const field = fields.find(f => f.label === 'Ministry Setting');
  return field?.value || '';
}

export const MATCH_TIER_STYLES = {
  strong: { bg: 'bg-green-100', text: 'text-green-800', label: 'Strong match' },
  good: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Good match' },
  partial: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Partial match' },
  none: { bg: '', text: '', label: '' },
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/match-helpers.ts
git commit -m "feat: add position match scoring with normalized weights and tier logic"
```

---

### Task 3: Create MatchBadge component

**Files:**
- Create: `web/src/components/MatchBadge.tsx`

- [ ] **Step 1: Create MatchBadge component**

Create `web/src/components/MatchBadge.tsx`:

```typescript
'use client';

import { MATCH_TIER_STYLES } from '@/lib/match-helpers';

interface MatchBadgeProps {
  tier: 'strong' | 'good' | 'partial' | 'none';
  reasons: string[];
  detailed: boolean;
}

export default function MatchBadge({ tier, reasons, detailed }: MatchBadgeProps) {
  if (tier === 'none') return null;

  const style = MATCH_TIER_STYLES[tier];

  return (
    <div className="flex flex-col gap-0.5">
      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.bg} ${style.text} w-fit`}>
        {detailed ? style.label : tier === 'strong' ? 'Strong' : tier === 'good' ? 'Good' : 'Partial'}
      </span>
      {detailed && reasons.length > 0 && (
        <span className="text-[10px] text-gray-500 leading-tight">
          {reasons.join(' \u00b7 ')}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/MatchBadge.tsx
git commit -m "feat: add MatchBadge component with tier colors and reason display"
```

---

### Task 4: Create PreferencesForm component

**Files:**
- Create: `web/src/components/PreferencesForm.tsx`

- [ ] **Step 1: Create the full preferences editor**

Create `web/src/components/PreferencesForm.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import type { SearchPreferences } from '@/lib/types';

interface PreferencesFormProps {
  prefs: SearchPreferences;
  onSave: (prefs: SearchPreferences) => void;
  onClear: () => void;
}

const POSITION_TYPES = [
  'Rector', 'Vicar', 'Priest-in-Charge', 'Assistant', 'Associate',
  'Curate', 'Dean', 'Interim', 'Canon', 'Other',
];

const REGIONS = ['Northeast', 'Southeast', 'Midwest', 'West', 'Southwest'];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
];

const MINISTRY_SETTINGS = ['Urban', 'Suburban', 'Small Town', 'Rural'];

export default function PreferencesForm({ prefs, onSave, onClear }: PreferencesFormProps) {
  const [local, setLocal] = useState<SearchPreferences>(prefs);

  useEffect(() => {
    setLocal(prefs);
  }, [prefs]);

  function toggle<K extends keyof SearchPreferences>(field: K, value: string) {
    const arr = local[field] as string[];
    const updated = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
    setLocal({ ...local, [field]: updated });
  }

  function setRange(field: 'asaMin' | 'asaMax' | 'compMin' | 'compMax', value: string) {
    const parsed = value === '' ? null : parseNumber(value);
    setLocal({ ...local, [field]: parsed });
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm font-semibold text-gray-900 mb-1">Search Preferences</div>
        <div className="text-xs text-gray-500">Set your criteria and matching positions will be highlighted on the Positions page.</div>
      </div>

      {/* Position Types */}
      <FieldSection label="Position Types">
        <ChipGroup items={POSITION_TYPES} selected={local.positionTypes} onToggle={(v) => toggle('positionTypes', v)} />
      </FieldSection>

      {/* Regions */}
      <FieldSection label="Regions">
        <ChipGroup items={REGIONS} selected={local.regions} onToggle={(v) => toggle('regions', v)} />
      </FieldSection>

      {/* States */}
      <FieldSection label="States">
        <div className="flex flex-wrap gap-1.5">
          {local.states.length > 0 && local.states.map(s => (
            <span
              key={s}
              onClick={() => toggle('states', s)}
              className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800 cursor-pointer hover:bg-blue-200"
            >
              {s} &times;
            </span>
          ))}
          <select
            className="text-xs border border-gray-300 rounded px-2 py-1 text-gray-600"
            value=""
            onChange={(e) => {
              if (e.target.value && !local.states.includes(e.target.value)) {
                toggle('states', e.target.value);
              }
            }}
          >
            <option value="">Add state...</option>
            {US_STATES.filter(s => !local.states.includes(s)).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </FieldSection>

      {/* ASA and Comp ranges */}
      <div className="grid grid-cols-2 gap-4">
        <FieldSection label="Church Size (ASA)">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Min"
              value={local.asaMin ?? ''}
              onChange={(e) => setRange('asaMin', e.target.value)}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="text"
              placeholder="Max"
              value={local.asaMax ?? ''}
              onChange={(e) => setRange('asaMax', e.target.value)}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center"
            />
          </div>
        </FieldSection>

        <FieldSection label="Compensation">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Min"
              value={local.compMin != null ? formatCompInput(local.compMin) : ''}
              onChange={(e) => setRange('compMin', e.target.value)}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="text"
              placeholder="Max"
              value={local.compMax != null ? formatCompInput(local.compMax) : ''}
              onChange={(e) => setRange('compMax', e.target.value)}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center"
            />
          </div>
        </FieldSection>
      </div>

      {/* Housing and Ministry Setting */}
      <div className="grid grid-cols-2 gap-4">
        <FieldSection label="Housing">
          <ChipGroup
            items={['Either', 'Rectory', 'Allowance']}
            selected={local.housing ? [local.housing === 'either' ? 'Either' : local.housing === 'rectory' ? 'Rectory' : 'Allowance'] : []}
            onToggle={(v) => {
              const mapped = v.toLowerCase() as 'either' | 'rectory' | 'allowance';
              setLocal({ ...local, housing: local.housing === mapped ? null : mapped });
            }}
          />
        </FieldSection>

        <FieldSection label="Ministry Setting">
          <ChipGroup items={MINISTRY_SETTINGS} selected={local.ministrySettings} onToggle={(v) => toggle('ministrySettings', v)} />
        </FieldSection>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-3 border-t border-gray-200">
        <button
          onClick={() => onSave(local)}
          className="px-4 py-2 bg-blue-500 text-white text-xs font-medium rounded-lg hover:bg-blue-600 transition-colors"
        >
          Save Preferences
        </button>
        <button
          onClick={onClear}
          className="px-4 py-2 bg-white text-gray-600 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Clear All
        </button>
      </div>
    </div>
  );
}

function FieldSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function ChipGroup({ items, selected, onToggle }: { items: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(item => {
        const active = selected.includes(item);
        return (
          <button
            key={item}
            onClick={() => onToggle(item)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              active
                ? 'bg-blue-100 text-blue-800 border-blue-300'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

function parseNumber(val: string): number | null {
  const cleaned = val.replace(/[$,k]/gi, '');
  const num = Number(cleaned);
  if (isNaN(num)) return null;
  // If user typed "80k" or "80", auto-scale small values for comp fields
  if (num > 0 && num < 1000 && val.toLowerCase().includes('k')) return num * 1000;
  return num;
}

function formatCompInput(val: number): string {
  if (val >= 1000) return `$${Math.round(val / 1000)}k`;
  return String(val);
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/PreferencesForm.tsx
git commit -m "feat: add PreferencesForm with toggle chips, range inputs, and state selector"
```

---

### Task 5: Create PreferencesPanel component

**Files:**
- Create: `web/src/components/PreferencesPanel.tsx`

- [ ] **Step 1: Create the collapsible preferences panel**

Create `web/src/components/PreferencesPanel.tsx`:

```typescript
'use client';

import { useState } from 'react';
import type { SearchPreferences } from '@/lib/types';
import { countActivePreferences } from '@/hooks/usePreferences';

interface PreferencesPanelProps {
  prefs: SearchPreferences;
  onToggleDetailed: (detailed: boolean) => void;
}

export default function PreferencesPanel({ prefs, onToggleDetailed }: PreferencesPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const activeCount = countActivePreferences(prefs);

  if (activeCount === 0) return null;

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700">My Preferences</span>
          <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
            {activeCount} active
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label
            className="flex items-center gap-1.5 text-[11px] text-gray-500"
            onClick={(e) => e.stopPropagation()}
          >
            <span>Detailed</span>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleDetailed(!prefs.showDetailedMatch); }}
              className={`relative w-8 h-[18px] rounded-full transition-colors ${
                prefs.showDetailedMatch ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-[2px] w-[14px] h-[14px] bg-white rounded-full transition-transform ${
                  prefs.showDetailedMatch ? 'right-[2px]' : 'left-[2px]'
                }`}
              />
            </button>
          </label>
          <span className={`text-gray-400 text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}>
            &#9660;
          </span>
        </div>
      </button>

      {/* Expanded summary */}
      {expanded && (
        <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center gap-3">
          {prefs.positionTypes.length > 0 && (
            <PrefChips label="Types" values={prefs.positionTypes} />
          )}
          {prefs.regions.length > 0 && (
            <PrefChips label="Regions" values={prefs.regions} />
          )}
          {prefs.states.length > 0 && (
            <PrefChips label="States" values={prefs.states} />
          )}
          {(prefs.asaMin != null || prefs.asaMax != null) && (
            <PrefRange label="ASA" min={prefs.asaMin} max={prefs.asaMax} />
          )}
          {(prefs.compMin != null || prefs.compMax != null) && (
            <PrefRange label="Comp" min={prefs.compMin} max={prefs.compMax} format="comp" />
          )}
          {prefs.housing != null && (
            <PrefChips label="Housing" values={[prefs.housing === 'either' ? 'Either' : prefs.housing === 'rectory' ? 'Rectory' : 'Allowance']} />
          )}
          {prefs.ministrySettings.length > 0 && (
            <PrefChips label="Setting" values={prefs.ministrySettings} />
          )}
          <a
            href="/me#preferences"
            className="text-[11px] text-blue-500 hover:text-blue-700 ml-auto"
          >
            Edit in Dashboard &rarr;
          </a>
        </div>
      )}
    </div>
  );
}

function PrefChips({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-gray-500 font-medium">{label}:</span>
      {values.map(v => (
        <span key={v} className="px-1.5 py-0.5 rounded-full text-[11px] bg-blue-100 text-blue-800">
          {v}
        </span>
      ))}
    </div>
  );
}

function PrefRange({ label, min, max, format }: { label: string; min: number | null; max: number | null; format?: 'comp' }) {
  const fmt = (v: number) => format === 'comp' ? `$${Math.round(v / 1000)}k` : String(v);
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-gray-500 font-medium">{label}:</span>
      <span className="text-[11px] text-gray-700">
        {min != null ? fmt(min) : '...'} - {max != null ? fmt(max) : '...'}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/PreferencesPanel.tsx
git commit -m "feat: add collapsible PreferencesPanel with summary chips and detail toggle"
```

---

### Task 6: Add MATCH column to PositionTable and sort boost

**Files:**
- Modify: `web/src/components/PositionTable.tsx`

- [ ] **Step 1: Read PositionTable.tsx fully to understand the current structure**

Read `web/src/components/PositionTable.tsx` in its entirety to understand where to add imports, props, the MATCH column in both desktop and mobile views, and the sort logic.

- [ ] **Step 2: Add match-related imports and props**

Add to the imports at the top of `web/src/components/PositionTable.tsx`:

```typescript
import MatchBadge from './MatchBadge';
import type { SearchPreferences } from '@/lib/types';
import { scorePosition } from '@/lib/match-helpers';
import { hasActivePreferences } from '@/hooks/usePreferences';
```

Add to `PositionTableProps`:

```typescript
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
```

- [ ] **Step 3: Compute match scores and apply sort boost**

Inside the component function, after destructuring props, compute match scores:

```typescript
const showMatch = preferences ? hasActivePreferences(preferences) : false;

const matchScores = useMemo(() => {
  if (!showMatch || !preferences) return new Map<string, ReturnType<typeof scorePosition>>();
  const map = new Map<string, ReturnType<typeof scorePosition>>();
  for (const pos of positions) {
    map.set(pos.id, scorePosition(pos, preferences));
  }
  return map;
}, [positions, preferences, showMatch]);
```

In the sort logic, after the existing sort comparator, add a secondary match boost. Find the existing sort function and wrap it to add match score as a tiebreaker. Positions with score >= 50 should float above those below 50 when the primary sort values are equal.

- [ ] **Step 4: Add MATCH column to the desktop table header**

In the COLUMNS array or the header row rendering, conditionally add a MATCH column before the existing columns (only if `showMatch` is true).

- [ ] **Step 5: Add MATCH column to desktop table rows**

In the row rendering, add a `<td>` for the match badge before the existing cells (only if `showMatch` is true):

```typescript
{showMatch && (
  <td className="px-3 py-2">
    {matchScores.get(pos.id) && (
      <MatchBadge
        tier={matchScores.get(pos.id)!.tier}
        reasons={matchScores.get(pos.id)!.reasons}
        detailed={preferences?.showDetailedMatch ?? true}
      />
    )}
  </td>
)}
```

- [ ] **Step 6: Add match badge to mobile card layout**

In the mobile card rendering, add the match badge inline (badge only, no reasons regardless of detail mode):

```typescript
{showMatch && matchScores.get(pos.id)?.tier !== 'none' && (
  <MatchBadge
    tier={matchScores.get(pos.id)!.tier}
    reasons={[]}
    detailed={false}
  />
)}
```

- [ ] **Step 7: Build to verify**

Run: `cd web && npx next build`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/PositionTable.tsx
git commit -m "feat: add conditional MATCH column with score-based sort boost to PositionTable"
```

---

### Task 7: Add Preferences tab to /me dashboard

**Files:**
- Modify: `web/src/app/me/page.tsx`

- [ ] **Step 1: Read me/page.tsx fully**

Read `web/src/app/me/page.tsx` to understand the current tab system and data loading.

- [ ] **Step 2: Add imports and integrate usePreferences**

Add imports:

```typescript
import PreferencesForm from '@/components/PreferencesForm';
import { usePreferences } from '@/hooks/usePreferences';
```

Inside `DashboardContent`, add the preferences hook:

```typescript
const [prefs, savePrefs, clearPrefs] = usePreferences();
```

- [ ] **Step 3: Add 'preferences' to the tab system**

Update the tab type to include 'preferences':

```typescript
const [activeTab, setActiveTab] = useState<'compensation' | 'career' | 'positions' | 'preferences'>('compensation');
```

Update the tab rendering array:

```typescript
{(['compensation', 'career', 'positions', 'preferences'] as const).map(tab => (
  <button
    key={tab}
    onClick={() => setActiveTab(tab)}
    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? 'border-blue-500 text-blue-600'
        : 'border-transparent text-gray-500 hover:text-gray-700'
    }`}
  >
    {tab === 'compensation' ? 'Compensation' : tab === 'career' ? 'Career' : tab === 'positions' ? 'Positions' : 'Preferences'}
  </button>
))}
```

- [ ] **Step 4: Add Preferences tab content**

Add after the positions tab content:

```typescript
{activeTab === 'preferences' && (
  <div className="bg-white border border-gray-200 rounded-lg p-4">
    <PreferencesForm prefs={prefs} onSave={savePrefs} onClear={clearPrefs} />
  </div>
)}
```

- [ ] **Step 5: Allow access without claimed identity**

The current code redirects to `/claim` if no token is found. Modify the useEffect to allow access when the URL hash is `#preferences`:

In the useEffect, change the redirect logic:

```typescript
if (!token) {
  // Allow access to preferences tab without a token
  if (window.location.hash === '#preferences') {
    setActiveTab('preferences');
    setLoading(false);
    return;
  }
  router.push('/claim');
  return;
}
```

Also handle the hash on initial load:

```typescript
useEffect(() => {
  if (window.location.hash === '#preferences') {
    setActiveTab('preferences');
  }
}, []);
```

When no token is present, only show the Preferences tab (hide the other tabs that require personal data):

```typescript
const availableTabs = userData
  ? (['compensation', 'career', 'positions', 'preferences'] as const)
  : (['preferences'] as const);
```

Use `availableTabs` instead of the hardcoded array in the tab rendering.

- [ ] **Step 6: Build to verify**

Run: `cd web && npx next build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/me/page.tsx
git commit -m "feat: add Preferences tab to dashboard, accessible without claimed identity"
```

---

### Task 8: Integrate preferences into Positions page

**Files:**
- Modify: `web/src/app/page.tsx`

- [ ] **Step 1: Read page.tsx fully**

Read `web/src/app/page.tsx` (already read above, but re-read if needed for the subagent).

- [ ] **Step 2: Add imports**

Add to the imports:

```typescript
import PreferencesPanel from '@/components/PreferencesPanel';
import { usePreferences, hasActivePreferences } from '@/hooks/usePreferences';
```

- [ ] **Step 3: Add usePreferences hook and save handler**

Inside `PositionsPageContent`, add:

```typescript
const [prefs, savePrefs] = usePreferences();

const handleToggleDetailed = useCallback((detailed: boolean) => {
  savePrefs({ ...prefs, showDetailedMatch: detailed });
}, [prefs, savePrefs]);
```

- [ ] **Step 4: Add PreferencesPanel between the filters and the table**

Insert the PreferencesPanel after the `<Filters>` component and before the `{filters.view === 'table' ? (` block:

```typescript
<PreferencesPanel prefs={prefs} onToggleDetailed={handleToggleDetailed} />
```

- [ ] **Step 5: Pass preferences to PositionTable**

Update the PositionTable call to pass preferences:

```typescript
<PositionTable
  positions={displayedPositions}
  initialSortField={filters.sort.field}
  initialSortDir={filters.sort.direction}
  initialExpandedId={filters.expandedId}
  onExpandedChange={filterActions.setExpandedId}
  preferences={prefs}
/>
```

- [ ] **Step 6: Build to verify**

Run: `cd web && npx next build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/page.tsx
git commit -m "feat: integrate PreferencesPanel and match scoring into Positions page"
```

---

### Task 9: Build verification and visual testing

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

Verify:

1. **Positions page (/) with no preferences:** No MATCH column, no PreferencesPanel, everything works as before.

2. **Set preferences via /me#preferences:** Navigate to /me#preferences (no token needed). Set position types, regions, etc. Save.

3. **Positions page (/) with preferences:**
   - PreferencesPanel visible with active count and chips
   - MATCH column appears with Strong/Good/Partial badges
   - Detailed mode shows match reasons
   - Toggle to simple mode hides reasons
   - Positions with higher match scores sort higher

4. **Dashboard (/me) with token:** All 4 tabs visible. Preferences tab shows saved values.

5. **Mobile:** MATCH column shows badge only. Panel collapses to label.

- [ ] **Step 3: Fix any issues found**

Address build errors, runtime errors, or visual issues.

- [ ] **Step 4: Final commit if needed**

```bash
git add -A
git commit -m "fix: integration fixes for Phase 4B preferences and matching"
```
