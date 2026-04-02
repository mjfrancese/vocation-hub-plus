# Census Bureau API Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Census Bureau API fetcher into the DB-backed pipeline so census data is automatically fetched and stored during monthly data refreshes.

**Architecture:** Modify the existing `fetch-census-data.js` to read zip codes from the `parishes` DB table (instead of JSON files) and write results to the `census_data` DB table (instead of a JSON file). Add it to the data refresh workflow. The downstream enrichment stage (`attach-census.js`) and clergy data generation (`generate-clergy-data.js`) already read from the `census_data` table, so no changes are needed there.

**Tech Stack:** Node.js, better-sqlite3, US Census Bureau ACS 5-year API, Vitest

---

## File Structure

### Modified Files
- `web/scripts/fetch-census-data.js` -- switch from JSON I/O to DB I/O
- `.github/workflows/data-refresh-v2.yml` -- add census fetch step

### New Files
- `web/scripts/__tests__/fetch-census-data.test.js` -- tests for the DB-backed fetcher

---

## Task 1: Refactor fetch-census-data.js to Use DB

Convert the fetcher from reading JSON files for zip codes and writing a JSON output file, to reading zips from the `parishes` table and writing to the `census_data` table.

**Files:**
- Modify: `web/scripts/fetch-census-data.js`
- Create: `web/scripts/__tests__/fetch-census-data.test.js`

- [ ] **Step 1: Write failing tests for DB-backed functions**

```javascript
// web/scripts/__tests__/fetch-census-data.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const path = require('path');
const os = require('os');
const fs = require('fs');

const { getDb, closeDb } = require('../db.js');

let db, testDbPath;

beforeEach(() => {
  testDbPath = path.join(os.tmpdir(), `vocationhub-census-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.VOCATIONHUB_DB_PATH = testDbPath;
  db = getDb();
});

afterEach(() => {
  closeDb();
  delete process.env.VOCATIONHUB_DB_PATH;
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}
});

describe('collectZipCodesFromDb', () => {
  it('should collect unique zip codes from parishes table', () => {
    db.prepare(`INSERT INTO parishes (id, name, diocese, zip, source)
      VALUES (1, 'St. Paul''s', 'Massachusetts', '02134', 'asset_map')`).run();
    db.prepare(`INSERT INTO parishes (id, name, diocese, zip, source)
      VALUES (2, 'St. Mark''s', 'Massachusetts', '02134', 'asset_map')`).run();
    db.prepare(`INSERT INTO parishes (id, name, diocese, zip, source)
      VALUES (3, 'Trinity', 'New York', '10001', 'ecdplus')`).run();

    const { collectZipCodesFromDb } = require('../fetch-census-data.js');
    const zips = collectZipCodesFromDb(db);

    expect(zips).toEqual(['02134', '10001']);
  });

  it('should normalize zip codes to 5 digits', () => {
    db.prepare(`INSERT INTO parishes (id, name, diocese, zip, source)
      VALUES (1, 'St. Paul''s', 'Massachusetts', '02134-2308', 'asset_map')`).run();

    const { collectZipCodesFromDb } = require('../fetch-census-data.js');
    const zips = collectZipCodesFromDb(db);

    expect(zips).toEqual(['02134']);
  });

  it('should skip parishes with no or invalid zip', () => {
    db.prepare(`INSERT INTO parishes (id, name, diocese, source)
      VALUES (1, 'St. Paul''s', 'Massachusetts', 'asset_map')`).run();
    db.prepare(`INSERT INTO parishes (id, name, diocese, zip, source)
      VALUES (2, 'St. Mark''s', 'Massachusetts', '123', 'asset_map')`).run();

    const { collectZipCodesFromDb } = require('../fetch-census-data.js');
    const zips = collectZipCodesFromDb(db);

    expect(zips).toEqual([]);
  });
});

describe('writeCensusToDb', () => {
  it('should insert census data rows', () => {
    const { writeCensusToDb } = require('../fetch-census-data.js');
    const data = {
      '02134': { median_household_income: 75000, population: 30000 },
      '10001': { median_household_income: 95000, population: 21000 },
    };

    writeCensusToDb(db, data);

    const rows = db.prepare('SELECT * FROM census_data ORDER BY zip').all();
    expect(rows).toHaveLength(2);
    expect(rows[0].zip).toBe('02134');
    expect(rows[0].median_income).toBe(75000);
    expect(rows[0].population).toBe(30000);
    expect(rows[1].zip).toBe('10001');
    expect(rows[1].median_income).toBe(95000);
  });

  it('should update existing rows on conflict', () => {
    db.prepare(`INSERT INTO census_data (zip, median_income, population) VALUES ('02134', 50000, 20000)`).run();

    const { writeCensusToDb } = require('../fetch-census-data.js');
    writeCensusToDb(db, { '02134': { median_household_income: 75000, population: 30000 } });

    const row = db.prepare('SELECT * FROM census_data WHERE zip = ?').get('02134');
    expect(row.median_income).toBe(75000);
    expect(row.population).toBe(30000);
  });

  it('should handle partial data (income only, population only)', () => {
    const { writeCensusToDb } = require('../fetch-census-data.js');
    writeCensusToDb(db, {
      '02134': { median_household_income: 75000 },
      '10001': { population: 21000 },
    });

    const row1 = db.prepare('SELECT * FROM census_data WHERE zip = ?').get('02134');
    expect(row1.median_income).toBe(75000);
    expect(row1.population).toBeNull();

    const row2 = db.prepare('SELECT * FROM census_data WHERE zip = ?').get('10001');
    expect(row2.median_income).toBeNull();
    expect(row2.population).toBe(21000);
  });
});

describe('cleanZip', () => {
  it('should extract 5-digit zip from various formats', () => {
    const { cleanZip } = require('../fetch-census-data.js');
    expect(cleanZip('02134')).toBe('02134');
    expect(cleanZip('02134-2308')).toBe('02134');
    expect(cleanZip('  02134  ')).toBe('02134');
    expect(cleanZip(null)).toBeNull();
    expect(cleanZip('')).toBeNull();
    expect(cleanZip('123')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/scripts/__tests__/fetch-census-data.test.js`
Expected: FAIL -- `collectZipCodesFromDb` and `writeCensusToDb` not exported

- [ ] **Step 3: Rewrite fetch-census-data.js**

Replace the entire file with the DB-backed version. Key changes:
- `collectZipCodesFromDb(db)` reads from `parishes` table instead of JSON files
- `writeCensusToDb(db, data)` writes to `census_data` table instead of JSON file
- `fetchBatch(zctas)` stays the same (Census API call logic is unchanged)
- `main()` orchestrates: get DB, collect zips, fetch from API, write to DB
- Export `collectZipCodesFromDb`, `writeCensusToDb`, `cleanZip` for testing

```javascript
#!/usr/bin/env node
/**
 * fetch-census-data.js
 *
 * Fetches census demographic data (median household income, population) from
 * the US Census Bureau ACS 5-year estimates for all zip codes found in the
 * parishes table, and writes results to the census_data table.
 *
 * Uses ZCTA (Zip Code Tabulation Area) geography.
 * No API key is required for basic access, but the Census Bureau asks callers
 * to be courteous with request volume. We batch 50 ZCTAs per request and add
 * a 250ms delay between batches to stay well within rate limits.
 *
 * CommonJS module -- run directly or import functions for testing.
 */

'use strict';

const { getDb, closeDb, logFetch } = require('./db.js');

// ACS 5-year estimates, 2022 vintage
const BASE_URL = 'https://api.census.gov/data/2022/acs/acs5';

// Census sentinel for "data not available"
const NOT_AVAILABLE = -666666666;

// How many ZCTAs to request per batch (keeps URLs manageable)
const BATCH_SIZE = 50;

// Delay between batch requests (ms) to respect Census Bureau rate limits
const BATCH_DELAY_MS = 250;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract a clean 5-digit zip code from a raw string.
 * Handles formats like "84102", "84102-2308", etc.
 */
function cleanZip(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, '').substring(0, 5);
  return digits.length === 5 ? digits : null;
}

/**
 * Collect unique 5-digit zip codes from the parishes table.
 * @param {import('better-sqlite3').Database} db
 * @returns {string[]} sorted array of unique 5-digit zip codes
 */
function collectZipCodesFromDb(db) {
  const rows = db.prepare(
    "SELECT DISTINCT zip FROM parishes WHERE zip IS NOT NULL AND zip != ''"
  ).all();

  const zips = new Set();
  for (const row of rows) {
    const zip = cleanZip(row.zip);
    if (zip) zips.add(zip);
  }
  return Array.from(zips).sort();
}

/**
 * Write census data to the census_data table (upsert).
 * @param {import('better-sqlite3').Database} db
 * @param {Object<string, {median_household_income?: number, population?: number}>} data
 */
function writeCensusToDb(db, data) {
  const upsert = db.prepare(`
    INSERT INTO census_data (zip, median_income, population, fetched_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(zip) DO UPDATE SET
      median_income = excluded.median_income,
      population = excluded.population,
      fetched_at = excluded.fetched_at
  `);

  const run = db.transaction(() => {
    for (const [zip, entry] of Object.entries(data)) {
      upsert.run(
        zip,
        entry.median_household_income ?? null,
        entry.population ?? null
      );
    }
  });

  run();
}

/**
 * Fetch census data for a batch of ZCTAs from the Census Bureau API.
 * Returns an array of [income, population, name, zcta] rows, or empty on error.
 */
async function fetchBatch(zctas) {
  const zcList = zctas.join(',');
  const url = `${BASE_URL}?get=B19013_001E,B01003_001E,NAME&for=zip%20code%20tabulation%20area:${zcList}`;

  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`  Census API returned ${response.status} for batch starting with ${zctas[0]}`);
    return [];
  }

  const rows = await response.json();
  // First row is headers, rest is data
  if (!Array.isArray(rows) || rows.length < 2) return [];
  return rows.slice(1);
}

async function main() {
  const db = getDb();
  const start = Date.now();

  console.log('Fetching census demographic data...');

  const zips = collectZipCodesFromDb(db);
  if (zips.length === 0) {
    console.log('  No zip codes found in parishes table.');
    logFetch('census_data', {
      records_total: 0, records_new: 0, records_updated: 0,
      duration_ms: Date.now() - start, status: 'success',
    });
    closeDb();
    return;
  }

  console.log(`  Found ${zips.length} unique zip codes`);

  const censusData = {};
  const batches = [];
  for (let i = 0; i < zips.length; i += BATCH_SIZE) {
    batches.push(zips.slice(i, i + BATCH_SIZE));
  }

  console.log(`  Fetching in ${batches.length} batches (${BATCH_SIZE} per request, ${BATCH_DELAY_MS}ms delay)...`);

  let totalFetched = 0;
  for (let b = 0; b < batches.length; b++) {
    try {
      const rows = await fetchBatch(batches[b]);
      for (const row of rows) {
        // row: [income, population, name, zcta]
        const zcta = row[3];
        const income = parseInt(row[0], 10);
        const population = parseInt(row[1], 10);

        const entry = {};
        if (!isNaN(income) && income !== NOT_AVAILABLE) {
          entry.median_household_income = income;
        }
        if (!isNaN(population) && population !== NOT_AVAILABLE) {
          entry.population = population;
        }

        if (Object.keys(entry).length > 0) {
          censusData[zcta] = entry;
          totalFetched++;
        }
      }
    } catch (err) {
      console.warn(`  Error fetching batch ${b + 1}: ${err.message}`);
    }

    // Rate-limit delay between batches (skip after last batch)
    if (b < batches.length - 1) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  writeCensusToDb(db, censusData);

  logFetch('census_data', {
    records_total: zips.length,
    records_new: totalFetched,
    records_updated: 0,
    duration_ms: Date.now() - start,
    status: 'success',
  });

  console.log(`  Census data fetched for ${totalFetched} / ${zips.length} zip codes, written to DB`);
  closeDb();
}

module.exports = { collectZipCodesFromDb, writeCensusToDb, cleanZip, fetchBatch };

if (require.main === module) {
  main().catch(err => {
    console.error(`Census fetch failed: ${err.message}`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/scripts/__tests__/fetch-census-data.test.js`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run web/scripts/__tests__/`
Expected: PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add web/scripts/fetch-census-data.js web/scripts/__tests__/fetch-census-data.test.js
git commit -m "feat: refactor census fetcher to read/write DB instead of JSON files"
```

---

## Task 2: Wire Census Fetch into Data Refresh Workflow

Add the census fetch step to the data refresh workflow, running after parish merge and identity population (so all zips are available).

**Files:**
- Modify: `.github/workflows/data-refresh-v2.yml`

- [ ] **Step 1: Add census fetch step**

In `.github/workflows/data-refresh-v2.yml`, add a step after "Populate parish identity table" and before "Scrape parochial reports":

```yaml
      - name: Fetch Census Bureau data
        run: node web/scripts/fetch-census-data.js
        timeout-minutes: 15
        env:
          VOCATIONHUB_DB_PATH: ${{ github.workspace }}/data/vocationhub.db
```

The 15-minute timeout accounts for ~7000 parishes with unique zips = ~140 batches of 50, each with 250ms delay plus API response time.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/data-refresh-v2.yml
git commit -m "feat: add census data fetch step to data refresh workflow"
```

---

## Task 3: Clean Up Legacy Census JSON References

Remove the legacy JSON census file and its references now that census data lives in the DB.

**Files:**
- Delete: `web/public/data/census-data.json` (tracked in git)
- Ignore: `web/out/data/census-data.json` (build artifact, not tracked)

- [ ] **Step 1: Remove legacy census JSON files**

```bash
rm -f web/out/data/census-data.json
```

(The `web/public/data/census-data.json` will be removed from git via `git rm` in Step 3.)

- [ ] **Step 2: Verify no remaining references to census-data.json**

Search for any remaining references to the old JSON file:

```bash
grep -r "census-data.json" web/scripts/ web/src/ --include='*.js' --include='*.ts' --include='*.tsx'
```

Expected: No results (all census consumers already use the DB table via `attach-census.js` and `generate-clergy-data.js`).

- [ ] **Step 3: Commit**

```bash
git rm -f web/public/data/census-data.json
git commit -m "chore: remove legacy census JSON file, data now lives in DB"
```

---

## Task Summary

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1 | Refactor fetcher to use DB (read parishes, write census_data) | None |
| 2 | Wire into data refresh workflow | Task 1 |
| 3 | Clean up legacy JSON files | Task 1 |

Tasks 2 and 3 are independent of each other (both depend only on Task 1).
