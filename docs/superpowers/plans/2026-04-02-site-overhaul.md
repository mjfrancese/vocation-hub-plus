# Vocation Hub+ Site Overhaul - April 2026

## Context

Vocation Hub+ aggregates Episcopal Church clergy position data from multiple sources (VocationHub scraper, Asset Map, ECDPlus directory, parochial reports, Census Bureau, CPG compensation data) into a single enriched view. The data pipeline is now solid (SQLite DB, 9-stage enrichment, deep scrape profiles), but the frontend has accumulated UX debt as features were bolted on. This plan addresses bugs, data quality gaps, and a comprehensive UX overhaul.

The primary users are Episcopal priests exploring position opportunities. Every design decision should be filtered through: "Does this help a priest find and evaluate positions faster?"

---

## Phase 1: Critical Bugs & Data Integrity

These are broken or misleading things that must be fixed before UX work.

### 1A. Admin page crash
- `/admin/` returns "Application error: a client-side exception has occurred" after entering the password "meghan"
- Diagnose via browser console, fix the client-side error

### 1B. Missing VocationHub links
- Some listings have no VocationHub profile link. Every position came from VocationHub, so every position MUST have a link. Extended positions should use `https://vocationhub.episcopalchurch.org/PositionView/{vh_id}`.
- Audit and fix: ensure `profile_url` is always populated in both enrichment output and frontend rendering.

### 1C. Missing church website links
- We pull from Asset Map and ECDPlus, both of which have website data. Ensure church_infos surfaces website URLs and the frontend renders them.

### 1D. Parochial data gaps on active listings
- Only 2 active listings are missing parochial data (Holy Cross in Hixson, TN -- genuinely no matching parish; Saint Davids Episcopal Day School in Austin -- it's a school not a parish). Confirm these are the only edge cases and document why. If the school has any parish-level data, link it.

### 1E. Position type normalization
- VocationHub lumps positions together (e.g., "Rector / Vicar / Priest-in-Charge"). Break these into individual canonical types in our system:
  - Rector, Vicar, Priest-in-Charge, Assistant, Associate, Curate, Dean, Interim, Bishop, Canon, Diocesan Staff (consider sub-categories), Chaplain, Deacon, Other
- A single listing can map to multiple types, but our filters and display should show individual types, not the lumped VH strings.
- This affects: enrichment pipeline normalization, filter options, display labels.

### 1F. Status cleanup
- The status filter dropdown and the status column show different things (filter shows grouped statuses like "Receiving/Closed/Developing", column shows quality badges or VH statuses). This is confusing.
- Unify the status model: one clear status per position, consistent between filter and display.
- Consider: Active (receiving names now), Developing (profile being built), Interim, Closed/Filled, Directory Only (extended positions from deep scrape with no active search).

### 1G. Scraper schedule verification
- Confirm scrapers are still running on schedule. The user did not see one trigger this morning.
- Check: `scrape-positions.yml` schedule, `deep-scrape.yml` schedule, recent run history.

---

## Phase 2: Position Panel Overhaul (The Big One)

The expanded position detail panel is the core of the user experience. Right now it's a patchwork of sections bolted on as data sources were added. It needs to feel like one cohesive thing.

### Design Principles
- **Information hierarchy**: Most important info first. A priest wants to know: What is this position? Where is it? What does it pay? Is the church healthy? Is it a good fit for me?
- **Density over whitespace**: Current layout wastes enormous space with separate bordered sections. Use a denser, more integrated layout.
- **Data plays off data**: Don't silo information by source. Combine church directory info, parochial data, compensation, and census data into a unified parish profile.
- **Progressive disclosure**: Show the essential summary upfront; let users drill into details on demand.

### 2A. Panel layout redesign
- Replace the current section-per-source layout with a unified, dense layout.
- Suggested structure (iterate on this):
  - **Header row**: Position title, church name, location, key dates, status badge, VH link
  - **At-a-glance row**: ASA, budget, compensation estimate, membership trend arrow -- the quick-scan numbers
  - **Parish profile**: Unified church info (address, contact, website, diocese) + parochial trends + census context in a compact layout, not three separate boxes
  - **Personal context** (if logged in): Compact, meaningful insights (see 2D)
  - **Similar positions**: Keep but make more compact
  - **Deep scrape fields**: Collapsible, for power users who want raw VH profile data

### 2B. Quality score reduction
- Quality score currently takes too much room in the listing.
- Reduce to: a small badge/icon in the row + a hover popover with the breakdown.
- The hover popover for quality score (and for status tags like "Active Listing" / "Directory") needs proper UI -- not plain text. Design a consistent tooltip/popover component with clear typography, subtle background, proper spacing.

### 2C. Multi-church listings (tabs)
- Some positions span multiple churches. Current multi-church display is messy.
- Use tabs within the panel: one tab per church, each showing that church's unified parish profile.
- Shared position info (compensation, dates, position type) stays outside the tabs.

### 2D. Personal Context rethink
- Current personal context shows "distance" and "relocation required" for almost every listing, which is true but not useful. It dominates the top of the panel.
- With the data we have (priest's current diocese, position history, skills, preferences from the deep scrape) and position data (compensation, ASA, budget, location, ministry setting), we can do better:
  - **Compensation comparison**: "This position pays $X more/less than your current role"
  - **Church size fit**: "This church's ASA (150) is similar to / larger than / smaller than your current parish (120)"
  - **Ministry setting match**: "You're currently in a suburban setting; this is rural"
  - **Commute context**: Only show distance if it's within a reasonable commute range; otherwise just say the region
  - **Skills alignment**: If we have the priest's skills and the position's desired skills, show overlap
- Make personal context a compact inline section, not a dominant top block.

### 2E. Selected row visibility
- The slightly darkened row is not enough to indicate selection.
- Add a stronger left border accent (4px primary color), slightly more contrast on the background, or a subtle animation on expand.

---

## Phase 3: Navigation, Filtering & Information Architecture

How the user finds and navigates to positions.

### 3A. Extended/Directory position handling
- Over 100 listings show up, many are "Directory" listings that may not be active searches. This can mislead priests.
- Options to consider:
  - Default filter to "Active" positions only; directory listings accessible via explicit filter toggle
  - Clearer visual distinction: active positions in full color, directory positions visually muted with a clear label like "No active search -- directory listing only"
  - Add a date-based freshness indicator
- The key principle: never present data in a way that makes priests think something is a real, active opportunity when it may not be.

### 3B. Date-based sorting and filtering
- Currently can only sort by receiving-names dates.
- Add: sort by "last updated on hub", sort by "first seen" (when we discovered it).
- Consider a date range filter for "updated in the last N days/weeks".

### 3C. Map view improvements
- Currently clicking a map pin only links to VocationHub, not to our own listing detail.
- After the panel overhaul, clicking a map pin should open/expand that position's detail panel (or navigate to it in table view).
- When in map view, clicking "Vocation Hub+" or "Positions" in the header should return to table view. More organic navigation.

### 3D. About page update
- Verify content is current.
- Add: list of all data sources with links (VocationHub, Episcopal Asset Map, ECDPlus, Church Pension Group, Census Bureau ACS, parochial reports).
- No reason to hide where the data comes from -- transparency builds trust.

---

## Phase 4: Dashboard & Analytics

### 4A. Analytics page fix
- Analytics is currently broken. Diagnose and fix.
- Then rethink: who is this for and why?
  - For priests: trends in position availability by region/type, compensation distributions, seasonal posting patterns
  - Make it actionable: "There are currently X rector positions in your region" type insights
  - Remove vanity metrics that don't help anyone make decisions

### 4B. Dashboard expansion ("My Dashboard")
- Currently only Career tab is filled in.
- Next steps for the other tabs:
  - **Preferences/Search Criteria**: Let priests indicate what they're looking for (position types, regions, church size range, compensation range, housing preference, ministry setting). Use these preferences to sort/highlight matching positions in search.
  - **Timeline**: When they might be looking to move. Active vs. passive status.
  - **Saved/Tracked positions**: Let priests bookmark positions they're interested in.
- These preferences should feed back into personal context and position ranking.

---

## Execution Notes

- **Phase 1 first**: Fix what's broken before redesigning. Each item is independent and can be parallelized.
- **Phase 2 is the core**: This is the biggest effort and highest impact. Plan the panel layout before coding. Consider creating a wireframe/mockup first.
- **Phase 3 depends on Phase 2**: Map view and filtering improvements build on the new panel design.
- **Phase 4 is stretch**: Dashboard and analytics are valuable but lower priority than getting the core position experience right.
- **Discover issues as you go**: This list covers known issues but similar problems likely exist. Fix them when found rather than ignoring them.
