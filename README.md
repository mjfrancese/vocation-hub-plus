# Vocation Hub+

Automated nationwide search and change tracking for Episcopal Church
[Vocation Hub](https://vocationhub.episcopalchurch.org/PositionSearch) positions.

## The Problem

The Episcopal Church's Vocation Hub lets churches post open clergy and staff
positions, but the search interface only allows filtering by one state or
diocese at a time. There is no public API; all data flows through a
Blazor/SignalR WebSocket connection.

## The Solution

Vocation Hub+ scrapes every position using Playwright headless browser
automation, stores them in SQLite with full change tracking, enriches them
with church directory data, and serves a modern search frontend where you can
browse all positions nationwide.

### Features

- **Nationwide search**: Browse all positions across every state and diocese
- **Fuzzy search**: Find positions by keyword across all fields
- **Change tracking**: See when positions are added, updated, or removed
- **Rich filtering**: By state, diocese, position type, compensation, region,
  setting, housing, healthcare, and status
- **Extended positions**: Shows deep-scraped profiles not in current search results
- **Church enrichment**: Positions linked to Episcopal Asset Map church data
  and General Convention parochial reports
- **Admin review**: Review page for auditing position-to-church matches
- **Analytics**: Charts and summary statistics
- **CSV export**: Download any filtered view
- **Automatic updates**: Scrapes twice daily via GitHub Actions

## Architecture

```
Playwright Scraper  -->  SQLite DB  -->  Enrichment Scripts  -->  Static JSON  -->  Next.js Frontend
(GitHub Actions)         (persistent)    (GitHub Actions)         (committed)       (GitHub Pages)
```

| Component | Stack |
|-----------|-------|
| Scraper | TypeScript, Playwright, better-sqlite3 |
| Frontend | Next.js 14, Tailwind CSS, Fuse.js |
| Database | SQLite (persisted as GitHub Actions artifact) |
| CI/CD | GitHub Actions (cron scraping, enrichment, auto-deploy) |

### Scraping Pipeline (3 phases)

1. **Search table scrape** -- clears all filters, enters a space in the
   Community Name field (wildcard), extracts all paginated results
2. **VH ID discovery + detail scrape** -- discovers internal VH IDs and scrapes
   individual position profile pages (non-fatal)
3. **Targeted backfill** -- retries any positions missed in Phase 2 (non-fatal)

### Enrichment Pipeline

After each scrape, three scripts run to enrich the data:

1. `build-registry.js` -- merges Episcopal Asset Map + parochial data into a
   canonical church registry
2. `build-position-map.js` -- links positions to churches via website, email,
   phone, name+diocese, and city matching
3. `enrich-positions.js` -- enriches positions with church data, generates a
   gap report for unmatched positions

## Quick Start

### Prerequisites

- Node.js 20+
- npm 9+

### Install dependencies

```bash
npm install
cd scraper && npx playwright install chromium
```

### Run the scraper

```bash
# Full scrape (writes to SQLite and exports JSON)
npm run scrape

# Dry run (logs actions without writing to DB)
npm run scrape:dry
```

### Run the frontend

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to browse positions.

### Build for production

```bash
npm run build
```

## Configuration

Copy `.env.example` to `.env` and adjust values as needed:

| Variable | Default | Description |
|----------|---------|-------------|
| `VOCATIONHUB_URL` | Vocation Hub URL | Target scrape URL |
| `SCRAPE_DELAY_MS` | 250 | Delay between interactions |
| `POPUP_WAIT_MS` | 600 | Wait time for dropdown popups |
| `DB_PATH` | `../data/positions.db` | SQLite database path |
| `OUTPUT_PATH` | `./output` | JSON export directory |
| `SCREENSHOT_ON_FAILURE` | true | Save screenshots on errors |
| `MAX_RUNTIME_MS` | 840000 | 14-minute overall timeout |

## Project Structure

```
vocation-hub-plus/
├── scraper/          Playwright scraper (TypeScript)
├── web/              Next.js frontend and enrichment scripts
├── data/             SQLite schema and seed files
├── .github/workflows CI/CD pipelines
└── docs/             Architecture and selector docs
```

## License

MIT
