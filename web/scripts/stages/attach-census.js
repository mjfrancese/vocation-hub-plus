/**
 * Enrichment Stage: Attach Census
 *
 * For each position with matched parishes (church_infos), looks up census data
 * by the first matched parish's zip code.
 *
 * Extracted from enrich-positions-v2.js.
 */

'use strict';

// ---------------------------------------------------------------------------
// Stage entry point
// ---------------------------------------------------------------------------

/**
 * Attach census data stage.
 *
 * For each position, takes the zip from church_infos[0] (first matched parish),
 * normalizes it to a 5-digit string, and looks up census_data in the DB.
 *
 * Attaches:
 *   - position.census: { median_household_income, population } if a row is found
 *   - position.census: null if no church_infos, no zip, or no matching row
 *
 * @param {Array} positions - positions already processed by match-parishes stage
 * @param {object} db - better-sqlite3 database instance
 * @returns {Array} positions with census field attached
 */
function attachCensus(positions, db) {
  const stmt = db.prepare(
    'SELECT median_income, population FROM census_data WHERE zip = ?'
  );

  for (const pos of positions) {
    const firstChurch = pos.church_infos && pos.church_infos[0];
    if (!firstChurch) {
      pos.census = null;
      continue;
    }

    const rawZip = firstChurch.zip || '';
    const zip = rawZip.replace(/[^0-9]/g, '').substring(0, 5);

    if (zip.length !== 5) {
      pos.census = null;
      continue;
    }

    const row = stmt.get(zip);
    pos.census = row
      ? { median_household_income: row.median_income, population: row.population }
      : null;
  }

  return positions;
}

module.exports = attachCensus;
