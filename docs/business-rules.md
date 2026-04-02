# Vocation Hub+ Business Rules

This document captures every rule, threshold, and convention that governs how positions are scraped, enriched, scored, filtered, and displayed. Read this before making changes to the pipeline, scoring, or frontend filtering.

---

## Table of Contents

1. [Position Sources & Visibility](#position-sources--visibility)
2. [Quality Score Computation](#quality-score-computation)
3. [Default View Filtering](#default-view-filtering)
4. [Unified Status Model](#unified-status-model)
5. [Enrichment Pipeline](#enrichment-pipeline)
6. [Parish Matching](#parish-matching)
7. [Compensation Estimation](#compensation-estimation)
8. [Diocese Percentiles](#diocese-percentiles)
9. [Similar Positions](#similar-positions)
10. [Scraper Workflows & Schedules](#scraper-workflows--schedules)
11. [Key Thresholds Reference](#key-thresholds-reference)

---

## Position Sources & Visibility

Positions come from two sources:

| Source | Visibility | Count | Schedule |
|--------|-----------|-------|----------|
| **Public search results** (scrape-positions) | `public` | ~42 | Every 12 hours |
| **Deep profile scrape** (deep-scrape) | `extended` or `extended_hidden` | ~1000+ | Weekly (Sunday 3am UTC) |

- `public` -- found in VocationHub's public search results
- `extended` -- deep-scraped with quality score >= 50
- `extended_hidden` -- deep-scraped with quality score < 50

**Important:** The regular scraper must NOT overwrite deep-scrape data. `export-db.ts` guards `profile_fields` and `all_profiles` writes -- it only updates them when the incoming count is >= the existing count.

---

## Quality Score Computation

File: `web/scripts/stages/quality-scores.js`

### Public Positions

Fixed score of **100**. Visibility: `public`. Always shown.

### Extended Positions

Scored 0-100 across four dimensions:

#### Status (max 25 pts)
| Condition | Points |
|-----------|--------|
| Active status ("Receiving names", "Reopened") | +25 |
| In-progress ("Developing profile", "Beginning search", "Profile complete") | +15 |

#### Recency (max 20 pts)
| Condition | Points |
|-----------|--------|
| `receiving_names_from` within 12 months | +15 |
| `receiving_names_from` within 3 months | +5 additional |

#### Name Clarity (max 15 pts)
| Condition | Points |
|-----------|--------|
| Congregation name present (not "Position in..." or "Unknown Position") | +10 |
| Position title present | +5 |

#### Data Richness (max 40 pts)
| Condition | Points |
|-----------|--------|
| Church matched (`church_infos` has entries) | +10 |
| Parochial data present | +10 |
| Position type set | +5 |
| State known | +5 |
| Exact match confidence on church | +5 |
| End date set (not empty, not "Open ended") | +5 |

#### Cap Rule

Positions with no congregation name (starts with "Position in" or equals "Unknown Position") are **capped at 45 points** regardless of other scores. This ensures they stay `extended_hidden`.

#### Visibility Assignment
- Score >= 50: `extended`
- Score < 50: `extended_hidden`

---

## Default View Filtering

File: `web/src/lib/filter-defaults.ts`

### What appears on page load (no filters selected)

**Public positions:** Show if unified status is Active, Developing, or Interim.

**Extended positions (ALL of them, regardless of VH status):** Must pass the data-quality gate:
1. Quality score >= **85**
2. `receiving_names_from` date within **12 months**
3. Parochial data present (`parochials[0].years` has entries)

This means an extended position with `vh_status: "Receiving names"` (classified as "Active") still will NOT appear in the default view unless it has quality >= 85, recent dates, and parochial data. This is intentional -- we only show extended data when we're confident it's complete and current. Showing more listings just for the sake of numbers is not helpful.

### "Is New" badge
- `receiving_names_from` within last **30 days**, OR
- `updated_on_hub` within last **14 days**

### Extended hidden toggle
The frontend has a "Include all listings" toggle that shows `extended_hidden` positions. Off by default.

---

## Unified Status Model

File: `web/src/lib/status-helpers.ts`

VocationHub statuses are mapped to 5 unified categories:

| Unified Status | VH Statuses |
|---------------|-------------|
| **Active** | "Receiving names", "Reopened" |
| **Developing** | "Beginning search", "Developing profile", "Profile complete", "Developing self study" |
| **Interim** | "Seeking interim", "Interim in place" |
| **Closed** | "Search complete", "No longer receiving names" |
| **Unlisted** | Extended positions with no recognized VH status |

For public positions with no recognized VH status, default is "Active".

---

## Enrichment Pipeline

File: `web/scripts/run-enrichment.js`

Entry point: `node web/scripts/run-enrichment.js <output-dir>`

Requires `VOCATIONHUB_DB_PATH` env var (or defaults to `data/vocationhub.db`).

### Stage Execution Order

| Order | Stage | File | Purpose |
|-------|-------|------|---------|
| 1 | match-parishes | `stages/match-parishes.js` | Match positions to church directory entries |
| 2 | backfill-coordinates | `stages/backfill-coordinates.js` | Fill missing lat/lng from matched parishes |
| 3 | attach-parochial | `stages/attach-parochial.js` | Attach parochial report data (ASA, giving, membership) |
| 4 | attach-census | `stages/attach-census.js` | Attach demographic census data |
| 5 | compute-compensation | `stages/compute-compensation.js` | Estimate total compensation |
| 6 | compute-percentiles | `stages/compute-percentiles.js` | Calculate diocese ranking percentiles |
| 7 | find-similar | `stages/find-similar.js` | Find comparable positions |
| 8 | clergy-context | `stages/clergy-context.js` | Attach clergy history context |
| 9 | quality-scores | `stages/quality-scores.js` | Compute quality scores and visibility |

### Extended Position Building

`buildExtendedPositions()` in run-enrichment.js creates positions from `all_profiles` not in public results.

**Status inference for extended positions:**
- Explicit status exists: use as-is
- `receiving_names_from` within 1 year and no status: "Receiving names"
- `receiving_names_from` older than 1 year: "Search complete"
- No date or status: "Developing profile"
- Date of 01/01/1900 (VocationHub default/bogus): force "Search complete"

**Position type fallback:**
- Prefer explicit `position_type`
- Fallback to `order_of_ministry`: "priest" -> Rector/Vicar/Priest-in-Charge, "deacon" -> Deacon, "bishop" -> Bishop
- Name contains `\n` (newline): "Priest-in-Charge Shared Ministry"

### Output Files

| File | Content |
|------|---------|
| `enriched-positions.json` | Public positions (fully enriched) |
| `enriched-extended.json` | Extended positions (fully enriched) |
| `position-church-map.json` | vh_id to church match mapping |
| `positions.json` | Raw scraped positions |
| `changes.json` | Recent position changes |
| `meta.json` | Scrape metadata |
| `all-profiles.json` | All deep-scraped profiles |
| `profile-fields.json` | Profile field data by vh_id |

---

## Parish Matching

File: `web/scripts/stages/match-parishes.js`

### Strategy Execution Order

Strategies run in order; first match wins.

| # | Strategy | Confidence | Description |
|---|----------|-----------|-------------|
| 1 | Website domain | exact | Match normalized website domains (skip generic domains) |
| 2 | Email domain | exact | Match email @domain (skip generic domains) |
| 3 | Phone (same diocese) | exact | Normalized phone match within same diocese |
| 4 | Name + diocese via aliases | high | Church name normalized + diocese match via `parish_aliases` table |
| 4b | Name + city (no diocese) | medium | Same as 4 but city instead of diocese |
| 4c | Name only via aliases | medium | Name match only, narrow by website/phone if ambiguous |
| 5 | City-based fallback | medium | City from name parens + diocese match |
| 6 | Word-as-city | low | Try each word in position name as a city |

### Multi-Parish Matching

For names with `\n` or " and " (e.g. "St. Paul's and Trinity Church"):
1. Try unsplit match
2. Split on `\n` and " and " (preserve "Saints X and Y" patterns)
3. Match each part independently
4. Return whichever set produces more distinct matches

### Manual NID Overrides

Keyed by `vh_id` in `NID_OVERRIDES` at the top of the file. Applied before automatic strategies.

### Generic Domain List

Domains skipped for website/email matching include: gmail, yahoo, outlook, hotmail, aol, icloud, comcast, verizon, att, and ~50+ others. Also skips diocese-related patterns (`/^dio/`, `/diocese/`, `/episcopal/`).

### Performance

Strategies 1-3 use pre-loaded lookup maps (built once per pipeline run) instead of per-position SQL queries. Strategies 4+ use indexed queries against `parish_aliases`.

---

## Compensation Estimation

File: `web/scripts/stages/compute-compensation.js`

### Diocesan Benchmarks

Query `compensation_diocesan` table for the position's diocese. Use most recent year. Attaches: `diocese_median`, `diocese_female_median`, `diocese_male_median`, `diocese_clergy_count`, `year`.

### CPG Position Type Mapping

| Canonical Type | CPG Category |
|---------------|-------------|
| Rector | "Senior Rector" if ASA >= 400, else "Solo Rector" |
| Vicar | Solo Rector |
| Priest-in-Charge | Solo Rector |
| Assistant / Associate / Curate / Senior Associate | Assistant |
| Deacon | Parish Deacon |

### Stipend Parsing

Extracts numeric value from salary fields. Returns null for sentinel values: "DOE", "TBD", "NEGOTIABLE", "N/A", "SEE", "CONTACT", "VARIES".

**Priority order:**
1. `minimum_stipend` / `maximum_stipend` fields
2. Profile fields for matching VH ID
3. `salary_range` field (regex: `\$?([\d,]+)\s*[-/]-\s*\$?([\d,]+)`)
4. `all_fields` Range entries

### Total Compensation Calculation

```
base_pay = (min + max) / 2   (or just min/max if only one exists)
housing  = $20,000 if housing type indicates rectory/provided housing
total    = base_pay + housing
```

**Housing detection:** If `housing_type` contains "rectory", "housing provided", "bed", "bath", or "required" (but NOT "no housing"), add $20,000.

---

## Diocese Percentiles

File: `web/scripts/stages/compute-percentiles.js`

For each diocese, collects ASA, plate-and-pledge, and membership values from `parochial_data` table. Uses most recent year per parish. Only positive values.

**Percentile** = percentage of diocese values strictly less than the position's value, rounded to nearest integer (0-100).

Output: `position.diocese_percentiles = { asa, asa_value, plate_pledge, plate_pledge_value, membership, membership_value }`

---

## Similar Positions

File: `web/scripts/stages/find-similar.js`

### Scoring (max 10 pts)

| Dimension | Points | Tolerance |
|-----------|--------|-----------|
| ASA | +3 | Within +/-25% (ratio 0.75-1.25) |
| Compensation | +2 | Within +/-20% (ratio 0.8-1.2) |
| State | +2 | Exact match |
| Position Type | +2 | Any canonical type overlap |
| Housing Type | +1 | Case-insensitive match |

- Minimum score to qualify: **3 points**
- Maximum returned: **15 positions**
- Only positions with at least ASA or estimated_total_comp are scored

---

## Scraper Workflows & Schedules

### Regular Scrape (`scrape-positions.yml`)
- **Schedule:** 6 AM and 6 PM UTC daily
- **What:** Scrapes public VocationHub search results (~42 positions)
- **DB behavior:** Downloads DB from `db-latest` release, updates `scraped_positions` and `scraper_meta` (changes/meta only -- profile data is guarded), re-uploads DB
- **Triggers:** build-and-deploy workflow via repository_dispatch

### Deep Scrape (`deep-scrape.yml`)
- **Schedule:** Sunday 3 AM UTC weekly
- **What:** Discovers new profile IDs (+500 from max), scrapes all known profiles in chunks of 200, imports into DB, runs enrichment, deploys
- **Timeout:** 65 minutes total, 50 minutes for scraping
- **Commits:** `data/discovered-ids.json` and `web/public/data/` changes

### Build & Deploy (`build-and-deploy.yml`)
- **Schedule:** Daily at 12 PM UTC
- **Triggers:** Push to main (web changes), repository_dispatch ("build"), manual
- **What:** Runs enrichment, generates clergy data, lints, builds Next.js, deploys to GitHub Pages

### Data Refresh (`data-refresh-v2.yml`)
- **Schedule:** Monthly, 1st day at 5 AM UTC
- **What:** Refreshes all external data sources (Asset Map, ECDPlus parishes/clergy, Census, parochial reports), merges parishes, uploads DB, triggers build

### DB Storage

The SQLite database (`vocationhub.db`) is stored as a GitHub release artifact under the tag `db-latest`. Workflows download it, modify it, and re-upload with `--clobber`.

---

## Key Thresholds Reference

| Rule | Value | File |
|------|-------|------|
| Quality score: no-name cap | 45 | quality-scores.js |
| Quality score: visibility threshold | >= 50 for `extended` | quality-scores.js |
| Quality score: default view gate | >= 85 | filter-defaults.ts |
| Receiving names recency (quality bonus) | 12 months | quality-scores.js |
| Very recent bonus | 3 months | quality-scores.js |
| Extended status inference cutoff | 1 year | run-enrichment.js |
| "Is new" from receiving_names_from | 30 days | data.ts |
| "Is new" from updated_on_hub | 14 days | data.ts |
| Housing value assumption | $20,000 | compute-compensation.js |
| Similar positions: ASA tolerance | +/-25% | find-similar.js |
| Similar positions: comp tolerance | +/-20% | find-similar.js |
| Similar positions: min score | 3 | find-similar.js |
| Similar positions: max returned | 15 | find-similar.js |
| Deep scrape: discovery window | +500 IDs | deep-scrape.yml |
| Deep scrape: chunk size | 200 profiles | deep-scrape.yml |
| Phone match: minimum digits | 10 | match-parishes.js |
| Bogus date sentinel | 01/01/1900 | run-enrichment.js |
| Senior Rector ASA threshold | >= 400 | compute-compensation.js |
