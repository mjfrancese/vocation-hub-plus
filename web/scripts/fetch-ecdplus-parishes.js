#!/usr/bin/env node
/**
 * Fetches all parishes from the ECDPlus REST API and writes them to the
 * parishes table.
 *
 * Usage:
 *   node fetch-ecdplus-parishes.js
 *
 * Pure functions (parseParishList, parseParishDetail, upsertParish) are
 * exported for testing.
 */

'use strict';

const { getDb, closeDb, logFetch } = require('./db');
const { normalizeChurchName } = require('./lib/normalization');

const BASE_URL = 'https://ea-api.cpg.org/common-access-api/1.0/ecdPlus';
const RATE_LIMIT_MS = 50;
const LOG_INTERVAL = 500;
const CONCURRENCY = 10;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// parseParishList -- extract essentials from bulk search response
// ---------------------------------------------------------------------------

/**
 * @param {object|null} response - JSON body from GET /search/parish.json
 * @returns {Array<{id: string, name: string, type: string, phone: string, maps_link: string}>}
 */
function parseParishList(response) {
  const items = response?.data || response?.results;
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  return items.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type,
    phone: r.number || '',
    maps_link: r.maps_link || '',
  }));
}

// ---------------------------------------------------------------------------
// parseParishDetail -- extract and parse a single parish detail response
// ---------------------------------------------------------------------------

const CITY_STATE_ZIP_RE = /^(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?\s*$/;

/**
 * @param {object} detail - JSON body from GET /parishes/{id}.json
 * @returns {object} parsed parish data
 */
function parseParishDetail(detail) {
  let address = null;
  let city = null;
  let state = null;
  let zip = null;

  if (detail.address && typeof detail.address === 'object') {
    // Structured address object from API: {address1, address2, city, state, postal_code}
    const parts = [detail.address.address1, detail.address.address2, detail.address.address3]
      .filter(Boolean);
    address = parts.join(', ') || null;
    city = detail.address.city || null;
    state = detail.address.state || null;
    zip = detail.address.postal_code || null;
  } else if (detail.address && typeof detail.address === 'string') {
    // Multiline string format (used in tests)
    const lines = detail.address.split('\n');
    if (lines.length >= 2) {
      const lastLine = lines[lines.length - 1];
      const match = lastLine.match(CITY_STATE_ZIP_RE);
      if (match) {
        address = lines.slice(0, -1).join('\n');
        city = match[1];
        state = match[2];
        zip = match[3] || null;
      } else {
        address = detail.address;
      }
    } else {
      const match = lines[0].match(CITY_STATE_ZIP_RE);
      if (match) {
        city = match[1];
        state = match[2];
        zip = match[3] || null;
      } else {
        address = detail.address;
      }
    }
  }

  return {
    name: detail.name,
    diocese: detail.diocese || '',
    website: detail.website || '',
    email: detail.email || '',
    phone: detail.number || '',
    type: detail.type || '',
    clergy_count: detail.clergy_count ?? null,
    clergy: detail.clergy || [],
    maps_link: detail.maps_link || '',
    address,
    city,
    state,
    zip,
  };
}

// ---------------------------------------------------------------------------
// upsertParish -- insert or update a parish in the DB
// ---------------------------------------------------------------------------

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} data - must include ecdplus_id, name, diocese, and optional fields
 * @returns {'new'|'updated'}
 */
function upsertParish(db, data) {
  const existing = db.prepare('SELECT id, source FROM parishes WHERE ecdplus_id = ?').get(data.ecdplus_id);

  if (existing) {
    // Determine new source value
    let newSource;
    if (existing.source === 'asset_map') {
      newSource = 'both';
    } else {
      newSource = existing.source; // keep 'ecdplus' or 'both'
    }

    db.prepare(`
      UPDATE parishes SET
        name = COALESCE(NULLIF(@name, ''), name),
        diocese = COALESCE(NULLIF(@diocese, ''), diocese),
        address = COALESCE(NULLIF(@address, ''), address),
        city = COALESCE(NULLIF(@city, ''), city),
        state = COALESCE(NULLIF(@state, ''), state),
        zip = COALESCE(NULLIF(@zip, ''), zip),
        phone = COALESCE(NULLIF(@phone, ''), phone),
        email = COALESCE(NULLIF(@email, ''), email),
        website = COALESCE(NULLIF(@website, ''), website),
        type = COALESCE(NULLIF(@type, ''), type),
        ecdplus_clergy_count = @clergy_count,
        maps_link = COALESCE(NULLIF(@maps_link, ''), maps_link),
        source = @source,
        ecdplus_updated_at = datetime('now'),
        updated_at = datetime('now')
      WHERE ecdplus_id = @ecdplus_id
    `).run({
      ecdplus_id: data.ecdplus_id,
      name: data.name || '',
      diocese: data.diocese || '',
      address: data.address || '',
      city: data.city || '',
      state: data.state || '',
      zip: data.zip || '',
      phone: data.phone || '',
      email: data.email || '',
      website: data.website || '',
      type: data.type || '',
      clergy_count: data.clergy_count ?? null,
      maps_link: data.maps_link || '',
      source: newSource,
    });

    // Update alias
    const deleteAliases = db.prepare(
      "DELETE FROM parish_aliases WHERE parish_id = ? AND source = 'ecdplus'"
    );
    const insertAlias = db.prepare(
      "INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source) VALUES (?, ?, ?, 'ecdplus')"
    );
    deleteAliases.run(existing.id);
    if (data.name) {
      insertAlias.run(existing.id, data.name, normalizeChurchName(data.name));
    }

    return 'updated';
  }

  // Insert new parish
  const result = db.prepare(`
    INSERT INTO parishes (
      ecdplus_id, name, diocese, address, city, state, zip,
      phone, email, website, type, ecdplus_clergy_count, maps_link,
      source, ecdplus_updated_at
    ) VALUES (
      @ecdplus_id, @name, @diocese, @address, @city, @state, @zip,
      @phone, @email, @website, @type, @clergy_count, @maps_link,
      'ecdplus', datetime('now')
    )
  `).run({
    ecdplus_id: data.ecdplus_id,
    name: data.name,
    diocese: data.diocese || '',
    address: data.address || null,
    city: data.city || null,
    state: data.state || null,
    zip: data.zip || null,
    phone: data.phone || null,
    email: data.email || null,
    website: data.website || null,
    type: data.type || null,
    clergy_count: data.clergy_count ?? null,
    maps_link: data.maps_link || null,
  });

  const parishId = result.lastInsertRowid;

  // Create alias
  db.prepare(
    "INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source) VALUES (?, ?, ?, 'ecdplus')"
  ).run(parishId, data.name, normalizeChurchName(data.name));

  return 'new';
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
// fetchAllParishes -- CLI entry point (async, makes network calls)
// ---------------------------------------------------------------------------

async function fetchAllParishes() {
  const start = Date.now();
  console.log('Fetching parish list from ECDPlus...');

  const listUrl = `${BASE_URL}/search/parish.json`;
  const listResponse = await fetch(listUrl);
  if (!listResponse.ok) {
    throw new Error(`ECDPlus list request failed: ${listResponse.status} ${listResponse.statusText}`);
  }

  const listData = await listResponse.json();
  const parishes = parseParishList(listData);
  console.log(`Found ${parishes.length} parishes in bulk list.`);

  const db = getDb();
  let newCount = 0;
  let updatedCount = 0;

  let fetchedCount = 0;

  const allResults = await fetchConcurrent(parishes, CONCURRENCY, async (p, i) => {
    try {
      const detailUrl = `${BASE_URL}/parishes/${p.id}.json`;
      const detailResponse = await fetch(detailUrl);
      if (!detailResponse.ok) {
        console.warn(`  Skipping ${p.name} (${p.id}): HTTP ${detailResponse.status}`);
        await sleep(RATE_LIMIT_MS);
        fetchedCount++;
        return null;
      }

      const detailData = await detailResponse.json();
      const parsed = parseParishDetail(detailData.data || detailData);
      parsed.ecdplus_id = p.id;
      await sleep(RATE_LIMIT_MS);

      fetchedCount++;
      if (fetchedCount % LOG_INTERVAL === 0) {
        console.log(`  Progress: ${fetchedCount}/${parishes.length}`);
      }

      return { ecdplus_id: p.id, ...parsed };
    } catch (err) {
      console.warn(`  Error fetching ${p.name} (${p.id}): ${err.message}`);
      await sleep(RATE_LIMIT_MS);
      fetchedCount++;
      return null;
    }
  });

  // Write to DB
  const validResults = allResults.filter(Boolean);
  console.log(`Fetched ${validResults.length}/${parishes.length} parish details. Writing to DB...`);

  for (const parsed of validResults) {
    const result = upsertParish(db, parsed);
    if (result === 'new') newCount++;
    else updatedCount++;
  }

  const duration_ms = Date.now() - start;
  console.log(`Done: ${newCount} new, ${updatedCount} updated in ${(duration_ms / 1000).toFixed(1)}s`);

  logFetch('ecdplus', {
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
  fetchAllParishes().catch(err => {
    console.error(`ECDPlus fetch failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseParishList, parseParishDetail, upsertParish, fetchAllParishes };
