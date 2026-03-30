#!/usr/bin/env node
/**
 * Fetches census demographic data (median household income, population) from
 * the US Census Bureau ACS 5-year estimates for all zip codes found in the
 * enriched position data.
 *
 * Uses ZCTA (Zip Code Tabulation Area) geography.
 * No API key is required for basic access, but the Census Bureau asks callers
 * to be courteous with request volume. We batch 50 ZCTAs per request and add
 * a 250ms delay between batches to stay well within rate limits.
 *
 * Output: public/data/census-data.json  (keyed by 5-digit zip code)
 * On any error the script writes an empty JSON object so the build continues.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../public/data');
const OUT_FILE = path.join(DATA_DIR, 'census-data.json');

// ACS 5-year estimates, 2022 vintage
const BASE_URL = 'https://api.census.gov/data/2022/acs/acs5';

// Census sentinel for "data not available"
const NOT_AVAILABLE = -666666666;

// How many ZCTAs to request per batch (keeps URLs manageable)
const BATCH_SIZE = 50;

// Delay between batch requests (ms) to respect Census Bureau rate limits
const BATCH_DELAY_MS = 250;

function load(name) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

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
 * Collect unique 5-digit zip codes from enriched position files.
 */
function collectZipCodes() {
  const zips = new Set();

  const files = ['enriched-positions.json', 'enriched-extended.json', 'positions.json'];
  for (const name of files) {
    const data = load(name);
    if (!Array.isArray(data)) continue;
    for (const pos of data) {
      const raw = (pos.church_info && pos.church_info.zip) || pos.postal_code || '';
      const zip = cleanZip(raw);
      if (zip) zips.add(zip);
    }
  }

  return Array.from(zips).sort();
}

/**
 * Fetch census data for a batch of ZCTAs.
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
  console.log('Fetching census demographic data...');

  const zips = collectZipCodes();
  if (zips.length === 0) {
    console.log('  No zip codes found; writing empty census data.');
    fs.writeFileSync(OUT_FILE, JSON.stringify({}, null, 2));
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

  console.log(`  Census data fetched for ${totalFetched} zip codes`);
  fs.writeFileSync(OUT_FILE, JSON.stringify(censusData, null, 2));
  console.log(`  Written to census-data.json`);
}

main().catch(err => {
  console.error(`Census fetch failed: ${err.message}`);
  console.log('  Writing empty census data so build can continue.');
  fs.writeFileSync(OUT_FILE, JSON.stringify({}, null, 2));
  process.exit(0);
});
