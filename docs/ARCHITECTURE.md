# Architecture

## Overview

Vocation Hub+ is a three-part system that scrapes, stores, and presents
Episcopal Church position listings from the official Vocation Hub.

```
Playwright Scraper  -->  SQLite DB  -->  Static JSON  -->  Next.js Frontend
(GitHub Actions)         (persistent)    (committed)       (GitHub Pages)
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

The scraper launches a headless Chromium browser, navigates to the Vocation Hub
search page, selects all 50 states from a Telerik MultiSelect dropdown (one at
a time, since the dropdown auto-closes after each selection), clicks Search, and
extracts all results across all paginated pages.

**Key modules:**

| Module | Purpose |
|--------|---------|
| `selectors.ts` | All CSS selectors for the Telerik Blazor UI |
| `config.ts` | Environment variables and CLI flags |
| `logger.ts` | Structured JSON logging |
| `browser.ts` | Playwright browser lifecycle and screenshots |
| `navigate.ts` | Page navigation and result waiting |
| `select-states.ts` | State dropdown automation (open-click-close loop) |
| `scrape-results.ts` | Table extraction and pagination |
| `db.ts` | SQLite schema, upsert, and query operations |
| `diff.ts` | Change detection (new, updated, expired, reappeared) |
| `export-json.ts` | Generate static JSON for the frontend |
| `index.ts` | Main entry point and orchestration |

**Resilience features:**
- Retries dropdown opening up to 5 times
- Tracks seen state names to prevent infinite loops
- Screenshots at key moments and on any failure
- 10-minute overall timeout
- Dry-run mode for testing without DB writes

### Database (`/data`)

**Stack**: SQLite via better-sqlite3

Three tables:
- `positions`: Every position ever seen, with status tracking
- `scrape_log`: Record of each scrape run
- `position_changes`: Changelog of all detected changes

The database is persisted as a GitHub Actions artifact (90-day retention)
and downloaded at the start of each scrape run.

### Frontend (`/web`)

**Stack**: Next.js 14 (App Router), Tailwind CSS, Fuse.js

A static site that reads from JSON files at build time. Features:
- Fuzzy search across all fields (Fuse.js)
- Filter by state, diocese, position type, status
- Sortable results table with expandable details
- New positions feed (last 14 days)
- Expired positions feed
- CSV export
- Mobile responsive

### CI/CD (`.github/workflows`)

**scrape.yml**: Runs twice daily (6am/6pm UTC). Downloads the previous DB,
runs the scraper, uploads the updated DB, commits and pushes new JSON data.

**deploy.yml**: Triggers when web source or data changes on main. Builds
the Next.js static export and deploys to GitHub Pages.

## Data Flow

1. GitHub Actions cron triggers `scrape.yml`
2. Scraper downloads previous `positions.db` artifact
3. Playwright scrapes all positions from Vocation Hub
4. `diff.ts` compares against existing DB records
5. New/updated/expired positions are tracked in `position_changes`
6. `export-json.ts` writes `positions.json`, `changes.json`, `meta.json`
7. Bot commits JSON to `web/public/data/` and pushes
8. Push triggers `deploy.yml` which rebuilds and deploys the frontend

## Position ID Generation

Each position is uniquely identified by a SHA-256 hash of:
```
name + "|" + diocese + "|" + position_type
```

This means the same church posting the same position type in the same
diocese will always map to the same ID, enabling change tracking.

## Status Lifecycle

```
[first scrape]  -->  "new"
[seen again]    -->  "active"
[not in scrape] -->  "expired"
[reappears]     -->  "active" (with "reappeared" change logged)
```
