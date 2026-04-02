/**
 * Enrichment Stage: Compute Compensation
 *
 * Attaches diocesan compensation benchmarks and estimates total compensation
 * (stipend + housing) for each position.
 *
 * Extracted from enrich-positions-v2.js:
 *   - attachCompensation()  (~lines 411-431)
 *   - computeEstimatedTotalComp() (~lines 600-715)
 *   - parseStipend() (~lines 107-116)
 */

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a numeric dollar value from a free-form salary/stipend string.
 * Returns null for non-numeric sentinels (DOE, TBD, etc.) and for zero/
 * negative values.
 *
 * @param {string|*} str
 * @returns {number|null}
 */
function parseStipend(str) {
  if (!str || typeof str !== 'string') return null;
  const upper = str.trim().toUpperCase();
  if (/^(DOE|TBD|NEGOTIABLE|N\/A|SEE|CONTACT|VARIES)/.test(upper)) return null;
  const cleaned = str.replace(/[$,\s]/g, '');
  const m = cleaned.match(/^(\d+\.?\d*)/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  return val > 0 ? val : null;
}

/**
 * Look up the most recent diocesan compensation benchmark row for a diocese.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} diocese
 * @returns {object|null} compensation_diocesan row or null
 */
function lookupDioceseComp(db, diocese) {
  if (!diocese) return null;
  return db.prepare(`
    SELECT * FROM compensation_diocesan
    WHERE LOWER(diocese) = LOWER(?)
    ORDER BY year DESC LIMIT 1
  `).get(diocese) ?? null;
}

// ---------------------------------------------------------------------------
// Stage entry point
// ---------------------------------------------------------------------------

/**
 * Compute compensation stage.
 *
 * For each position:
 *   1. Looks up diocesan compensation benchmarks (most recent year) and
 *      attaches them as position.compensation.
 *   2. Estimates total compensation by parsing stipend from salary fields
 *      (minimum_stipend, maximum_stipend, salary_range, all_fields Range
 *      entries, and profileFields fallback) and adding a housing value
 *      ($20,000) when a rectory or housing allowance is provided.
 *      Attaches position.estimated_total_comp and position.comp_breakdown.
 *
 * @param {Array} positions   - position objects (already through earlier stages)
 * @param {import('better-sqlite3').Database} db - better-sqlite3 instance
 * @param {object} [profileFields] - map of vh_id -> array of {label, value}
 *   extra profile fields (optional; used as a fallback for stipend/housing data)
 * @returns {Array} positions array (mutated in place)
 */
function computeCompensation(positions, db, profileFields) {
  // ------------------------------------------------------------------
  // Pass 1: diocese benchmark lookup
  // ------------------------------------------------------------------
  for (const pos of positions) {
    const comp = lookupDioceseComp(db, pos.diocese || '');
    if (!comp) continue;

    pos.compensation = {
      diocese_median: comp.all_median,
      diocese_female_median: comp.female_median,
      diocese_male_median: comp.male_median,
      diocese_clergy_count: comp.all_count,
      year: comp.year,
    };
  }

  // ------------------------------------------------------------------
  // Pass 2: estimated total compensation
  // ------------------------------------------------------------------
  for (const pos of positions) {
    let minStipend = parseStipend(pos.minimum_stipend);
    let maxStipend = parseStipend(pos.maximum_stipend);

    // Fallback: check profileFields for stipend data
    if (minStipend == null && maxStipend == null && profileFields && pos.vh_id) {
      const fields = profileFields[String(pos.vh_id)];
      if (Array.isArray(fields)) {
        for (const f of fields) {
          const label = (f.label || '').toLowerCase();
          if (label.includes('minimum') && label.includes('stipend') && minStipend == null) {
            minStipend = parseStipend(f.value);
          }
          if (label.includes('maximum') && label.includes('stipend') && maxStipend == null) {
            maxStipend = parseStipend(f.value);
          }
        }

        // Fallback: parse "Range" fields from profileFields
        if (minStipend == null && maxStipend == null) {
          const rangeFields = fields.filter(f => (f.label || '').toLowerCase() === 'range');
          for (const rf of rangeFields) {
            const val = (rf.value || '').trim();
            const rangeMatch = val.match(/\$?([\d,]+)\s*[-\u2013]\s*\$?([\d,]+)/);
            if (rangeMatch && minStipend == null) {
              const lo = parseStipend(rangeMatch[1]);
              const hi = parseStipend(rangeMatch[2]);
              if (lo != null) minStipend = lo;
              if (hi != null) maxStipend = hi;
              continue;
            }
            const singleMatch = val.match(/\$\s*([\d,]+)/);
            if (singleMatch && minStipend == null && maxStipend == null) {
              const parsed = parseStipend(singleMatch[1]);
              if (parsed != null) minStipend = parsed;
            }
          }
        }
      }
    }

    // Fallback: parse salary_range field
    if (minStipend == null && maxStipend == null && pos.salary_range) {
      const rangeMatch = pos.salary_range.match(/\$?([\d,]+)\s*[-\u2013]\s*\$?([\d,]+)/);
      if (rangeMatch) {
        minStipend = parseStipend(rangeMatch[1]);
        maxStipend = parseStipend(rangeMatch[2]);
      }
    }

    // Fallback: parse all_fields Range entries
    if (minStipend == null && maxStipend == null && Array.isArray(pos.all_fields)) {
      const rangeFields = pos.all_fields.filter(f => (f.label || '').toLowerCase() === 'range');
      for (const rf of rangeFields) {
        const val = (rf.value || '').trim();
        const rangeMatch = val.match(/\$?([\d,]+)\s*[-\u2013]\s*\$?([\d,]+)/);
        if (rangeMatch && minStipend == null) {
          const lo = parseStipend(rangeMatch[1]);
          const hi = parseStipend(rangeMatch[2]);
          if (lo != null) minStipend = lo;
          if (hi != null) maxStipend = hi;
          continue;
        }
        const singleMatch = val.match(/\$\s*([\d,]+)/);
        if (singleMatch && minStipend == null && maxStipend == null) {
          const parsed = parseStipend(singleMatch[1]);
          if (parsed != null) minStipend = parsed;
        }
      }
    }

    if (minStipend == null && maxStipend == null) continue;

    let basePay;
    if (minStipend != null && maxStipend != null) {
      basePay = (minStipend + maxStipend) / 2;
    } else {
      basePay = minStipend != null ? minStipend : maxStipend;
    }

    let totalComp = basePay;
    let housingValue = 0;

    let housingType = (pos.housing_type || '').toLowerCase();
    // Fallback: check profileFields for housing type
    if (!housingType && profileFields && pos.vh_id) {
      const fields = profileFields[String(pos.vh_id)];
      if (Array.isArray(fields)) {
        for (const f of fields) {
          if ((f.label || '').toLowerCase().includes('housing')) {
            housingType = (f.value || '').toLowerCase();
            break;
          }
        }
      }
    }

    const housingProvided = housingType &&
      !housingType.includes('no housing') &&
      (/rectory|housing provided|bed|bath|required/.test(housingType));

    if (housingProvided) {
      housingValue = 20000;
      totalComp += housingValue;
    }

    pos.estimated_total_comp = Math.round(totalComp);
    pos.comp_breakdown = { stipend: Math.round(basePay) };
    if (housingValue > 0) {
      pos.comp_breakdown.housing = housingValue;
    }
  }

  return positions;
}

module.exports = computeCompensation;

// Also export internals for testing
module.exports.parseStipend = parseStipend;
module.exports.lookupDioceseComp = lookupDioceseComp;
