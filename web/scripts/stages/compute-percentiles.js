/**
 * Enrichment Stage: Compute Diocese Percentiles
 *
 * For each position with parochial data, computes where its parish ranks
 * within its diocese on three metrics: ASA (average Sunday attendance),
 * plate-and-pledge, and membership.
 *
 * Extracted from enrich-positions-v2.js:
 *   - computeDiocesePercentiles() (~lines 516-594)
 */

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the percentile rank of `value` within `sortedArr` (ascending).
 * Returns the percentage of values in the array that are strictly less than
 * `value`, rounded to the nearest integer (0-100).
 *
 * @param {number[]} sortedArr - array sorted ascending
 * @param {number} value
 * @returns {number}
 */
function percentile(sortedArr, value) {
  let below = 0;
  for (let i = 0; i < sortedArr.length; i++) {
    if (sortedArr[i] < value) below++;
    else break;
  }
  return Math.round((below / sortedArr.length) * 100);
}

/**
 * Build a diocese-keyed metrics cache from parochial data rows.
 *
 * Each entry holds sorted ascending arrays for asa, platePledge, and
 * membership, using only the most recent year of data per congregation and
 * only positive (> 0) values.
 *
 * parochial_data.parish_nid may be either a numeric NID string (matched
 * against parishes.nid) or a "Name (City)" composite string (matched
 * against parishes by name+city). Both forms are resolved to find the
 * owning parish's diocese.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Object.<string, {asa: number[], platePledge: number[], membership: number[]}>}
 */
function buildDioceseMetrics(db) {
  // Pull all parochial_data rows. We resolve diocese via two strategies:
  //   1. NID match: parishes.nid = pd.parish_nid
  //   2. Name+city composite: parishes where name || ' (' || city || ')' = pd.parish_nid
  const rows = db.prepare(`
    SELECT
      pd.parish_nid,
      pd.year,
      pd.average_attendance,
      pd.plate_and_pledge,
      pd.membership,
      COALESCE(p_nid.diocese, p_name.diocese) AS diocese
    FROM parochial_data pd
    LEFT JOIN parishes p_nid
      ON p_nid.nid = pd.parish_nid
    LEFT JOIN parishes p_name
      ON p_name.name || ' (' || p_name.city || ')' = pd.parish_nid
    WHERE COALESCE(p_nid.diocese, p_name.diocese) IS NOT NULL
    ORDER BY pd.parish_nid, pd.year
  `).all();

  // For each parish_nid, keep only the latest year row.
  const latestByNid = new Map();
  for (const row of rows) {
    // Rows are ordered by year ASC, so later rows overwrite earlier ones.
    latestByNid.set(row.parish_nid, row);
  }

  const dioceseMetrics = {};
  for (const row of latestByNid.values()) {
    const diocese = row.diocese;
    if (!dioceseMetrics[diocese]) {
      dioceseMetrics[diocese] = { asa: [], platePledge: [], membership: [] };
    }
    const dm = dioceseMetrics[diocese];
    if (row.average_attendance != null && row.average_attendance > 0) {
      dm.asa.push(row.average_attendance);
    }
    if (row.plate_and_pledge != null && row.plate_and_pledge > 0) {
      dm.platePledge.push(row.plate_and_pledge);
    }
    if (row.membership != null && row.membership > 0) {
      dm.membership.push(row.membership);
    }
  }

  // Sort each array ascending for percentile computation.
  for (const dm of Object.values(dioceseMetrics)) {
    dm.asa.sort((a, b) => a - b);
    dm.platePledge.sort((a, b) => a - b);
    dm.membership.sort((a, b) => a - b);
  }

  return dioceseMetrics;
}

// ---------------------------------------------------------------------------
// Stage entry point
// ---------------------------------------------------------------------------

/**
 * Compute diocese percentiles stage.
 *
 * For each position that has parochial data (position.parochials[0]) and a
 * diocese, computes percentile ranks relative to all parishes in the same
 * diocese. Attaches position.diocese_percentiles with up to six fields:
 *
 *   { asa, asa_value, plate_pledge, plate_pledge_value, membership, membership_value }
 *
 * Each percentile is an integer 0-100 representing the share of diocese
 * parishes with a lower value. The corresponding _value field holds the raw
 * metric for that position's parish.
 *
 * Positions with no parochial data, no diocese, or no matching diocese
 * metrics are left unchanged (no diocese_percentiles property).
 *
 * @param {Array} positions - position objects (already through attach-parochial)
 * @param {import('better-sqlite3').Database} db - better-sqlite3 instance
 * @returns {Array} positions array (mutated in place)
 */
function computePercentiles(positions, db) {
  const dioceseMetrics = buildDioceseMetrics(db);

  let count = 0;
  for (const pos of positions) {
    const posParochial = pos.parochials && pos.parochials[0];
    if (!posParochial || !pos.diocese) continue;
    const dm = dioceseMetrics[pos.diocese];
    if (!dm) continue;

    const yearKeys = Object.keys(posParochial.years || {}).sort();
    if (yearKeys.length === 0) continue;
    const latest = posParochial.years[yearKeys[yearKeys.length - 1]];
    if (!latest) continue;

    const pctile = {};
    if (latest.averageAttendance != null && latest.averageAttendance > 0 && dm.asa.length > 0) {
      pctile.asa = percentile(dm.asa, latest.averageAttendance);
      pctile.asa_value = latest.averageAttendance;
    }
    if (latest.plateAndPledge != null && latest.plateAndPledge > 0 && dm.platePledge.length > 0) {
      pctile.plate_pledge = percentile(dm.platePledge, latest.plateAndPledge);
      pctile.plate_pledge_value = latest.plateAndPledge;
    }
    if (latest.membership != null && latest.membership > 0 && dm.membership.length > 0) {
      pctile.membership = percentile(dm.membership, latest.membership);
      pctile.membership_value = latest.membership;
    }

    if (Object.keys(pctile).length > 0) {
      pos.diocese_percentiles = pctile;
      count++;
    }
  }

  console.log(`Diocese percentiles: ${count} positions`);
  return positions;
}

module.exports = computePercentiles;

// Also export internals for testing.
module.exports.percentile = percentile;
module.exports.buildDioceseMetrics = buildDioceseMetrics;
