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
