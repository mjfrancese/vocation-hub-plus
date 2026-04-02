/**
 * Pipeline Runner -- Orchestrates the enrichment pipeline.
 *
 * Loads positions from the DB (scraped_positions + scraper_meta),
 * runs each enrichment stage in order, and writes output JSON files.
 *
 * Usage:
 *   node run-enrichment.js [outputDir] [--skip stage1,stage2]
 *
 * Exports:
 *   - runPipeline({ db, skip })   -- run all stages, returns { positions }
 *   - writeOutput(positions, outputDir) -- write JSON output files
 *   - loadPositions(db)           -- read positions from DB
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getDb, closeDb } = require('./db');

// ---------------------------------------------------------------------------
// Stage registry (in execution order)
// ---------------------------------------------------------------------------

const STAGES = [
  { name: 'match-parishes',       module: './stages/match-parishes' },
  { name: 'backfill-coordinates',  module: './stages/backfill-coordinates' },
  { name: 'attach-parochial',      module: './stages/attach-parochial' },
  { name: 'attach-census',         module: './stages/attach-census' },
  { name: 'compute-compensation',  module: './stages/compute-compensation' },
  { name: 'compute-percentiles',   module: './stages/compute-percentiles' },
  { name: 'find-similar',          module: './stages/find-similar' },
  { name: 'clergy-context',        module: './stages/clergy-context' },
  { name: 'quality-scores',        module: './stages/quality-scores' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a MM/DD/YYYY date string.
 */
function parseMMDDYYYY(str) {
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
}

/**
 * Fix bogus 1900-01-01 dates. If the year part is 1900, replace it with the
 * current year (a VocationHub default-value artifact).
 */
function fixBogusYear(str) {
  if (!str) return str;
  return str.replace(/\/1900\b/, `/${new Date().getFullYear()}`);
}

/**
 * Read a JSON blob from scraper_meta by key.
 * Returns the parsed object, or null if not found.
 */
function readMeta(db, key) {
  const row = db.prepare('SELECT value FROM scraper_meta WHERE key = ?').get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// loadPositions -- read public positions from scraped_positions
// ---------------------------------------------------------------------------

/**
 * Load public positions from the scraped_positions table.
 * Also merges in profile_fields and all_profiles data from scraper_meta.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ positions: Array, allProfiles: Array, profileFields: object }}
 */
function loadPositions(db) {
  const rows = db.prepare('SELECT * FROM scraped_positions').all();
  const allProfiles = readMeta(db, 'all_profiles') || [];
  const profileFields = readMeta(db, 'profile_fields') || {};

  // Map DB columns to the position shape expected by stages
  const positions = rows.map(r => ({
    vh_id: r.vh_id ? parseInt(r.vh_id, 10) || r.vh_id : undefined,
    name: r.name || '',
    diocese: r.diocese || '',
    state: r.state || '',
    organization: r.organization || '',
    position_type: r.position_type || '',
    receiving_names_from: r.receiving_from || '',
    receiving_names_to: r.receiving_to || '',
    updated_on_hub: r.updated_on_hub || '',
    status: r.status || '',
  }));

  return { positions, allProfiles, profileFields };
}

// ---------------------------------------------------------------------------
// buildExtendedPositions -- profiles not in search results
// ---------------------------------------------------------------------------

/**
 * Build the extended positions list from all_profiles that are not in the
 * public search results. Mirrors the logic in enrich-positions-v2.js.
 *
 * @param {Array} publicPositions - already-enriched public positions
 * @param {Array} allProfiles     - full profile list from scraper_meta
 * @returns {Array} extended position objects
 */
function buildExtendedPositions(publicPositions, allProfiles) {
  if (!allProfiles || allProfiles.length === 0) return [];

  const publicVhIds = new Set(
    publicPositions.map(p => p.vh_id).filter(Boolean)
  );

  const extended = [];
  for (const profile of allProfiles) {
    if (publicVhIds.has(profile.vh_id)) continue;

    const vhId = profile.vh_id;

    // Clean diocese (sometimes contains a URL instead of a name)
    let diocese = profile.diocese || '';
    if (/^https?:\/\/|\.org|\.com|\.net|\.edu/i.test(diocese)) diocese = '';

    // Track bogus dates
    const hadBogusDate = /^01\/01\/1900/.test(profile.receiving_names_from || '');

    // Fix bogus 1900 year
    const receivingFrom = fixBogusYear(profile.receiving_names_from || '');
    const receivingTo = fixBogusYear(profile.receiving_names_to || '');

    // Infer status
    let inferredStatus = profile.status || '';
    const fromDate = parseMMDDYYYY(receivingFrom);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    if (!inferredStatus) {
      if (fromDate) {
        inferredStatus = fromDate >= oneYearAgo ? 'Receiving names' : 'Search complete';
      } else {
        inferredStatus = 'Developing profile';
      }
    }

    if (fromDate && fromDate < oneYearAgo
        && inferredStatus !== 'Search complete'
        && inferredStatus !== 'No longer receiving names') {
      inferredStatus = 'Search complete';
    }

    if (hadBogusDate
        && inferredStatus !== 'Search complete'
        && inferredStatus !== 'No longer receiving names') {
      inferredStatus = 'Search complete';
    }

    // Fallback position_type from order_of_ministry
    let positionType = profile.position_type || '';
    if (!positionType && profile.order_of_ministry) {
      const order = profile.order_of_ministry.toLowerCase();
      if (order.includes('priest')) positionType = 'Rector / Vicar / Priest-in-Charge';
      else if (order.includes('deacon')) positionType = 'Deacon';
      else if (order.includes('bishop')) positionType = 'Bishop';
      else positionType = profile.order_of_ministry;
    }
    if (!positionType && profile.congregation && profile.congregation.includes('\n')) {
      positionType = 'Priest-in-Charge Shared Ministry';
    }

    // Build display name (parish matching will refine later)
    let displayName = profile.congregation || '';
    if (!displayName) {
      displayName = diocese ? `Position in ${diocese}` : 'Unknown Position';
    }

    extended.push({
      vh_id: vhId,
      name: displayName,
      diocese,
      state: '',
      vh_status: inferredStatus,
      profile_url: `https://vocationhub.episcopalchurch.org/PositionView/${vhId}`,
      position_type: positionType,
      congregation: profile.congregation || '',
      receiving_names_from: receivingFrom,
      receiving_names_to: receivingTo,
      open_ended: profile.open_ended || false,
      // Carry through fields needed for comp estimation
      salary_range: profile.salary_range || undefined,
      housing_type: profile.housing_type || undefined,
      all_fields: profile.all_fields || undefined,
      // Marker for website matching
      website_url: profile.website || '',
      contact_email: '',
      contact_phone: '',
    });
  }

  return extended;
}

// ---------------------------------------------------------------------------
// runPipeline
// ---------------------------------------------------------------------------

/**
 * Run the full enrichment pipeline.
 *
 * @param {object}   opts
 * @param {import('better-sqlite3').Database} opts.db - DB handle
 * @param {string[]} [opts.skip=[]] - stage names to skip
 * @returns {{ positions: Array, extended: Array, profileFields: object }}
 */
function runPipeline({ db, skip = [] } = {}) {
  if (!db) {
    db = getDb();
  }

  const skipSet = new Set(skip.map(s => s.trim()));

  // 1. Load positions from DB
  const { positions, allProfiles, profileFields } = loadPositions(db);
  console.log(`Loaded ${positions.length} public positions from DB`);

  // 2. Run each stage on public positions
  for (const stage of STAGES) {
    if (skipSet.has(stage.name)) {
      console.log(`  [skip] ${stage.name}`);
      continue;
    }
    console.log(`  [run]  ${stage.name}`);
    const fn = require(stage.module);
    runStage(fn, stage.name, positions, db, profileFields, true);
  }

  // 3. Build extended positions and run stages on them
  const extended = buildExtendedPositions(positions, allProfiles);
  console.log(`Built ${extended.length} extended positions from profiles`);

  if (extended.length > 0) {
    for (const stage of STAGES) {
      if (skipSet.has(stage.name)) {
        console.log(`  [skip] ${stage.name} (extended)`);
        continue;
      }
      console.log(`  [run]  ${stage.name} (extended)`);
      const fn = require(stage.module);
      runStage(fn, stage.name, extended, db, profileFields, false);
    }

    // Strip temporary fields not needed by the frontend
    for (const pos of extended) {
      delete pos.salary_range;
      delete pos.all_fields;
    }
  }

  return { positions, extended, profileFields };
}

/**
 * Run a single stage function with the correct arguments.
 *
 * Most stages take (positions, db). Special cases:
 *   - compute-compensation: (positions, db, profileFields)
 *   - quality-scores: (positions, isPublic)
 *   - find-similar: (positions) -- no db
 */
function runStage(fn, name, positions, db, profileFields, isPublic) {
  switch (name) {
    case 'compute-compensation':
      fn(positions, db, profileFields);
      break;
    case 'quality-scores':
      fn(positions, isPublic);
      break;
    case 'find-similar':
      fn(positions);
      break;
    default:
      fn(positions, db);
      break;
  }
}

// ---------------------------------------------------------------------------
// writeOutput
// ---------------------------------------------------------------------------

/**
 * Write enriched output files to the given directory.
 *
 * Output files:
 *   - enriched-positions.json   (public, visibility='public')
 *   - enriched-extended.json    (extended, visibility!='public')
 *   - position-church-map.json  (vh_id -> parish mapping with confidence)
 *   - changes.json              (from scraper_meta)
 *   - meta.json                 (from scraper_meta)
 *   - all-profiles.json         (from scraper_meta)
 *   - profile-fields.json       (from scraper_meta)
 *
 * @param {{ positions: Array, extended: Array }} data
 * @param {string} outputDir - directory path to write files into
 * @param {import('better-sqlite3').Database} [db] - DB for scraper_meta reads
 */
function writeOutput(data, outputDir, db) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const { positions, extended } = data;

  // Strip internal _parish_ids from output
  const cleanPositions = positions.map(p => {
    const copy = { ...p };
    delete copy._parish_ids;
    return copy;
  });

  const cleanExtended = (extended || []).map(p => {
    const copy = { ...p };
    delete copy._parish_ids;
    return copy;
  });

  // enriched-positions.json -- public positions only
  fs.writeFileSync(
    path.join(outputDir, 'enriched-positions.json'),
    JSON.stringify(cleanPositions, null, 2)
  );

  // enriched-extended.json -- extended positions
  fs.writeFileSync(
    path.join(outputDir, 'enriched-extended.json'),
    JSON.stringify(cleanExtended, null, 2)
  );

  // position-church-map.json -- position-to-parish mapping
  const churchMap = {};
  for (const pos of [...cleanPositions, ...cleanExtended]) {
    if (!pos.vh_id) continue;
    const key = String(pos.vh_id);
    churchMap[key] = {
      confidence: pos.match_confidence || null,
      church_infos: pos.church_infos || [],
    };
  }
  fs.writeFileSync(
    path.join(outputDir, 'position-church-map.json'),
    JSON.stringify(churchMap, null, 2)
  );

  // Copy scraper_meta blobs to output
  if (db) {
    const metaKeys = ['changes', 'meta', 'all_profiles', 'profile_fields'];
    const fileNames = {
      changes: 'changes.json',
      meta: 'meta.json',
      all_profiles: 'all-profiles.json',
      profile_fields: 'profile-fields.json',
    };

    for (const key of metaKeys) {
      const value = readMeta(db, key);
      if (value !== null) {
        fs.writeFileSync(
          path.join(outputDir, fileNames[key]),
          JSON.stringify(value, null, 2)
        );
      }
    }
  }

  console.log(`Output written to ${outputDir}`);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  let outputDir = path.resolve(__dirname, '../public/data');
  let skip = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip' && args[i + 1]) {
      skip = args[i + 1].split(',');
      i++; // consume next arg
    } else if (!args[i].startsWith('--')) {
      outputDir = path.resolve(args[i]);
    }
  }

  const db = getDb();
  try {
    const result = runPipeline({ db, skip });
    writeOutput(result, outputDir, db);
  } finally {
    closeDb();
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  runPipeline,
  writeOutput,
  loadPositions,
  // Internals for testing
  buildExtendedPositions,
  readMeta,
  STAGES,
};
