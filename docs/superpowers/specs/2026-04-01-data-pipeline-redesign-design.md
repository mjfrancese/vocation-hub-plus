# Data Pipeline Redesign -- Design Spec

**Date:** 2026-04-01
**Status:** Draft

## Problem Statement

The current data pipeline has five data sources feeding into a fragile chain of scripts and three GitHub Actions workflows that frequently break each other. Specific problems:

- Three workflows commit JSON files to the same branch, causing merge conflicts, corrupted JSON from failed stash pops, and push rejections
- Large generated JSON files (53MB total) tracked in git create noisy diffs and bloated history
- The enrichment script (enrich-positions-v2.js) is an 18K-line monolith that does parish matching, parochial data, percentiles, compensation, census, similar positions, coordinate backfill, quality scoring, and clergy context in one file
- Two church directory sources (Asset Map, ECDPlus) have no shared key and are matched via fragile heuristics every run
- The scraper maintains a separate positions.db apart from the main vocationhub.db
- Census data integration exists in code but is not wired into any workflow
- No idempotency guarantees -- running enrichment multiple times can produce different results

## Design Principles

1. **SQLite as single source of truth** -- all data lives in one DB, JSON is a build artifact
2. **Separation of concerns** -- data collection workflows never touch git; a single build workflow generates all frontend data
3. **Idempotency** -- every script can be run repeatedly on the same input and produce the same output
4. **Incremental confidence** -- parish matching improves over time via a persistent identity table rather than re-running heuristics from scratch

## Architecture Overview

### Two Data Collection Workflows (write to DB only)

**`scrape-positions.yml`** -- twice daily (6am/6pm UTC)
1. Download `vocationhub.db` from latest GitHub Release (`db-latest`)
2. Run Playwright scraper (scrape-results.ts + profile scraping)
3. Write results to `scraped_positions` table (insert new, update existing by `vh_id`)
4. Write scraper metadata (changes, meta) to `scraper_meta` table
5. Upload updated DB as release asset `db-latest`
6. Fire `repository_dispatch` event (type: `build`)

**`data-refresh.yml`** -- monthly (1st of month, 5am UTC)
1. Download `vocationhub.db` from latest release
2. Scrape Asset Map churches, write to `parishes` table (upsert by `nid`)
3. Fetch ECDPlus parishes (upsert by `ecdplus_id`) and clergy + positions
4. Run parish identity matching for unmatched parishes (see Parish Identity System)
5. Merge parish data using identity table
6. Scrape parochial reports from Power BI, write to `parochial_data` table
7. Fetch Census Bureau data for all unique zip codes, write to `census_data` table
8. Upload updated DB as release asset `db-latest`
9. Fire `repository_dispatch` event (type: `build`)

**Concurrency:** `data-refresh` uses a GitHub Actions `concurrency` group that cancels any in-progress `scrape-positions` run. The next scheduled scrape picks up the data-refresh DB.

### One Build & Deploy Workflow

**`build-and-deploy.yml`**

**Triggers:**
- `repository_dispatch` (type: `build`) -- fired by data workflows after DB upload
- `schedule` -- daily fallback cron (12pm UTC)
- `push` to main -- for code changes

**Steps:**
1. Download `vocationhub.db` from latest release
2. Run enrichment pipeline (staged modules, see below)
3. Generate output files:
   - `enriched-positions.json` -- public search positions with enrichment
   - `enriched-extended.json` -- directory positions (from profiles, not in search)
   - `position-church-map.json` -- position-to-parish match confidence
   - `clergy/{token}.json` -- one file per clergy token (~2KB each)
   - `clergy-search-index.json` -- lightweight name/token list for claim autocomplete
   - `changes.json`, `meta.json` -- from scraper_meta table
   - `profile-fields.json`, `all-profiles.json` -- from DB
4. Upload generated data as release asset `frontend-data-latest` (zip)
5. Build Next.js static export
6. Deploy to GitHub Pages

**No workflow commits to git. No JSON files are tracked in the repository.**

## Database Schema Changes

### New Tables

**`parish_identity`** -- persistent mapping between Asset Map and ECDPlus parish records
```sql
CREATE TABLE parish_identity (
  nid TEXT NOT NULL,
  ecdplus_id TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'auto',  -- 'auto' | 'confirmed'
  match_method TEXT NOT NULL,               -- 'phone' | 'website' | 'name_diocese' | 'name_diocese_city' | 'manual'
  confirmed_at TEXT,                        -- ISO timestamp, null until manually confirmed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (nid, ecdplus_id)
);
```

**`census_data`** -- median income and population by zip code
```sql
CREATE TABLE census_data (
  zip TEXT PRIMARY KEY,
  median_income INTEGER,
  population INTEGER,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**`scraped_positions`** -- positions from Vocation Hub scraper (replaces positions.json as primary storage)
```sql
CREATE TABLE scraped_positions (
  vh_id TEXT PRIMARY KEY,
  name TEXT,
  diocese TEXT,
  state TEXT,
  organization TEXT,
  position_type TEXT,
  receiving_from TEXT,
  receiving_to TEXT,
  updated_on_hub TEXT,
  status TEXT,
  scraped_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**`scraper_meta`** -- key/value store for scraper metadata and auxiliary data
```sql
CREATE TABLE scraper_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,  -- JSON blob
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Expected keys:
- `changes` -- position change log (currently changes.json)
- `meta` -- last updated timestamp, counts (currently meta.json)
- `all_profiles` -- full VH profiles with deep scrape fields (currently all-profiles.json)
- `profile_fields` -- field arrays by vh_id (currently profile-fields.json)
- `detail_history` -- historical detail scrape data (currently detail-history.json)

### Existing Tables -- Unchanged

- `parishes` (id, ecdplus_id, nid, name, diocese, address, city, state, zip, phone, email, website, type, lat, lng, source, timestamps)
- `parish_aliases` (parish_id, alias, alias_normalized, source)
- `clergy` (guid PK, name fields, email, address, ordination data, timestamps)
- `clergy_positions` (id, clergy_guid FK, parish_id FK, position_title, employer fields, dates, is_current)
- `parochial_data` (parish_nid, year, average_attendance, plate_and_pledge, membership, operating_revenue)
- `compensation_diocesan`, `compensation_by_asa`, `compensation_by_position`, `compensation_by_experience`, `compensation_by_revenue`
- `fetch_log` (source, records_total/new/updated, duration_ms, status, error)
- `clergy_tokens` (token, clergy_guid)

### Removed

- Separate `positions.db` (scraper's standalone SQLite DB) -- replaced by `scraped_positions` table in the main DB

## Enrichment Pipeline

### Runner

A single script (`run-enrichment.js`) that:
1. Reads the positions array from the `scraped_positions` table
2. Opens the DB handle
3. Executes each stage module in order, passing the positions array and DB handle
4. Writes the final enriched output to JSON files

Supports a `--skip` flag for debugging (e.g., `--skip find-similar,quality-scores`).

### Stage Module Interface

Each stage is a separate file in `web/scripts/stages/` that exports a single function:

```js
module.exports = function stageName(positions, db) {
  // Read from db, modify positions, return positions
  return positions
}
```

### Stages (executed in order)

| # | Stage | Purpose | DB Tables Read |
|---|-------|---------|----------------|
| 1 | match-parishes | Match positions to parishes by website, email, phone, name+diocese aliases. Uses `parish_identity` for pre-confirmed matches first. | parishes, parish_aliases, parish_identity |
| 2 | backfill-coordinates | Copy lat/lng from matched parish onto position | parishes |
| 3 | attach-parochial | Attach attendance/giving/membership history arrays | parochial_data |
| 4 | attach-census | Attach median income, population by parish zip code | census_data |
| 5 | compute-compensation | Estimate total comp (stipend + housing), attach diocesan/ASA/position/experience benchmarks | compensation_* |
| 6 | compute-percentiles | Rank each parish within its diocese by ASA, plate & pledge, membership | parochial_data |
| 7 | find-similar | Find comparable positions within same diocese + position type, ranked by score | (positions array) |
| 8 | clergy-context | Attach current clergy, tenure history, clergy count trends for matched parishes | clergy, clergy_positions |
| 9 | quality-scores | Compute data completeness score per position based on which enrichment fields are populated | (positions array) |

### Clergy Token Generation

Separate from the enrichment pipeline because it is clergy-centric, not position-centric.

`generate-clergy-data.js` runs after enrichment and:
1. Reads clergy, clergy_positions, parishes, compensation, census, parochial data from DB
2. Generates HMAC-SHA256 tokens per clergy GUID (using CLERGY_TOKEN_SECRET)
3. Writes individual `clergy/{token}.json` files (~2KB each) containing personal data, compensation benchmarks, parish context, position history
4. Writes `clergy-search-index.json` (lightweight name/token list for the claim page autocomplete)
5. Writes token audit trail to `clergy_tokens` table

## Parish Identity System

### Purpose

Permanently resolve which Asset Map parish (NID) corresponds to which ECDPlus parish (ecdplus_id), so matching improves over time and is never re-evaluated unnecessarily.

### Matching Flow (runs during `data-refresh.yml`)

1. **Check existing identities** -- skip any parish with an existing row in `parish_identity`
2. **Heuristic matching on unmatched parishes:**
   - Phone match (normalized phone, same diocese) -- auto-confirmed (high confidence)
   - Website match (normalized domain) -- auto-confirmed (high confidence)
   - Name + diocese via `parish_aliases` with single match -- `confidence='auto'`
   - Name + diocese + city for disambiguation of multiple alias hits -- `confidence='auto'`
3. **Log results** -- new matches written to `fetch_log` with match details. Medium-confidence matches (name-based) flagged for review.
4. **Manual confirmation** -- a CLI script (`confirm-parish-matches.js`) lists unconfirmed matches for periodic review. Not required every run.

### Data Merge Behavior

After identity matching, the merge step uses `parish_identity` to:
- Copy lat/lng from Asset Map record to the consolidated parish row
- Prefer Asset Map for coordinates and physical address
- Prefer ECDPlus for clergy linkage and canonical identifiers
- Set `source='both'` on the consolidated row
- Reassign `clergy_positions` foreign keys to the consolidated parish ID
- Add aliases from both sources to `parish_aliases`

### Duplicate Prevention

- Asset Map import upserts by `nid`
- ECDPlus import upserts by `ecdplus_id`
- A parish exists as at most two rows (one per source) until matched
- After matching, consolidated into one row with `source='both'`
- Re-running the pipeline never creates duplicates

## Frontend Changes

### Minimal

The only frontend change required is to the clergy claim page:

**Current:** Imports the full `clergy-tokens.json` (21MB) client-side, looks up token in memory.

**New:** Fetches `/data/clergy/{token}.json` on demand (~2KB per request). Falls back to a "not found" state if the file doesn't exist.

All other data imports (`enriched-positions.json`, `enriched-extended.json`, `changes.json`, `meta.json`, `profile-fields.json`, `all-profiles.json`) remain the same format and are loaded the same way by `data.ts`.

## Migration Path

### Phase 1: Schema + Scraper Migration
- Add new tables to `db.js` schema initialization
- Modify scraper to write positions to `scraped_positions` table in vocationhub.db
- Keep existing workflows running unchanged
- Validate: scraper writes to DB, existing JSON output still works

### Phase 2: Enrichment Pipeline
- Build stage runner (`run-enrichment.js`)
- Extract each concern from `enrich-positions-v2.js` into a stage module in `web/scripts/stages/`
- Validate: new pipeline produces identical output to old monolith (diff enriched JSON)
- Keep old script until outputs match

### Phase 3: Build Workflow
- Create `build-and-deploy.yml`
- Add `repository_dispatch` triggers to data collection workflows
- Validate: site works identically from new workflow

### Phase 4: Cut Over
- Remove JSON files from git tracking
- Delete old workflows (`scrape.yml`, `church-directory.yml`, `data-refresh.yml`)
- Delete `enrich-positions-v2.js` and other deprecated scripts
- Update frontend clergy claim page to fetch per-token files
- Optionally clean git history with `git filter-repo`

### Phase 5: Enhancements
- Wire in Census Bureau API fetch
- Build parish identity matching + confirmation CLI
- Add stage-level tests to enrichment pipeline

Each phase is independently deployable. Rolling back to old workflows is possible through Phase 3.

## Data Flow Summary

```
External Sources
  |
  v
Data Collection Workflows (scrape-positions.yml, data-refresh.yml)
  |  - Never touch git
  |  - Write to vocationhub.db
  |  - Upload DB as GitHub Release asset
  |  - Fire repository_dispatch
  |
  v
vocationhub.db (GitHub Release "db-latest")
  |  - Single source of truth
  |  - parishes, clergy, positions, parochial, census, compensation
  |  - parish_identity table for cross-source matching
  |
  v
Build & Deploy Workflow (build-and-deploy.yml)
  |  - Downloads DB from release
  |  - Runs staged enrichment pipeline
  |  - Generates JSON files (never committed to git)
  |  - Generates per-token clergy files
  |  - Builds Next.js static export
  |  - Deploys to GitHub Pages
  |
  v
GitHub Pages (static site)
  - Reads enriched JSON at build time
  - Fetches clergy/{token}.json on demand
```
