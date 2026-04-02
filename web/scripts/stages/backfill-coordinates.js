/**
 * Enrichment Stage: Backfill Coordinates
 *
 * For each position matched to one or more parishes by the match-parishes
 * stage, looks up the parish lat/lng in the DB and copies them to the
 * corresponding church_info entry when the entry is missing coordinates.
 *
 * Runs after match-parishes, which sets church_infos and _parish_ids.
 * Extracted from enrich-positions-v2.js.
 */

'use strict';

/**
 * Backfill coordinates stage.
 *
 * For each position with _parish_ids, queries each parish and copies
 * lat/lng into the matching church_info if the church_info is missing them.
 *
 * @param {Array} positions - positions enriched by match-parishes stage
 * @param {object} db - better-sqlite3 database instance
 * @returns {Array} positions with coordinates backfilled where available
 */
function backfillCoordinates(positions, db) {
  const getParish = db.prepare('SELECT lat, lng FROM parishes WHERE id = ?');

  for (const pos of positions) {
    if (!pos._parish_ids || pos._parish_ids.length === 0) continue;
    if (!pos.church_infos || pos.church_infos.length === 0) continue;

    for (let i = 0; i < pos._parish_ids.length; i++) {
      const info = pos.church_infos[i];
      if (!info) continue;

      // Skip if church_info already has coordinates
      if (info.lat && info.lng) continue;

      const parish = getParish.get(pos._parish_ids[i]);
      if (parish && parish.lat && parish.lng) {
        info.lat = parish.lat;
        info.lng = parish.lng;
      }
    }
  }

  return positions;
}

module.exports = backfillCoordinates;
