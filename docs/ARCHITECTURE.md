# Architecture

## Overview

Vocation Hub+ is a multi-component system that scrapes, stores, enriches, and
presents Episcopal Church position listings from the official Vocation Hub.

```
Playwright Scraper  -->  SQLite DB  -->  Enrichment Scripts  -->  Static JSON  -->  Next.js Frontend
(GitHub Actions)         (persistent)    (GitHub Actions)         (committed)       (GitHub Pages)
```

## Why This Architecture?

The Vocation Hub has no public API. It is a Blazor WebAssembly application
where all data flows through a SignalR WebSocket (`wss://.../_blazor`).
There are no REST or OData endpoints to call. The only way to get data out
is browser automation.

We chose a static-site approach because:

1. **No server costs**: GitHub Pages hosting is free
2. **Fast**: Pre-built HTML/JSON loads instantly
3. **Reliable**: No runtime dependencies, no database connections at serve time
4. **Simple deployment**: Push JSON files, rebuild the site

## Components

### Scraper (`/scraper`)

**Stack**: TypeScript, Playwright, better-sqlite3, tsx

The scraper runs three phases on each execution:

**Phase 1 -- Search table scrape**

Launches a headless Chromium browser, navigates to the Vocation Hub search
page, clears all filters, then enters a single space into the Community Name
field (which acts as a wildcard search). Extracts all results across all
paginated pages.

**Phase 2 -- VH ID discovery + position detail scrape**

In a single pass, discovers Vocation Hub internal IDs for positions and scrapes
individual position profile pages for detailed fields. This phase is non-fatal:
failures are logged but do not abort the run.

**Phase 3 -- Targeted backfill**

Performs a targeted backfill for any positions that were missed in Phase 2.
Also non-fatal.

**Key modules:**

| Module | Purpose |
|--------|---------|
| `selectors.ts` | All CSS selectors for the Telerik Blazor UI |
| `config.ts` | Environment variables and CLI flags |
| `logger.ts` | Structured JSON logging |
| `browser.ts` | Playwright browser lifecycle and screenshots |
| `navigate.ts` | Page navigation and result waiting |
| `scrape-results.ts` | Table extraction and pagination |
| `db.ts` | SQLite schema, upsert, and query operations |
| `diff.ts` | Change detection (new, updated, expired, reappeared) |
| `export-json.ts` | Generate static JSON for the frontend |
| `index.ts` | Main entry point and orchestration |

**Resilience features:**
- Screenshots at key moments and on any failure
- 14-minute overall timeout (`MAX_RUNTIME_MS` default: 840000 ms)
- Dry-run mode for testing without DB writes
- Non-fatal Phase 2 and Phase 3 to prevent partial failures from aborting data export

### Database (`/data`)

**Stack**: SQLite via better-sqlite3

Tables:

| Table | Purpose |
|-------|---------|
| `positions` | Every position ever seen, with status tracking |
| `position_details` | Detailed profile fields scraped from individual position pages |
| `scrape_history` | Record of each scrape run |
| `vh_discovery` | Tracks discovered Vocation Hub internal IDs |

The database is persisted as a GitHub Actions artifact (90-day retention)
and downloaded at the start of each scrape run.

### Enrichment Pipeline (`/web/scripts`)

After scraping, three enrichment scripts run in CI to produce richer data
artifacts. These scripts run in the CI workflows, not in the scraper itself.

**`build-registry.js`**

Merges Episcopal Asset Map church data with General Convention parochial report
data into a canonical `church-registry.json`.

**`build-position-map.js`**

Links scraped positions to church registry entries using a multi-strategy
matching approach: website URL, email domain, phone number, name + diocese
combination, and city hints. Outputs `position-church-map.json` with a
confidence score for each match.

**`enrich-positions.js`**

Enriches positions with matched church and parochial data, then generates a
gap report (`needs-backfill.json`) listing positions that could not be matched.
Outputs `enriched-positions.json` and `enriched-extended.json`.

### Frontend (`/web`)

**Stack**: Next.js 14 (App Router), Tailwind CSS, Fuse.js

A static site that reads from JSON files at build time. Features:

- Fuzzy search across all fields (Fuse.js)
- Filter by state, diocese, position type, compensation, region, setting,
  housing, healthcare, and status
- Status grouping: Receiving, Developing, Interim, Closed, Unknown
- "New" badge for positions with recent receiving dates
- Extended visibility: shows profiles from the deep scrape that do not appear
  in current search results
- Admin review page (client-side access gate, not real authentication)
- Analytics page with charts

### CI/CD (`.github/workflows`)

**`scrape.yml`**

Runs twice daily (6am and 6pm UTC). Downloads the previous DB, runs the
scraper, runs all three enrichment scripts, and commits updated JSON data to
main. Data-only -- does not trigger a deploy directly.

**`deep-scrape.yml`**

Runs weekly (Sunday at 3am UTC). Discovers new Vocation Hub IDs and deep
scrapes all known position profiles to populate `all-profiles.json` and
`profile-fields.json`.

**`church-directory.yml`**

Runs monthly (1st of each month). Scrapes the Episcopal Asset Map and parochial
report data to refresh `churches.json` and `parochial-data.json`.

**`deploy.yml`**

Triggers on any push to main that touches web source files or data files.
Runs lint and tests, then builds the Next.js static export and deploys to
GitHub Pages. All deploys go through this workflow.

## Data Flow

1. GitHub Actions cron triggers `scrape.yml`
2. Scraper downloads previous `positions.db` artifact
3. Phase 1: Playwright scrapes all positions from Vocation Hub search table
4. Phase 2: Scraper discovers VH IDs and scrapes position detail profiles
5. Phase 3: Scraper backfills any missed positions
6. `diff.ts` compares against existing DB records
7. `export-json.ts` writes `positions.json`, `changes.json`, `meta.json`
8. Enrichment scripts produce `enriched-positions.json`, `position-church-map.json`, etc.
9. Bot commits JSON to `web/public/data/` and pushes to main
10. Push triggers `deploy.yml` which rebuilds and deploys the frontend

## Data Artifacts (`web/public/data/`)

| File | Description |
|------|-------------|
| `positions.json` | Current search results from the latest scrape |
| `all-profiles.json` | All VH profiles from the most recent deep scrape |
| `enriched-positions.json` | Public positions with church and parochial enrichment |
| `enriched-extended.json` | Extended profiles not in current search results |
| `church-registry.json` | Canonical church directory (merged Asset Map + parochial) |
| `position-church-map.json` | Position-to-church mappings with confidence scores |
| `parochial-data.json` | General Convention parochial report data |
| `profile-fields.json` | Detailed profile fields keyed by VH ID |
| `meta.json` | Scrape run metadata |
| `changes.json` | Detected position changes |
| `needs-backfill.json` | Gap report for unmatched positions |
| `manual-mappings.json` | Manual position-to-church overrides |
| `manual-vh-ids.json` | Manual VH ID overrides |
| `manual-diocese-overrides.json` | Manual diocese name overrides |
| `churches.json` | Raw Episcopal Asset Map church data |

## Position ID Generation

Each position is uniquely identified by a SHA-256 hash of:
```
name + "|" + diocese + "|" + position_type
```

This means the same church posting the same position type in the same
diocese will always map to the same ID, enabling change tracking across runs.

## State Derivation

The Vocation Hub search results table does not include a State column. The
scraper derives state from the Diocese field using an internal diocese-to-state
mapping. This means state data is only as accurate as that mapping.

## Status Lifecycle

```
[first scrape]  -->  "new"
[seen again]    -->  "active"
[not in scrape] -->  "expired"
[reappears]     -->  "active" (with "reappeared" change logged)
```
