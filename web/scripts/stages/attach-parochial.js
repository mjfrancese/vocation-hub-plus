/**
 * Enrichment Stage: Attach Parochial
 *
 * For each position with matched parishes (church_infos), looks up parochial
 * report data (attendance, giving, membership, operating revenue) from the DB.
 *
 * Extracted from enrich-positions-v2.js.
 */

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Query parochial_data rows for a given key (either a NID or a name string).
 * Returns { years: { '<year>': { ... } } } or null if no rows found.
 */
function lookupParochial(db, key) {
  if (!key) return null;
  const rows = db.prepare(
    'SELECT * FROM parochial_data WHERE parish_nid = ? ORDER BY year'
  ).all(String(key));

  if (rows.length === 0) return null;

  const years = {};
  for (const r of rows) {
    years[String(r.year)] = {
      averageAttendance: r.average_attendance,
      plateAndPledge: r.plate_and_pledge,
      membership: r.membership,
      operatingRevenue: r.operating_revenue,
    };
  }
  return { years };
}

// ---------------------------------------------------------------------------
// Stage entry point
// ---------------------------------------------------------------------------

/**
 * Attach parochial data stage.
 *
 * For each position with matched parishes, looks up parochial data by:
 *   1. Parish name + city key (e.g. "St. Paul's (Alexandria)")
 *   2. Parish name alone
 *   3. Parish NID
 *
 * Attaches:
 *   - position.parochials: array of { years: { '<year>': { averageAttendance,
 *       plateAndPledge, membership, operatingRevenue } } }, one entry per
 *       church_info with data found.
 *
 * Positions with no matched parishes receive an empty parochials array.
 *
 * @param {Array} positions - positions already processed by match-parishes stage
 * @param {object} db - better-sqlite3 database instance
 * @returns {Array} positions with parochials field attached
 */
function attachParochial(positions, db) {
  for (const pos of positions) {
    const churchInfos = pos.church_infos || [];

    if (churchInfos.length === 0) {
      pos.parochials = [];
      continue;
    }

    const parochials = [];
    for (const info of churchInfos) {
      const nameWithCity = info.city
        ? `${info.name} (${info.city})`
        : info.name;

      const parochial =
        lookupParochial(db, nameWithCity) ||
        lookupParochial(db, info.name) ||
        lookupParochial(db, info.nid);

      if (parochial) {
        parochials.push(parochial);
      }
    }

    pos.parochials = parochials;
  }

  return positions;
}

module.exports = attachParochial;

// Also export internals for testing
module.exports.lookupParochial = lookupParochial;
