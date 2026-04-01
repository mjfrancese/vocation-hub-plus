#!/usr/bin/env node
/**
 * Fetches all clergy from the ECDPlus REST API and writes them to the
 * clergy and clergy_positions tables.
 *
 * Usage:
 *   node fetch-ecdplus-clergy.js
 *
 * Pure functions (parseClergyList, parseClergyDetail, upsertClergy) are
 * exported for testing.
 */

'use strict';

const { getDb, closeDb, logFetch } = require('./db');

const BASE_URL = 'https://ea-api.cpg.org/common-access-api/1.0/ecdPlus';
const RATE_LIMIT_MS = 50;
const LOG_INTERVAL = 1000;
const BATCH_SIZE = 1000;
const CONCURRENCY = 10;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// parseClergyList -- extract essentials from bulk search response
// ---------------------------------------------------------------------------

/**
 * @param {object|null} response - JSON body from GET /search/clergy.json
 * @returns {Array<{guid: string, first_name: string, middle_name: string, last_name: string, street_city: string, street_state: string}>}
 */
function parseClergyList(response) {
  const items = response?.data || response?.results;
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  return items.map(r => ({
    guid: r.guid,
    first_name: r.first_name || '',
    middle_name: r.middle_name || '',
    last_name: r.last_name || '',
    street_city: r.street_city || '',
    street_state: r.street_state || '',
  }));
}

// ---------------------------------------------------------------------------
// parseClergyDetail -- extract and parse a single clergy detail response
// ---------------------------------------------------------------------------

const CITY_STATE_ZIP_RE = /^(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?\s*$/;

/**
 * @param {object} detail - JSON body from GET /clergies/{guid}.json
 * @returns {object} parsed clergy detail data
 */
function parseClergyDetail(detail) {
  let address = null;
  let city = null;
  let state = null;
  let zip = null;

  if (detail.published_address && typeof detail.published_address === 'object') {
    // Structured address object from API
    const parts = [detail.published_address.address1, detail.published_address.address2, detail.published_address.address3]
      .filter(Boolean);
    address = parts.join(', ') || null;
    city = detail.published_address.city || null;
    state = detail.published_address.state || null;
    zip = detail.published_address.postal_code || null;
  } else if (detail.published_address && typeof detail.published_address === 'string') {
    // Multiline string format (used in tests)
    const lines = detail.published_address.split('\n');
    if (lines.length >= 2) {
      const lastLine = lines[lines.length - 1];
      const match = lastLine.match(CITY_STATE_ZIP_RE);
      if (match) {
        address = lines.slice(0, -1).join('\n');
        city = match[1];
        state = match[2];
        zip = match[3] || null;
      } else {
        address = detail.published_address;
      }
    } else {
      const match = lines[0].match(CITY_STATE_ZIP_RE);
      if (match) {
        city = match[1];
        state = match[2];
        zip = match[3] || null;
      } else {
        address = detail.published_address;
      }
    }
  }

  // Ordination data
  const ord = detail.ordination_information || {};
  const diac = ord.diaconal_data || {};
  const priest = ord.priesting_data || {};
  const bishop = ord.bishop_consecration_data || {};

  // Positions -- handle both "Present" and null for current positions,
  // and start_date as number (year) or string (MM/DD/YYYY)
  const rawPositions = detail.principal_positions || [];
  const positions = rawPositions.map(p => {
    const endDate = p.end_date;
    const isCurrent = endDate == null || endDate === 'Present' ? 1 : 0;
    const startDate = typeof p.start_date === 'number'
      ? `01/01/${p.start_date}`
      : (p.start_date || null);
    const endDateStr = isCurrent ? null
      : (typeof endDate === 'number' ? `12/31/${endDate}` : endDate);

    // Format employer_address if it's an object
    let empAddr = p.employer_address || '';
    if (empAddr && typeof empAddr === 'object') {
      empAddr = [empAddr.address1, empAddr.city, empAddr.state, empAddr.postal_code]
        .filter(Boolean).join(', ');
    }

    return {
      position_title: p.position_title || '',
      employer_name: p.employer_name || '',
      employer_id: p.employer_id || '',
      employer_address: empAddr,
      employer_phone: p.employer_phone_number || '',
      start_date: startDate,
      end_date: endDateStr,
      is_current: isCurrent,
    };
  });

  return {
    email: detail.email_address || '',
    canonical_residence: detail.canonical_residence || '',
    address,
    city,
    state,
    zip,
    country: null,
    diaconate_date: diac.deacon_date || diac.date || null,
    diaconate_bishop: diac.bishop || null,
    diaconate_diocese: diac.diocese || null,
    priesting_date: priest.priest_date || priest.date || null,
    priesting_bishop: priest.bishop || null,
    priesting_diocese: priest.diocese || null,
    bishop_consecration_date: bishop.consecration_date || bishop.date || null,
    bishop_consecration_diocese: bishop.diocese || null,
    positions,
  };
}

// ---------------------------------------------------------------------------
// upsertClergy -- insert or update a clergy record and replace positions
// ---------------------------------------------------------------------------

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} data - merged list + detail data
 * @returns {'new'|'updated'}
 */
function upsertClergy(db, data) {
  const existing = db.prepare('SELECT guid FROM clergy WHERE guid = ?').get(data.guid);

  if (existing) {
    db.prepare(`
      UPDATE clergy SET
        first_name = COALESCE(NULLIF(@first_name, ''), first_name),
        middle_name = COALESCE(NULLIF(@middle_name, ''), middle_name),
        last_name = COALESCE(NULLIF(@last_name, ''), last_name),
        email = COALESCE(NULLIF(@email, ''), email),
        canonical_residence = COALESCE(NULLIF(@canonical_residence, ''), canonical_residence),
        address = COALESCE(NULLIF(@address, ''), address),
        city = COALESCE(NULLIF(@city, ''), city),
        state = COALESCE(NULLIF(@state, ''), state),
        zip = COALESCE(NULLIF(@zip, ''), zip),
        country = COALESCE(NULLIF(@country, ''), country),
        diaconate_date = COALESCE(NULLIF(@diaconate_date, ''), diaconate_date),
        diaconate_bishop = COALESCE(NULLIF(@diaconate_bishop, ''), diaconate_bishop),
        diaconate_diocese = COALESCE(NULLIF(@diaconate_diocese, ''), diaconate_diocese),
        priesting_date = COALESCE(NULLIF(@priesting_date, ''), priesting_date),
        priesting_bishop = COALESCE(NULLIF(@priesting_bishop, ''), priesting_bishop),
        priesting_diocese = COALESCE(NULLIF(@priesting_diocese, ''), priesting_diocese),
        bishop_consecration_date = COALESCE(NULLIF(@bishop_consecration_date, ''), bishop_consecration_date),
        bishop_consecration_diocese = COALESCE(NULLIF(@bishop_consecration_diocese, ''), bishop_consecration_diocese),
        fetched_at = datetime('now'),
        updated_at = datetime('now')
      WHERE guid = @guid
    `).run({
      guid: data.guid,
      first_name: data.first_name || '',
      middle_name: data.middle_name || '',
      last_name: data.last_name || '',
      email: data.email || '',
      canonical_residence: data.canonical_residence || '',
      address: data.address || '',
      city: data.city || '',
      state: data.state || '',
      zip: data.zip || '',
      country: data.country || '',
      diaconate_date: data.diaconate_date || '',
      diaconate_bishop: data.diaconate_bishop || '',
      diaconate_diocese: data.diaconate_diocese || '',
      priesting_date: data.priesting_date || '',
      priesting_bishop: data.priesting_bishop || '',
      priesting_diocese: data.priesting_diocese || '',
      bishop_consecration_date: data.bishop_consecration_date || '',
      bishop_consecration_diocese: data.bishop_consecration_diocese || '',
    });

    // Replace all positions
    db.prepare('DELETE FROM clergy_positions WHERE clergy_guid = ?').run(data.guid);
    _insertPositions(db, data.guid, data.positions || []);

    return 'updated';
  }

  // Insert new clergy
  db.prepare(`
    INSERT INTO clergy (
      guid, first_name, middle_name, last_name, email,
      canonical_residence, address, city, state, zip, country,
      diaconate_date, diaconate_bishop, diaconate_diocese,
      priesting_date, priesting_bishop, priesting_diocese,
      bishop_consecration_date, bishop_consecration_diocese
    ) VALUES (
      @guid, @first_name, @middle_name, @last_name, @email,
      @canonical_residence, @address, @city, @state, @zip, @country,
      @diaconate_date, @diaconate_bishop, @diaconate_diocese,
      @priesting_date, @priesting_bishop, @priesting_diocese,
      @bishop_consecration_date, @bishop_consecration_diocese
    )
  `).run({
    guid: data.guid,
    first_name: data.first_name || null,
    middle_name: data.middle_name || null,
    last_name: data.last_name || null,
    email: data.email || null,
    canonical_residence: data.canonical_residence || null,
    address: data.address || null,
    city: data.city || null,
    state: data.state || null,
    zip: data.zip || null,
    country: data.country || null,
    diaconate_date: data.diaconate_date || null,
    diaconate_bishop: data.diaconate_bishop || null,
    diaconate_diocese: data.diaconate_diocese || null,
    priesting_date: data.priesting_date || null,
    priesting_bishop: data.priesting_bishop || null,
    priesting_diocese: data.priesting_diocese || null,
    bishop_consecration_date: data.bishop_consecration_date || null,
    bishop_consecration_diocese: data.bishop_consecration_diocese || null,
  });

  _insertPositions(db, data.guid, data.positions || []);

  return 'new';
}

/**
 * Insert position rows for a clergy member.
 * @param {import('better-sqlite3').Database} db
 * @param {string} clergyGuid
 * @param {Array} positions
 */
function _insertPositions(db, clergyGuid, positions) {
  const stmt = db.prepare(`
    INSERT INTO clergy_positions (
      clergy_guid, position_title, employer_name, employer_id,
      employer_address, employer_phone, start_date, end_date, is_current
    ) VALUES (
      @clergy_guid, @position_title, @employer_name, @employer_id,
      @employer_address, @employer_phone, @start_date, @end_date, @is_current
    )
  `);

  for (const p of positions) {
    stmt.run({
      clergy_guid: clergyGuid,
      position_title: p.position_title || null,
      employer_name: p.employer_name || null,
      employer_id: p.employer_id || null,
      employer_address: p.employer_address || null,
      employer_phone: p.employer_phone || null,
      start_date: p.start_date || null,
      end_date: p.end_date || null,
      is_current: p.is_current,
    });
  }
}

// ---------------------------------------------------------------------------
// fetchConcurrent -- process items with controlled concurrency
// ---------------------------------------------------------------------------

/**
 * Process items with controlled concurrency.
 * @param {Array} items - Items to process
 * @param {number} concurrency - Max concurrent operations
 * @param {Function} fn - Async function to process each item, receives (item, index)
 * @returns {Promise<Array>} Results (may contain undefined for skipped items)
 */
async function fetchConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// fetchAllClergy -- CLI entry point (async, makes network calls)
// ---------------------------------------------------------------------------

async function fetchAllClergy() {
  const start = Date.now();
  console.log('Fetching clergy list from ECDPlus...');

  const listUrl = `${BASE_URL}/search/clergy.json`;
  const listResponse = await fetch(listUrl);
  if (!listResponse.ok) {
    throw new Error(`ECDPlus clergy list request failed: ${listResponse.status} ${listResponse.statusText}`);
  }

  const listData = await listResponse.json();
  const clergyList = parseClergyList(listData);
  console.log(`Found ${clergyList.length} clergy in bulk list.`);

  const db = getDb();
  let newCount = 0;
  let updatedCount = 0;

  const processBatch = (items) => {
    const txn = db.transaction((entries) => {
      for (const entry of entries) {
        const result = upsertClergy(db, entry);
        if (result === 'new') newCount++;
        else updatedCount++;
      }
    });
    txn(items);
  };

  let fetchedCount = 0;

  const allResults = await fetchConcurrent(clergyList, CONCURRENCY, async (c, i) => {
    try {
      const detailUrl = `${BASE_URL}/clergies/${c.guid}.json`;
      const detailResponse = await fetch(detailUrl);
      if (!detailResponse.ok) {
        console.warn(`  Skipping ${c.first_name} ${c.last_name} (${c.guid}): HTTP ${detailResponse.status}`);
        await sleep(RATE_LIMIT_MS);
        fetchedCount++;
        return null;
      }

      const detailData = await detailResponse.json();
      const parsed = parseClergyDetail(detailData.data || detailData);
      await sleep(RATE_LIMIT_MS);

      fetchedCount++;
      if (fetchedCount % LOG_INTERVAL === 0) {
        console.log(`  Progress: ${fetchedCount}/${clergyList.length}`);
      }

      return {
        guid: c.guid,
        first_name: c.first_name,
        middle_name: c.middle_name,
        last_name: c.last_name,
        ...parsed,
      };
    } catch (err) {
      console.warn(`  Error fetching ${c.first_name} ${c.last_name} (${c.guid}): ${err.message}`);
      await sleep(RATE_LIMIT_MS);
      fetchedCount++;
      return null;
    }
  });

  // Write to DB in batches
  const validResults = allResults.filter(Boolean);
  console.log(`Fetched ${validResults.length}/${clergyList.length} clergy details. Writing to DB...`);

  for (let i = 0; i < validResults.length; i += BATCH_SIZE) {
    const batch = validResults.slice(i, i + BATCH_SIZE);
    processBatch(batch);
  }

  const duration_ms = Date.now() - start;
  console.log(`Done: ${newCount} new, ${updatedCount} updated in ${(duration_ms / 1000).toFixed(1)}s`);

  logFetch('ecdplus-clergy', {
    records_total: newCount + updatedCount,
    records_new: newCount,
    records_updated: updatedCount,
    duration_ms,
    status: 'success',
  });

  closeDb();
}

// CLI entry point
if (require.main === module) {
  fetchAllClergy().catch(err => {
    console.error(`ECDPlus clergy fetch failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseClergyList, parseClergyDetail, upsertClergy, fetchAllClergy };
