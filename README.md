# Vocation Hub+

Automated nationwide search and change tracking for Episcopal Church
[Vocation Hub](https://vocationhub.episcopalchurch.org/PositionSearch) positions.

## The Problem

The Episcopal Church's Vocation Hub lets churches post open clergy and staff
positions, but the search interface only allows selecting one state or diocese
at a time. There is no public API; all data flows through a Blazor/SignalR
WebSocket connection.

## The Solution

Vocation Hub+ scrapes every position using Playwright headless browser
automation, stores them in SQLite with full change tracking, and serves a
modern search frontend where you can browse all positions nationwide.

### Features

- **Nationwide search**: Browse all positions across every state and diocese
- **Fuzzy search**: Find positions by keyword across all fields
- **Change tracking**: See when positions are added, updated, or removed
- **Filter and sort**: By state, diocese, position type, and status
- **CSV export**: Download any filtered view
- **Automatic updates**: Scrapes twice daily via GitHub Actions
- **New position alerts**: Easily see positions added in the last 14 days

## Architecture

```
Playwright Scraper  -->  SQLite DB  -->  Static JSON  -->  Next.js Frontend
(GitHub Actions)         (persistent)    (committed)       (GitHub Pages)
```

| Component | Stack |
|-----------|-------|
| Scraper | TypeScript, Playwright, better-sqlite3 |
| Frontend | Next.js 14, Tailwind CSS, Fuse.js |
| Database | SQLite (persisted as GitHub Actions artifact) |
| CI/CD | GitHub Actions (cron scraping, auto-deploy) |

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
| `MAX_RUNTIME_MS` | 600000 | 10-minute overall timeout |

## Project Structure

```
vocation-hub-plus/
├── scraper/          Playwright scraper (TypeScript)
├── web/              Next.js frontend
├── data/             SQLite schema and seed files
├── .github/workflows CI/CD pipelines
└── docs/             Architecture and selector docs
```

## License

MIT
