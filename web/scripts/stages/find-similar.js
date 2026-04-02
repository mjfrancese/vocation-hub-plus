/**
 * Enrichment Stage: Find Similar Positions
 *
 * For each position, finds up to 5 most similar other positions based on
 * congregational size (ASA), compensation, state, position type, and housing type.
 *
 * Extracted from enrich-positions-v2.js: computeSimilarPositions() (~lines 721-799).
 *
 * No DB access required -- operates on the positions array only.
 */

'use strict';

// ---------------------------------------------------------------------------
// Stage entry point
// ---------------------------------------------------------------------------

/**
 * Find similar positions stage.
 *
 * For each position that has at least one of ASA or estimated_total_comp,
 * scores all other eligible positions using:
 *   +3  ASA within ±25% of candidate's ASA
 *   +2  comp within ±20% of candidate's comp
 *   +2  same state
 *   +2  same position_type
 *   +1  same housing_type (case-insensitive)
 *
 * Only candidates with a combined score >= 3 are considered. The top 5 by
 * score are attached as position.similar_positions.
 *
 * Attaches:
 *   position.similar_positions = [
 *     { id, vh_id, name, city, state, position_type, asa, estimated_total_comp, score },
 *     ...
 *   ]
 *
 * Positions without both ASA and comp are skipped as candidates (they are
 * neither scored nor assigned similar_positions).
 *
 * @param {Array} positions - position objects (already through earlier stages)
 * @returns {Array} positions array (mutated in place)
 */
function findSimilar(positions) {
  // Build a flat array of candidate data to avoid re-extracting fields in the
  // inner loop. Only include positions that have at least one of ASA or comp.
  const posData = [];
  for (const pos of positions) {
    const id = pos.id || String(pos.vh_id);
    if (!id) continue;

    let asa = null;
    const firstParochial = pos.parochials && pos.parochials[0];
    if (firstParochial && firstParochial.years) {
      const yearKeys = Object.keys(firstParochial.years).sort();
      if (yearKeys.length > 0) {
        const latest = firstParochial.years[yearKeys[yearKeys.length - 1]];
        if (latest && latest.averageAttendance != null && latest.averageAttendance > 0) {
          asa = latest.averageAttendance;
        }
      }
    }

    const comp = pos.estimated_total_comp || null;
    const state = (pos.church_infos && pos.church_infos[0] && pos.church_infos[0].state) || pos.state || '';
    const positionType = pos.position_type || '';
    const housingType = (pos.housing_type || '').toLowerCase();
    const name = (pos.church_infos && pos.church_infos[0] && pos.church_infos[0].name) || pos.name || '';
    const city = (pos.church_infos && pos.church_infos[0] && pos.church_infos[0].city) || pos.city || '';

    if (asa == null && comp == null) continue;

    posData.push({ pos, id, vh_id: pos.vh_id, asa, comp, state, positionType, housingType, name, city });
  }

  let count = 0;
  for (let i = 0; i < posData.length; i++) {
    const a = posData[i];
    const scored = [];

    for (let j = 0; j < posData.length; j++) {
      if (i === j) continue;
      const b = posData[j];

      let score = 0;

      if (a.asa != null && b.asa != null) {
        const ratio = b.asa / a.asa;
        if (ratio >= 0.75 && ratio <= 1.25) score += 3;
      }

      if (a.comp != null && b.comp != null) {
        const ratio = b.comp / a.comp;
        if (ratio >= 0.8 && ratio <= 1.2) score += 2;
      }

      if (a.state && b.state && a.state === b.state) score += 2;
      if (a.positionType && b.positionType && a.positionType === b.positionType) score += 2;
      if (a.housingType && b.housingType && a.housingType === b.housingType) score += 1;

      if (score >= 3) {
        scored.push({
          id: b.id,
          vh_id: b.vh_id,
          name: b.name,
          city: b.city,
          state: b.state,
          position_type: b.positionType,
          asa: b.asa,
          estimated_total_comp: b.comp,
          score,
        });
      }
    }

    if (scored.length > 0) {
      scored.sort((x, y) => y.score - x.score);
      a.pos.similar_positions = scored.slice(0, 5);
      count++;
    }
  }

  console.log(`Similar positions: ${count} positions with recommendations`);
  return positions;
}

module.exports = findSimilar;
