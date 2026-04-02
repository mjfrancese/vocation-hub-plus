# Phase 3: Navigation, Filtering & Information Architecture - Design Spec

**Date:** 2026-04-02
**Status:** Approved

## Overview

Improve how priests find, filter, and navigate to positions. Five changes delivered as one cohesive update: rename "Directory Only" to "Unlisted" with smarter defaults, persist all filter state in URL params for shareable links, add date-based sorting and filtering, enhance map pins with rich info cards, and update the About page with data source transparency.

**Primary user:** Episcopal priests exploring position opportunities.
**Core principle:** Never present data in a way that makes priests think something is a real, active opportunity when it may not be. Make filtered views shareable. Surface what's new.

---

## 1. Naming & Default View

### Rename: "Directory Only" to "Unlisted"

Every reference to "Directory Only" in the codebase becomes "Unlisted":
- Status chip label and color
- `UnifiedStatusBadge.tsx` badge text
- `status-helpers.ts` status computation
- `QualityBadge.tsx` display text (currently shows "Directory - 85")
- URL param value: `unlisted` (not `directory`)
- All comments and type annotations

The "Unlisted" badge keeps the current blue color treatment -- it's a neutral informational label, not a warning.

### Smart Default View

On page load with no URL parameters, the following positions are shown:

**Always shown:**
- Status is Active, New, Interim, or Developing

**Conditionally shown (qualifying Unlisted):**
- Status is Unlisted AND all of:
  - Quality score >= 85
  - Has a `receiving_names_from` date within the last 12 months
  - Has parochial data (at least one year of data)

Qualifying Unlisted positions appear in the default view but retain their "Unlisted" badge so priests can distinguish them from confirmed active searches.

### Status Chips Replace "Hide Closed"

Remove the "Hide closed" checkbox. The status chips become the primary filter mechanism:

- On load: Active, New, Interim, Developing chips are pre-selected (filled/active state)
- Unlisted and Closed chips are deselected (outlined/inactive state)
- Qualifying Unlisted positions appear even when the Unlisted chip is deselected (they passed the quality gate)
- Clicking the Unlisted chip explicitly shows ALL Unlisted positions (including low-quality ones)
- Clicking the Closed chip shows Closed positions
- Each chip shows its count as today: "Active (169)"

This is more intuitive than the current checkbox + chip hybrid. The chips ARE the filter.

---

## 2. URL-Persisted Filter State

### URL Parameter Schema

All filter state is encoded in URL search parameters:

| Parameter | Format | Example | Default (no param) |
|-----------|--------|---------|---------------------|
| `status` | Comma-separated lowercase | `active,new,interim` | Smart defaults (see Section 1) |
| `state` | Comma-separated state abbreviations | `GA,NC` | All |
| `diocese` | Comma-separated diocese names | `Atlanta,Connecticut` | All |
| `type` | Comma-separated canonical types | `rector,vicar` | All |
| `comp` | Comma-separated range keys | `50k-75k,75k-100k` (matches existing dropdown ranges: `0-25k`, `25k-50k`, `50k-75k`, `75k-100k`, `100k-125k`, `125k+`) | All |
| `region` | Comma-separated | `Southeast,Northeast` | All |
| `setting` | Comma-separated | `suburban,urban` | All |
| `housing` | Comma-separated | `rectory,allowance` | All |
| `healthcare` | Comma-separated | `clergy-only,family` | All |
| `posted` | Shorthand duration | `7d`, `30d`, `90d`, `6m`, `1y` | All time |
| `sort` | `field:direction` | `date:desc` | `date:desc` |
| `q` | Search text | `atlanta rector` | Empty |
| `view` | `table` or `map` | `map` | `table` |
| `expanded` | Position ID | `vh_8529` | None |

### Behavior

- **No params = smart defaults.** The page loads with the smart default view from Section 1. No URL clutter for the common case.
- **Filter changes update URL.** Every filter interaction calls `router.replace()` to update params without creating history entries for each tweak.
- **Back button works.** Major navigation actions (switching views, expanding a position) use `router.push()` to create history entries.
- **Shareable.** Copy URL, send to colleague, they see the same filtered view with the same position expanded.
- **Clean URLs.** Parameters at their default values are omitted. A URL with just `/?expanded=vh_8529` means "default filters, this position open."

### Implementation: `useFilterState()` Hook

A single custom hook encapsulates all filter state read/write:

```typescript
interface FilterState {
  statuses: string[];
  states: string[];
  dioceses: string[];
  types: string[];
  compensationRanges: string[];
  regions: string[];
  settings: string[];
  housingTypes: string[];
  healthcareOptions: string[];
  postedWithin: string | null;    // '7d', '30d', '90d', '6m', '1y', or null
  sort: { field: SortField; direction: SortDirection };
  query: string;
  view: 'table' | 'map';
  expandedId: string | null;
}

function useFilterState(): [FilterState, FilterActions]
```

The hook reads from `useSearchParams()` on mount, applies defaults for missing params, and returns the current state plus setter functions. Filter components call the setters exactly as they call `useState` setters today -- the URL persistence is transparent to them.

The existing `useState` calls in `page.tsx` are replaced by destructuring from this hook. `Filters.tsx` receives the same props interface.

---

## 3. Date-Based Sorting & Filtering

### New Sort Options

The `SortField` type expands:

```typescript
type SortField = 'name' | 'diocese' | 'date' | 'updated' | 'firstseen' | 'quality_score';
```

- `date` replaces `receiving_names_from` (shorter, same meaning)
- `updated` sorts by `updated_on_hub`
- `firstseen` sorts by `first_seen`

**Default sort changes to `date:desc`** (newest posted first). This is what priests care about on landing.

### Desktop Column Headers

The "DATES" column header becomes a dropdown selector for which date to display/sort by:
- "Date Posted" (default) -- `receiving_names_from`
- "Last Updated" -- `updated_on_hub`
- "First Seen" -- `first_seen`

Clicking the selected option toggles sort direction (asc/desc) as column headers already do. Selecting a different date option switches both the displayed date and the sort field.

### Mobile Sort Dropdown

The mobile sort dropdown adds the new options:
- Church Name
- Diocese
- Date Posted (default)
- Last Updated
- First Seen
- Quality Score

### Date Range Filter ("Posted Within")

A new dropdown filter added to the filter bar:

**Label:** "Posted"
**Options:**
- Last 7 days
- Last 30 days
- Last 90 days
- Last 6 months
- Last year
- All time (default)

**Filter logic:** Position passes if `receiving_names_from` (parsed as date) is within the selected range. Falls back to `first_seen` if `receiving_names_from` is missing. Positions with neither date are excluded when a date range is active.

**URL param:** `posted=30d` (see Section 2 table)

### Table Date Column Display

The "Dates" column adapts to the current sort:

| Sort Field | Primary Date | Secondary Date |
|------------|-------------|----------------|
| Date Posted | `receiving_names_from` | "Updated [date]" if available |
| Last Updated | `updated_on_hub` | `receiving_names_from` |
| First Seen | `first_seen` | `receiving_names_from` |
| Other (name, etc.) | `receiving_names_from` | "Updated [date]" if available |

---

## 4. Map View Enhancements

### Rich Info Card on Pin Click

Replace the current minimal Leaflet popup with a styled card containing:

```
+----------------------------------+
| Church Name              [Badge] |
| Rector/Priest-in-Charge          |
| City, ST                         |
|                                  |
| ASA: 150 (↑12%)    Comp: $95k   |
|                                  |
| [View full details]              |
+----------------------------------+
```

**Card contents:**
- Church name (bold)
- Position type (canonical, not raw VH string)
- Status badge (same component as table view)
- City, State
- ASA value + trend arrow (up/down/flat with percentage)
- Estimated total comp (if available)
- "View full details" button

**"View full details" behavior:** Switches to table view with that position expanded. Updates URL to `/?view=table&expanded=vh_1234` (preserving all other active filters). The table scrolls to the expanded position.

**Implementation:** Same Leaflet `L.popup()` mechanism, just with richer HTML content built from position data. No new component framework needed. Style the popup content with inline styles or a scoped CSS class to avoid Leaflet theme conflicts.

### Navigation Improvements

- Clicking "Positions" in the nav bar while in map view switches to table view (sets `view=table` in URL) instead of reloading the page
- The `view=map` URL param preserves map view across shares
- Map respects all active filters -- pins only show for positions that pass the current filter set
- Map initial bounds fit to visible pins (don't always default to continental US if filters narrow to one state)

### Out of Scope

- No detail panel overlay on the map itself (layout complexity not worth it)
- No geographic proximity search ("within 50 miles") -- Phase 4 feature
- No custom map tiles or styling

---

## 5. About Page Update

### New "Data Sources" Section

Add after the "How it works" section:

**Section heading:** "Where the Data Comes From"

**Content:** A grid/list of data sources, each with name, brief description, and what it contributes:

| Source | What It Provides |
|--------|-----------------|
| **VocationHub** (episcopalchurch.org) | Position listings, profile fields, search status, contact info |
| **Episcopal Asset Map** | Church directory: addresses, phone, email, coordinates |
| **ECDPlus** | Extended church directory cross-reference |
| **Parochial Reports** | Annual congregation data: attendance, giving, membership (2015-2024) |
| **Church Pension Group** | Clergy compensation benchmarks by diocese, position type, church size |
| **US Census Bureau (ACS 5-Year)** | Median household income and population by zip code |

Each source name is a link to the source's public website where applicable.

### Updated "How It Works"

Simplify to reflect current pipeline: "We collect position data from VocationHub daily, then enrich each listing with church directory info, parochial report history, compensation benchmarks, and census demographics. The result is a unified view that no single source provides on its own."

### Stats Cards

Update labels to use the new status names. Replace "Directory" count with "Unlisted" count. Add an "Unlisted" card if not already present.

### No Other Changes

Disclaimer, intro, and features list remain as-is.

---

## Component Changes Summary

| File | Change |
|------|--------|
| `web/src/app/page.tsx` | Replace all `useState` filter state with `useFilterState()` hook; remove "Hide closed" logic; update default filter computation; add `posted` filter |
| `web/src/hooks/useFilterState.ts` | **New file.** Custom hook: reads/writes URL search params, applies smart defaults, exposes FilterState + FilterActions |
| `web/src/components/Filters.tsx` | Add "Posted" dropdown; receive state from hook instead of props (or keep props -- hook lives in page.tsx) |
| `web/src/components/PositionTable.tsx` | Add `updated` and `firstseen` sort options; adapt date column display to current sort; update mobile sort dropdown |
| `web/src/components/MapView.tsx` | Replace minimal popup with rich info card HTML; add "View full details" click handler; fit bounds to filtered pins |
| `web/src/components/UnifiedStatusBadge.tsx` | Rename "Directory Only" to "Unlisted" |
| `web/src/components/QualityBadge.tsx` | Rename "Directory" to "Unlisted" in display text |
| `web/src/lib/status-helpers.ts` | Rename directory status; add `isQualifyingUnlisted()` function for smart defaults |
| `web/src/lib/types.ts` | Update `SortField` type; add `'unlisted'` to visibility type |
| `web/src/app/about/page.tsx` | Add data sources section; update how-it-works text; update stats card labels |

---

## Scope Boundaries

**In scope:**
- "Directory Only" to "Unlisted" rename throughout
- Smart default view with qualifying Unlisted threshold
- Status chips as primary filter (remove "Hide closed" checkbox)
- All filter state in URL search params
- `useFilterState()` hook
- Shareable URLs with expanded position support
- Date range filter ("Posted within")
- New sort fields: Last Updated, First Seen
- Default sort: date:desc
- Adaptive date column display
- Rich map pin info cards
- Map "View full details" navigates to table with position expanded
- Map bounds fit to filtered pins
- About page data sources section

**Out of scope:**
- Detail panel rendered on the map
- Geographic proximity search
- Custom map tiles
- Saved/bookmarked filter presets
- Personal context / logged-in features (Phase 4)
- Analytics page fixes (Phase 4)
