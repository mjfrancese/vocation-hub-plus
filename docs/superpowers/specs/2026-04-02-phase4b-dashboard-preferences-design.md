# Phase 4B: Dashboard Preferences & Position Matching - Design Spec

**Date:** 2026-04-02
**Status:** Approved

## Overview

Add search preferences that let priests (and any visitor) describe what they're looking for in a position. Preferences drive two things: smart filter defaults on the Positions page, and a match scoring system that ranks and labels positions by relevance.

**Primary users:** Episcopal priests exploring the job market; vestry members benchmarking.
**Core principle:** Preferences surface the best matches first without hiding anything. A priest in discernment may not know exactly what they want -- the system helps, not restricts.

---

## 1. Preferences Data Model & Storage

### Interface

```typescript
interface SearchPreferences {
  positionTypes: string[];       // ["Rector", "Vicar", ...]
  regions: string[];             // ["Northeast", "Southeast", ...]
  states: string[];              // ["NY", "CT", "MA", ...]
  asaMin: number | null;         // e.g., 50
  asaMax: number | null;         // e.g., 200
  compMin: number | null;        // e.g., 80000
  compMax: number | null;        // e.g., 120000
  housing: 'rectory' | 'allowance' | 'either' | null;
  ministrySettings: string[];    // ["Urban", "Suburban", ...]
  showDetailedMatch: boolean;    // true = show match reasons, false = badge only
}
```

### Storage

- localStorage key: `vh_search_prefs`
- No claimed identity required -- works for all visitors
- Empty arrays and null values mean "no preference" (match everything)
- A `usePreferences()` hook handles read/write/defaults

### Available Values

**Position types:** Rector, Vicar, Priest-in-Charge, Assistant, Associate, Curate, Dean, Interim, Canon, Other

**Regions:** Northeast, Southeast, Midwest, West, Southwest (same mapping as `analytics-helpers.ts` STATE_TO_REGION)

**States:** All US state abbreviations (populated from positions data)

**Ministry settings:** Urban, Suburban, Small Town, Rural

**Housing:** Rectory, Housing Allowance, Either

---

## 2. Match Scoring

### Scoring Function

A pure function `scorePosition(pos: Position, prefs: SearchPreferences)` in `match-helpers.ts` computes a match score (0-100).

### Scoring Weights

| Criterion | Points | Logic |
|-----------|--------|-------|
| Position type | 25 | Full points if any of the position's types match any preferred type |
| Region | 15 | Full points if position's state falls in a preferred region |
| State | 15 | Full points if position's state is in preferred states list |
| ASA range | 15 | Full points if within range; half points if within 25% of bounds |
| Comp range | 15 | Full points if within range; half points if within 15% of bounds |
| Housing | 5 | Full points if matches preference |
| Ministry setting | 10 | Full points if position's setting matches any preferred setting |

### Score Normalization

Only criteria with active preferences (non-empty, non-null) contribute to the total. The score is rescaled to 100 based on the maximum possible points from active criteria.

Example: if a priest only sets position type (25pts) and region (15pts), the max is 40. A position matching both gets 40/40 = 100.

### Match Tiers

| Tier | Score Range | Badge Color | Shown In |
|------|------------|-------------|----------|
| Strong match | 75-100 | Green (#dcfce7 bg, #166534 text) | Both modes |
| Good match | 50-74 | Blue (#dbeafe bg, #1d4ed8 text) | Both modes |
| Partial match | 25-49 | Gray (#f3f4f6 bg, #6b7280 text) | Detailed mode only |
| No match | 0-24 | No badge | Neither mode |

### Match Reasons

`scorePosition` also returns a `reasons: string[]` array listing which criteria matched (e.g., `["Rector", "Northeast", "ASA range"]`). Used in detailed display mode.

---

## 3. UI: Preferences Tab on /me Dashboard

### Location

New fourth tab on the /me page: Compensation | Career | Positions | **Preferences**

### Layout

Compact form with toggle chips for multi-select fields and range inputs for numeric fields:

- **Position Types** -- toggle chip row (all canonical types)
- **Regions** -- toggle chip row (5 regions)
- **States** -- multi-select dropdown with selected states shown as pills
- **Church Size (ASA)** -- min/max number inputs, side by side
- **Compensation** -- min/max inputs (accepts values like "80k" or "80000"), side by side
- **Housing** -- single-select chip row (Rectory / Allowance / Either)
- **Ministry Setting** -- toggle chip row
- **Save Preferences** and **Clear All** buttons at the bottom

### Behavior

- Toggle chips use the same blue highlight pattern as status filter chips on the Positions page
- Save writes to localStorage immediately
- Clear All resets all fields to empty/null defaults
- No claimed identity required -- this tab is accessible even without a clergy token. If the user isn't claimed, the /me page shows only the Preferences tab (no Compensation, Career, or Positions tabs since those require personal data)

---

## 4. UI: Positions Page Integration

### MATCH Column

A new MATCH column appears in the position table **only when preferences are set** (at least one non-empty/non-null field). When no preferences exist, the column is hidden and no scoring runs.

**Detailed mode (default, `showDetailedMatch: true`):**
- Tier badge ("Strong match", "Good match", "Partial match")
- Below the badge: matched criteria as comma-separated text (e.g., "Rector, Northeast, ASA range")

**Simple mode (`showDetailedMatch: false`):**
- Tier badge only ("Strong", "Good", "Partial")
- No criteria text

### Quick-Edit Preferences Panel

A collapsible panel between the filter bar and the table:

**Collapsed state (default):**
- "My Preferences" label with active count badge (e.g., "3 active")
- Detailed/Simple toggle switch
- Expand arrow

**Expanded state:**
- Compact inline display of current preferences as chips/values
- "Edit in Dashboard" link to /me#preferences
- Same expand/collapse toggle

The panel does NOT duplicate the full preference editor. It shows a read-only summary with a link to the full editor on /me.

### Sort Boost

When preferences are active, positions are sorted with match score as a secondary sort key within the current primary sort. For example, if sorted by "Date Posted", positions with the same date are ordered by match score descending. Positions with match scores >= 50 ("Good" or better) float above unmatched positions regardless of the primary sort.

### Mobile

- MATCH column shows only the tier badge (no criteria text, regardless of detail mode)
- Quick-edit panel collapses to just the "My Preferences (3)" label with toggle
- Mobile card layout shows the match badge inline with status

---

## 5. Smart Filter Defaults

### Pre-fill Logic

When the Positions page loads with no URL filter parameters:

1. Check localStorage for `vh_search_prefs`
2. If preferences exist, map them to filter controls:
   - `positionTypes` -> Position Type filter
   - `regions` -> Region filter
   - `states` -> State filter
   - `compMin/compMax` -> Compensation filter (mapped to closest bracket)
   - `housing` -> Housing filter
   - `ministrySettings` -> Setting filter
   - ASA has no existing filter control; it only affects match scoring
3. Show a "Filtered by your preferences" indicator near the filter bar
4. Include a "Clear preference filters" action to reset to the default view

### Override Rules

- URL parameters always override preferences (shared links work correctly)
- Once a priest manually changes any filter during a session, that manual choice sticks
- Preferences only auto-apply on first load with no URL params

---

## Component Changes Summary

| File | Change |
|------|--------|
| `web/src/lib/match-helpers.ts` | **New.** `scorePosition()`, match tier logic, reasons extraction |
| `web/src/hooks/usePreferences.ts` | **New.** localStorage read/write hook for SearchPreferences |
| `web/src/components/PreferencesForm.tsx` | **New.** Full preferences editor (toggle chips, range inputs, save/clear) |
| `web/src/components/PreferencesPanel.tsx` | **New.** Collapsible quick-edit summary panel for Positions page |
| `web/src/components/MatchBadge.tsx` | **New.** Match tier badge + optional reasons text |
| `web/src/components/PositionTable.tsx` | **Modify.** Add MATCH column (conditional on prefs), integrate sort boost |
| `web/src/app/me/page.tsx` | **Modify.** Add Preferences tab, allow access without claimed identity |
| `web/src/app/page.tsx` | **Modify.** Integrate PreferencesPanel, smart filter defaults, pass match data to table |
| `web/src/hooks/useFilterState.ts` | **Modify.** Accept initial filter values from preferences on first load |
| `web/src/lib/types.ts` | **Modify.** Add SearchPreferences interface |

---

## Scope Boundaries

**In scope:**
- SearchPreferences data model and localStorage persistence
- usePreferences hook
- Match scoring with normalized weights and tier badges
- Preferences tab on /me (works without claimed identity)
- MATCH column on Positions page with detailed/simple toggle
- Quick-edit preferences panel on Positions page (read-only summary + link to /me)
- Smart filter defaults from preferences
- Mobile responsive layout for all new components

**Out of scope:**
- Saved/bookmarked positions (future work)
- Timeline/move readiness (future work)
- Server-side preference storage (everything is localStorage)
- Preference sharing or export
- Position type filter in quick-edit panel (full editing only on /me)
