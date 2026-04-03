/**
 * Enrichment Stage: Quality Scores
 *
 * Attaches a quality_score (0-100) and quality_components (string array)
 * to every position. Also sets position.visibility.
 *
 * Extracted from enrich-positions-v2.js:
 *   - computeQualityScores() (~lines 832-933)
 *
 * No DB required -- operates solely on position data.
 */

'use strict';

const { parseMMDDYYYY } = require('../lib/dates');

// ---------------------------------------------------------------------------
// Stage entry point
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = ['Receiving names', 'Reopened', 'Seeking interim'];
const IN_PROGRESS_STATUSES = ['Developing profile', 'Beginning search', 'Profile complete'];

/**
 * Compute quality scores for a batch of positions.
 *
 * Public positions (isPublic=true) always receive score=100 with component
 * 'Public listing (100)' and visibility='public'.
 *
 * Extended/non-public positions are scored on:
 *   - Status component: active status (25 pts), in-progress (15 pts)
 *   - Recency: receiving_names_from within 1 year (15 pts), within 3 months
 *     (+5 pts)
 *   - Name clarity: congregation identified (10 pts), position named (5 pts)
 *   - Data richness: church match (10 pts), parochial data (10 pts),
 *     position type (5 pts), state known (5 pts), exact match (5 pts),
 *     end date set (5 pts)
 *
 * Extended positions with no meaningful congregation name are capped at 45.
 * Visibility is 'extended' when score >= 50, otherwise 'extended_hidden'.
 *
 * @param {Array}   positions - position objects (mutated in place)
 * @param {boolean} isPublic  - true when scoring a public listing batch
 * @returns {Array} positions array (mutated in place)
 */
function computeQualityScores(positions, isPublic) {
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  for (const pos of positions) {
    if (isPublic) {
      pos.quality_score = 100;
      pos.quality_components = ['Public listing (100)'];
      pos.visibility = 'public';
      continue;
    }

    let score = 0;
    const components = [];
    const status = pos.vh_status || '';

    // Listing legitimacy (60 points max)
    if (ACTIVE_STATUSES.includes(status)) {
      score += 25;
      components.push('Active status (25)');
    } else if (IN_PROGRESS_STATUSES.includes(status)) {
      score += 15;
      components.push('In-progress status (15)');
    }

    const fromDate = parseMMDDYYYY(pos.receiving_names_from);
    if (fromDate && fromDate >= oneYearAgo) {
      score += 15;
      components.push('Recent date (15)');
      if (fromDate >= threeMonthsAgo) {
        score += 5;
        components.push('Very recent date (5)');
      }
    }

    const name = pos.name || '';
    if (name && !name.startsWith('Position in') && name !== 'Unknown Position') {
      score += 10;
      components.push('Congregation identified (10)');
    }

    const posName = pos.congregation || pos.position_title || '';
    if (posName && !posName.startsWith('Position in')) {
      score += 5;
      components.push('Position named (5)');
    }

    // Data richness (40 points max)
    if (pos.church_infos && pos.church_infos.length > 0) {
      score += 10;
      components.push('Church matched (10)');
    }

    if (pos.parochials && pos.parochials[0] && Object.keys(pos.parochials[0].years || {}).length > 0) {
      score += 10;
      components.push('Parochial data (10)');
    }

    if (pos.position_type) {
      score += 5;
      components.push('Position type (5)');
    }

    if (pos.state) {
      score += 5;
      components.push('State known (5)');
    }

    if (pos.match_confidence === 'exact') {
      score += 5;
      components.push('Exact match (5)');
    }

    const toDate = pos.receiving_names_to || '';
    if (toDate && toDate !== 'Open ended') {
      score += 5;
      components.push('End date set (5)');
    }

    // Entries with no congregation name should never be visible by default
    if (name.startsWith('Position in') || name === 'Unknown Position') {
      score = Math.min(score, 45);
      components.push('No congregation name (capped at 45)');
    }

    pos.quality_score = Math.min(score, 100);
    pos.quality_components = components;
    pos.visibility = score >= 50 ? 'extended' : 'extended_hidden';
  }

  const avg = positions.length > 0
    ? Math.round(positions.reduce((s, p) => s + (p.quality_score || 0), 0) / positions.length)
    : 0;
  const hidden = positions.filter(p => p.visibility === 'extended_hidden').length;
  console.log(`Quality scores: avg ${avg}, ${hidden} hidden (< 50)`);

  return positions;
}

module.exports = computeQualityScores;

// Also export internals for testing
module.exports.parseMMDDYYYY = parseMMDDYYYY;
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES;
module.exports.IN_PROGRESS_STATUSES = IN_PROGRESS_STATUSES;
