# Position Panel Redesign - Design Spec

**Date:** 2026-04-02
**Status:** Approved
**Mockup:** `web/public/mockup-panel.html`

## Overview

Redesign the expanded position detail panel from a source-organized block layout (18 separate sections with different colored borders per data source) into an integrated, insight-driven experience organized by the questions a priest would ask when evaluating a position.

**Primary user:** Episcopal priests exploring position opportunities.
**Core principle:** Data from multiple sources (VocationHub, Asset Map, ECDPlus, parochial reports, Census, CPG) should feel like it exists in one place, providing insights that no single source could offer alone.

---

## Panel Structure

### Layout: Inline Expansion with Sticky Header (Option C)

The panel expands as a full-width row below the selected position in the table (same as current). The key improvement: the header row (church name, metadata, tabs) sticks to the top of the viewport as the user scrolls through detail content.

**Selected row indicator:** 4px left border in primary-600 color, bg-primary-50/60 background on the selected table row. The expanded panel also carries the 4px left border.

### Sticky Header Contents

1. **Position header row:**
   - Church name (h2, font-semibold) + Status badge (green/blue/amber/gray)
   - Canonical position type pills (gray-100 bg, rounded, text-xs) + Work type badge (amber for interim, neutral otherwise) + Location + Diocese
   - Date line: "Receiving names since [date] | [end date or Open ended] | Posted [duration]"
   - Right-aligned: VocationHub link + Church website link

2. **Church selector (multi-church only):**
   - When a position serves multiple congregations, a row of compact pills appears between the header and tabs
   - Labeled "Serving N congregations" with church name + city for each pill
   - Visually distinct from content tabs: pill-shaped, different color treatment (e.g., outlined gray pills)
   - Selecting a church filters parish-specific data throughout all tabs; shared data (compensation, position details) stays constant

3. **Content tabs:**
   - Overview | Parish Data | Compensation | Profile
   - Standard horizontal tab bar with 2px bottom border on active tab (primary-600)
   - Tab component is configurable -- adding/removing/renaming a tab is a config change

### Tab Component Architecture

Build as a generic `DetailTabs` component:
```typescript
interface TabConfig {
  id: string;
  label: string;
  component: React.ComponentType<TabProps>;
}
```

Each tab is its own component file. The tab bar and content area are managed by `DetailTabs`. Adding a tab = adding a config entry and a component file.

---

## Tab 1: Overview (Default)

The integrated narrative view. Synthesizes data from all sources into priest-relevant insights.

### At-a-Glance Metrics Row

Four cards in a responsive grid (2 cols mobile, 4 cols desktop):

1. **Compensation** -- Estimated total comp (or "Interim Position" / position type if no comp data). Housing type as subtitle. Amber treatment for interim positions.
2. **Avg Sunday Attendance** -- Latest ASA value + trend percentage over available period
3. **Annual Giving** -- Latest plate & pledge + trend percentage
4. **Giving per Attendee** -- Plate & pledge / ASA, labeled "Annual plate & pledge / ASA"

Cards use `bg-gray-50 rounded-lg` except compensation card for interim positions which uses `bg-amber-50 border border-amber-200`.

### Narrative Sections

Each section has a small uppercase gray label header, followed by prose that weaves data from multiple sources. Key values are highlighted with `font-semibold text-primary-900` (navy). Trends use green (up) / red (down) coloring.

**PARISH HEALTH:**
- ASA with trend direction and percentage over the period
- Giving with trend direction, contextualized against attendance trend (e.g., "giving has moved in the opposite direction")
- Giving per attendee as a congregational commitment signal
- Diocese percentile rankings for ASA and giving
- Membership trend if data available (use most recent year with data, note the year)

**CLERGY STABILITY:**
- Current clergy name + title + tenure length (if available from clergy context data)
- Historical clergy count + average tenure (from parish_clergy_history)
- If interim: highlighted with amber inline badge
- Orders required

**WHAT THEY'RE LOOKING FOR:**
- Community hopes / position description from deep scrape fields (surfaced here, not buried in Profile tab)
- Desired skills / qualities if available
- Application instructions
- Contact info (name, title, email)

**SEARCH TIMELINE:**
- Receiving names since date
- End date or "open-ended"
- Time on market (duration since posting)

**CHURCH & COMMUNITY:**
- Address
- Church contact info (website, email, phone) as inline links
- Census context if available: median household income, population, compensation-to-local-income ratio
- Ministry setting if available from deep scrape

### Similar Positions

Below the narrative, separated by a subtle border-top. Grid of 3 cards (1 col mobile, 3 cols desktop). Each card shows: church name, location, canonical position type, ASA, estimated comp. Clickable to navigate to that position.

---

## Tab 2: Parish Data

The raw parochial data for data-oriented users.

### Summary Metrics

Three cards: ASA, Membership, Plate & Pledge. Each shows the latest value (using most recent year with data, noting the year if not current), trend percentage, and period.

**Membership handling:** If the most recent year has no membership data, show the last year that does have data with an "As of [year]" label. Never show "--" as the headline number.

### Diocese Ranking

Inline percentile values for attendance, giving, and membership within the diocese.

### Yearly Breakdown Table

Full table: Year | ASA | Members | Plate & Pledge. All available years, most recent first. Missing data cells show "--" in gray-400.

### Multi-Church Handling

When church selector is active, shows data for the selected church only. Tab label could show church name as subtitle.

---

## Tab 3: Compensation

All compensation and benefits data.

### Summary Grid

Four cards: Position Type (with amber treatment for interim), Housing, Annual Budget, Orders Required.

### Benefits Grid

Four-column grid: Pension, Healthcare, Vacation, Continuing Education. Shows values from deep scrape fields. "Not specified" for missing data.

### Additional Benefits

Travel/auto reimbursement and any other benefits fields.

### Diocese Compensation Context

**CPG Mapping Layer** (new enrichment improvement):

Map canonical position types to CPG categories:
- Rector (ASA < 400) -> "Solo Rector"; Rector (ASA >= 400) -> "Senior Rector"
- Assistant, Associate, Curate -> "Assistant"
- Deacon -> "Parish Deacon"
- All others (Vicar, Priest-in-Charge, Interim, Canon, etc.) -> fall back to diocese-wide median

Display:
- If position-specific match exists: "The diocese median for [Solo Rectors] is $X" with comparison to this position's comp
- If no position-specific match: "The diocese-wide median clergy compensation is $X" with a note explaining no position-specific benchmark is available
- Always show: Solo Rector median, Assistant median, and All clergy median as reference points
- Include year and clergy count as metadata

### Personal Compensation Context (logged-in only)

If the priest has claimed their identity:
- "This position pays $X more/less than your current role"
- Compensation-to-local-income ratio comparison

---

## Tab 4: Profile

All raw VocationHub deep scrape fields, organized into logical groups with consistent two-column key-value layout.

### Groups (in order):

1. **Position Details** -- Type, Diocese, Congregation, Position Title/Role, Type of Work, Orders, Current Status, ASA, Annual Budget
2. **Description** -- Free text position description
3. **How to Apply** -- Application instructions
4. **Contact** -- Name, title, organization, email, phone
5. **Benefits & Leave** -- All benefits fields in key-value pairs
6. **Church Directory** -- Address, phone, email, website from church_infos
7. **Dates** -- Receiving names from/to

### Layout

Two-column grid of key-value rows with subtle bottom borders. Keys in gray-500, values in gray-900. Links rendered as clickable primary-600 underlined text.

---

## Color System

| Color | Semantic Meaning | Tailwind Classes | Usage |
|-------|-----------------|------------------|-------|
| **Green** | Active, positive | `bg-green-100 text-green-700` | Active status badge, upward trends, above-median indicators |
| **Blue** | Developing, primary UI | `bg-blue-100 text-blue-700`, `text-primary-600` | Developing status, links, active tab indicator |
| **Amber** | Interim | `bg-amber-100 text-amber-700`, `bg-amber-50 border-amber-200` | Interim status badge, interim work type pill, interim comp card, inline interim highlights |
| **Gray** | Neutral, closed, directory | `bg-gray-100 text-gray-600` | Closed/Directory Only status, canonical type pills, neutral data cards |
| **Red** | Negative signal | `text-red-600` | Downward trends, "no longer receiving names" status |
| **Navy** | Data emphasis | `font-semibold text-primary-900` | Key statistics in narrative text |

**Rules:**
- Amber treatment appears whenever a position's work type is interim or supply -- in the header, at-a-glance card, and narrative mentions
- Trend colors (green up, red down) appear only on percentage changes, not on raw values
- Compensation context uses green for above-median, amber for below-median (not red -- below median is not inherently negative)
- Canonical type pills are always neutral gray
- Status badges follow the unified status model from Phase 1

---

## Data Pipeline Changes

### CPG Compensation Mapping

New mapping in the compensation enrichment stage:

```javascript
const CPG_TYPE_MAP = {
  'Rector': (asa) => asa >= 400 ? 'Senior Rector' : 'Solo Rector',  // 400 ASA threshold per CPG definitions
  'Vicar': () => 'Solo Rector',        // closest match
  'Priest-in-Charge': () => 'Solo Rector',
  'Assistant': () => 'Assistant',
  'Associate': () => 'Assistant',
  'Curate': () => 'Assistant',
  'Senior Associate': () => 'Assistant',
  'Deacon': () => 'Parish Deacon',
};
// All unmapped types fall back to diocese-wide median
```

This mapping is applied during the `compute-compensation` enrichment stage using the position's `position_types` array (from Phase 1 normalization). The best-match CPG type is stored on the position for frontend display.

### Membership Fallback

When displaying membership, find the most recent year with a non-null membership value. Store `membership_latest_year` alongside the value so the UI can show "As of [year]" when it's not the current reporting year.

### Narrative Data Helpers

Create a `narrative-helpers.ts` utility that computes derived values for the Overview tab:
- `givingPerAttendee(plateAndPledge, asa)`
- `trendDescription(startValue, endValue, startYear, endYear)` -> "up 13% over the past decade"
- `compToLocalIncomeRatio(totalComp, censusMedianIncome)`
- `diocesePercentileDescription(percentile, metric)` -> "larger than 67% of parishes"

These helpers take raw position data and return display-ready strings. The Overview tab component calls these helpers -- it does not contain data transformation logic itself.

---

## Fallback Behavior

When deep scrape data is not available (no profile fields):

- **Overview tab:** Shows available data only. At-a-glance cards show what's available (ASA from parochial, giving from parochial). Narrative sections that depend on deep scrape fields (What They're Looking For, benefits) are omitted. Parish Health and Clergy Stability still render from parochial + clergy context data.
- **Parish Data tab:** Renders normally (parochial data is independent of deep scrape)
- **Compensation tab:** Shows diocese context only, benefits section shows "No detailed benefits data available"
- **Profile tab:** Shows "No detailed profile data available. View on VocationHub for full listing." with a link

---

## Component File Structure

```
web/src/components/
  detail-panel/
    DetailPanel.tsx          -- Main container: sticky header + tab bar + content area
    DetailHeader.tsx         -- Church name, type pills, status, metadata, links
    ChurchSelector.tsx       -- Multi-church pill selector (only renders for multi-church)
    DetailTabs.tsx           -- Generic tab bar + content switching
    tabs/
      OverviewTab.tsx        -- Integrated narrative view
      ParishDataTab.tsx      -- Raw parochial data
      CompensationTab.tsx    -- Comp + benefits + benchmarks
      ProfileTab.tsx         -- Raw VH fields
  lib/
    narrative-helpers.ts     -- Derived value computation for narratives
    cpg-mapping.ts           -- Canonical type -> CPG type mapping
```

The existing `PositionTable.tsx` calls `DetailPanel` instead of the current inline `ExpandedDetail`. The `ExpandedDetail` component and its inline sections are removed.

---

## Scope Boundaries

**In scope:**
- Panel layout redesign (all four tabs)
- Sticky header with tabs
- Church selector for multi-church
- Integrated narrative on Overview tab
- CPG compensation mapping improvement
- Membership fallback to latest available year
- Color system (amber interim throughline)
- Canonical type pills in header (using Phase 1 normalization)

**Out of scope (future phases):**
- Personal context / logged-in features (Phase 2D from the plan -- separate spec)
- Map view improvements (Phase 3)
- Selected row visibility animation beyond the left border (minor, can add later)
- Quality score popover redesign (Phase 2B -- can be done independently)
