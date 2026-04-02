# Phase 4A: Analytics Redesign & Status Display Unification - Design Spec

**Date:** 2026-04-02
**Status:** Approved

## Overview

Three connected improvements: unify how position status is displayed across the site, replace plain-text tooltips with a styled popover, and rebuild the analytics page with useful charts driven by real data.

**Primary users:** Episcopal priests scanning the job market; vestry members benchmarking compensation.
**Core principle:** Every chart should help someone make a decision. If it doesn't, cut it.

---

## 1. Status Display Unification

### The Problem

The STATUS column in the position table uses `QualityBadge`, which shows visibility-based labels:
- `visibility: 'public'` -> "Active Listing" (green)
- `visibility: 'extended'` -> "Unlisted . 72" (blue, with quality score)
- `visibility: 'extended_hidden'` -> "Incomplete . 48" (gray)

The filter chips use `getUnifiedStatus()`, which shows VH-status-based labels: Active, Developing, Interim, Closed, Unlisted.

A position with `vh_status: 'Developing profile'` and `visibility: 'extended'` displays as "Unlisted . 72" in the table but filters as "Developing." This is confusing.

### The Fix

The STATUS column shows the **unified status** as the primary label, with the quality score as a secondary indicator.

**Display rules:**

| Visibility | VH Status | Badge | Score Shown? |
|------------|-----------|-------|-------------|
| `public` | Any recognized | UnifiedStatusBadge (Active/Developing/Interim) | No |
| `public` | None/unrecognized | UnifiedStatusBadge (Active) | No |
| `extended` | Active-like | UnifiedStatusBadge (Active) + score pill | Yes |
| `extended` | Developing-like | UnifiedStatusBadge (Developing) + score pill | Yes |
| `extended` | Interim-like | UnifiedStatusBadge (Interim) + score pill | Yes |
| `extended` | Closed-like | UnifiedStatusBadge (Closed) + score pill | Yes |
| `extended` | None/unrecognized | UnifiedStatusBadge (Unlisted) + score pill | Yes |
| `extended_hidden` | Any | UnifiedStatusBadge (matching status) + score pill | Yes |

**Score pill:** A small inline element after the status badge showing the numeric score (e.g., "72"). Styled as a subtle pill (gray background, small text). Clicking/hovering opens the StatusPopover.

**What changes:**
- `QualityBadge` is no longer used in the position table STATUS column
- The STATUS column renders `UnifiedStatusBadge` + optional `ScorePill`
- `QualityBadge` remains available for other contexts (e.g., if needed elsewhere) but is not the primary status display
- The `QualityScoreDetail` component (expanded panel) is unaffected

---

## 2. StatusPopover Component

### The Problem

`QualityBadge` renders tooltip text as a plain string dump. `UnifiedStatusBadge` uses the browser's native `title` attribute (unstyled gray tooltip). Neither provides good UI.

### The Fix

A new `StatusPopover` component provides styled hover/click popovers for status information.

**Two variants based on whether the position has a quality score:**

**With score (extended positions):**
```
+----------------------------------+
| Quality: 72/100                  |
| [========--------] progress bar  |
|                                  |
| Active status (25)          [x]  |
| Recent date (15)            [x]  |
| Congregation identified (10)[x]  |
| Position named (5)          [x]  |
| Church matched (10)         [ ]  |
| Parochial data (10)         [x]  |
| ...                              |
+----------------------------------+
```

- Score as bold header with progress bar
- Criteria checklist with checkmarks/dashes (reuses data from `quality_components`)
- Same data as `QualityScoreDetail` but rendered in a popover

**Without score (public positions):**
```
+----------------------------------+
| Active                           |
| This position appears in         |
| VocationHub's active search      |
| results.                         |
+----------------------------------+
```

- Status name as header
- One-line explanation of what the status means

**Behavior:**
- Desktop: show on hover, dismiss on mouse leave
- Mobile: toggle on tap
- Positioned below the trigger element, right-aligned to avoid viewport overflow
- Same interaction pattern currently in `QualityBadge` (mouseenter/mouseleave + click toggle)

**Component interface:**
```typescript
interface StatusPopoverProps {
  pos: Position;
  children: React.ReactNode;  // The trigger element (badge + optional score pill)
}
```

The popover wraps whatever trigger element is passed as children. This keeps it reusable.

---

## 3. Analytics Page Redesign

### Data Source

Replace `all-profiles.json` (42 deep scrape profiles, wrong format) with `getPositions()` from `data.ts` (same as Positions page). Filter using `passesDefaultFilter()` from `filter-defaults.ts`.

No user-facing filter controls. No toggle. The page always shows the current market snapshot.

### Summary Cards

Four cards across the top:

| Card | Value | Computation |
|------|-------|-------------|
| Open Positions | Count | `filteredPositions.length` |
| Median Total Comp | Dollar amount | Median of `estimated_total_comp` where available |
| Most Common Type | Position type name | Mode of flattened `position_types` arrays |
| Median ASA | Number | Median of latest-year `averageAttendance` from parochials |

Cards that can't be computed (e.g., no positions have comp data) show "--" instead of 0.

### Charts

Six charts in a 2-column responsive grid (stacks to 1 column on mobile).

**Chart 1: Compensation Distribution**
- Type: Horizontal bar chart
- Data: `estimated_total_comp` bucketed into ranges: $0-50k, $50-75k, $75-100k, $100-125k, $125k+
- Feature: Dashed vertical line at median
- Positions without `estimated_total_comp` are excluded from this chart
- Color: Blue (#3b82f6)

**Chart 2: Position Types**
- Type: Horizontal bar chart
- Data: Flattened `position_types` arrays, counted per canonical type
- Sorted by count descending
- Show top 8 types; group remainder as "Other"
- Color: Purple (#8b5cf6)

**Chart 3: Church Size (ASA)**
- Type: Horizontal bar chart
- Data: Latest-year `averageAttendance` from parochials, bucketed: 0-50, 51-100, 101-200, 201-500, 500+
- Positions without parochial data excluded
- Color: Green (#10b981)

**Chart 4: Compensation by Position Type**
- Type: Range chart (horizontal box showing 25th-75th percentile with median line)
- Data: `estimated_total_comp` grouped by canonical position type
- Only show types with >= 3 data points
- Median value labeled on the right
- Color: Blue range (#dbeafe fill, #1d4ed8 median line)

**Chart 5: Compensation by Church Size**
- Type: Range chart (same as Chart 4)
- Data: `estimated_total_comp` grouped by ASA bucket (0-50, 51-100, 101-200, 201+)
- Only show buckets with >= 3 data points
- Median value labeled on the right
- Color: Green range (#d1fae5 fill, #059669 median line)

**Chart 6: Positions by Region**
- Type: Horizontal bar chart
- Data: Position count grouped by region (Northeast, Southeast, Midwest, West, Southwest)
- Uses state-to-region mapping defined in `analytics-helpers.ts` (simple lookup: state abbreviation -> region name)
- Sorted by count descending
- Color: Amber (#f59e0b)

### Charts Not Included

These charts from the current page are removed:
- **Position Status pie** -- redundant with Positions page status chips
- **Top 20 Dioceses** -- too granular, not actionable
- **Top 25 States** -- replaced by regional grouping (Chart 6)
- **Ministry Setting pie** -- sparse data, most positions don't have this field
- **Geographic Region pie** -- replaced by Chart 6 as a bar chart
- **CPG Median Comp by Diocese** -- insight folded into Charts 4 and 5

### Recharts Usage

All charts use recharts (already installed). Specific components:
- `BarChart` / `Bar` for horizontal bar charts (Charts 1, 2, 3, 6)
- Custom SVG or `BarChart` with error bars for range charts (Charts 4, 5)
- `ReferenceLine` for median lines
- `ResponsiveContainer` for all charts
- `Tooltip` for hover values

### Mobile Layout

- Summary cards: 2x2 grid on mobile (instead of 4 across)
- Charts: single column, full width
- Chart order stays the same

---

## Component Changes Summary

| File | Change |
|------|--------|
| `web/src/components/StatusPopover.tsx` | **New.** Styled popover for status/quality information |
| `web/src/components/ScorePill.tsx` | **New.** Small inline quality score indicator |
| `web/src/components/PositionTable.tsx` | Replace `QualityBadge` in STATUS column with `UnifiedStatusBadge` + `ScorePill` wrapped in `StatusPopover` |
| `web/src/components/UnifiedStatusBadge.tsx` | Remove native `title` attribute (popover handles hover now) |
| `web/src/app/analytics/page.tsx` | **Full rewrite.** New data source, summary cards, 6 charts |
| `web/src/lib/analytics-helpers.ts` | **New.** Computation functions: median, percentiles, bucketing, region mapping |

---

## Scope Boundaries

**In scope:**
- Status column unification (UnifiedStatusBadge + ScorePill replaces QualityBadge in table)
- StatusPopover component with styled quality breakdown
- Analytics page full rewrite with 6 charts + summary cards
- Mobile responsive layout for analytics

**Out of scope:**
- QualityBadge removal from codebase (may still be used in other contexts)
- Extended data pipeline fixes (enrichment coverage is a separate concern)
- Dashboard/My Dashboard page (Phase 4B)
- Filter controls on analytics page
- Historical trend charts (would need time-series data we don't store)
