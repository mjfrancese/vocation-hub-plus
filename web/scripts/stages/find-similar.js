/**
 * Enrichment Stage: Find Similar Positions
 *
 * For each position, finds up to 15 most similar other positions based on
 * congregational size (ASA), compensation, state, position type, and housing type.
 *
 * Extracted from enrich-positions-v2.js: computeSimilarPositions() (~lines 721-799).
 *
 * No DB access required -- operates on the positions array only.
 */

'use strict';

const {
  SIMILAR_ASA_TOLERANCE,
  SIMILAR_COMP_TOLERANCE,
  SIMILAR_MIN_SCORE,
  SIMILAR_MAX_RESULTS,
} = require('../lib/constants');

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
 * Only candidates with a combined score >= 3 are considered. The top 15 by
 * score are attached as position.similar_positions.
 *
 * Attaches:
 *   position.similar_positions = [
 *     { id, vh_id, name, city, state, position_type, asa, estimated_total_comp, score,
 *       match_reasons: { asa, comp, state, type, housing } },
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

    const positionTypes = pos.position_types || [];
    posData.push({ pos, id, vh_id: pos.vh_id, asa, comp, state, positionType, positionTypes, housingType, name, city });
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
        if (ratio >= (1 - SIMILAR_ASA_TOLERANCE) && ratio <= (1 + SIMILAR_ASA_TOLERANCE)) score += 3;
      }

      if (a.comp != null && b.comp != null) {
        const ratio = b.comp / a.comp;
        if (ratio >= (1 - SIMILAR_COMP_TOLERANCE) && ratio <= (1 + SIMILAR_COMP_TOLERANCE)) score += 2;
      }

      if (a.state && b.state && a.state === b.state) score += 2;
      if ((a.positionTypes.length > 0 && b.positionTypes.length > 0 && a.positionTypes.some(t => b.positionTypes.includes(t)))
          || (a.positionType && b.positionType && a.positionType === b.positionType)) score += 2;
      if (a.housingType && b.housingType && a.housingType === b.housingType) score += 1;

      if (score >= SIMILAR_MIN_SCORE) {
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
          match_reasons: {
            asa: a.asa != null && b.asa != null && (b.asa / a.asa) >= (1 - SIMILAR_ASA_TOLERANCE) && (b.asa / a.asa) <= (1 + SIMILAR_ASA_TOLERANCE),
            comp: a.comp != null && b.comp != null && (b.comp / a.comp) >= (1 - SIMILAR_COMP_TOLERANCE) && (b.comp / a.comp) <= (1 + SIMILAR_COMP_TOLERANCE),
            state: !!(a.state && b.state && a.state === b.state),
            type: (a.positionTypes != null && a.positionTypes.length > 0 && b.positionTypes != null && b.positionTypes.length > 0 && a.positionTypes.some(t => b.positionTypes.includes(t)))
                  || !!(a.positionType && b.positionType && a.positionType === b.positionType),
            housing: !!(a.housingType && b.housingType && a.housingType === b.housingType),
          },
        });
      }
    }

    if (scored.length > 0) {
      scored.sort((x, y) => y.score - x.score);
      a.pos.similar_positions = scored.slice(0, SIMILAR_MAX_RESULTS);
      count++;
    }
  }

  console.log(`Similar positions: ${count} positions with recommendations`);
  return positions;
}

module.exports = findSimilar;
