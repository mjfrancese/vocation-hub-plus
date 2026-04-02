/**
 * Position Type Normalization Map
 *
 * Maps raw VocationHub position_type strings to arrays of canonical types.
 * Shared between the enrichment pipeline (CommonJS) and the frontend (TypeScript).
 *
 * Canonical types:
 *   Rector, Vicar, Priest-in-Charge, Assistant, Associate, Curate, Senior Associate,
 *   Dean, Cathedral Staff, Canon, Missioner, Diocesan Staff, Interim, Supply,
 *   Bishop, Chaplain, Deacon, Director, Head of School, Church Planter, Youth Minister, Other
 *
 * KEEP IN SYNC with web/src/lib/position-type-helpers.ts (TypeScript frontend version)
 */

'use strict';

const POSITION_TYPE_MAP = {
  'Rector / Vicar / Priest-in-Charge': ['Rector', 'Vicar', 'Priest-in-Charge'],
  'Rector/Priest-in-Charge': ['Rector', 'Priest-in-Charge'],
  'Vicar': ['Vicar'],
  'Rector / Vicar / Priest-in-Charge (Part-time)': ['Rector', 'Vicar', 'Priest-in-Charge'],
  'Priest-in-Charge Shared Ministry': ['Priest-in-Charge'],
  'Bi-vocational Priest': ['Priest-in-Charge'],
  'Assistant/Associate/Curate': ['Assistant', 'Associate', 'Curate'],
  'Assistant / Associate / Curate (Part-time)': ['Assistant', 'Associate', 'Curate'],
  'Associate Rector / Senior Associate Rector': ['Associate', 'Senior Associate'],
  'Cathedral Dean': ['Dean'],
  'Dean': ['Dean'],
  'Cathedral Staff': ['Cathedral Staff'],
  'Interim': ['Interim'],
  'Supply': ['Supply'],
  'Bishop Diocesan': ['Bishop'],
  'Canon to the Ordinary': ['Canon'],
  'Canon for Congregational Development': ['Canon'],
  'Diocesan/Regional Staff': ['Diocesan Staff'],
  'Missioner': ['Missioner'],
  'Chaplain, School': ['Chaplain'],
  'Chaplain, Care Facility': ['Chaplain'],
  'Chaplain, Port': ['Chaplain'],
  'Chaplain, Other': ['Chaplain'],
  'Director': ['Director'],
  'Director of Development': ['Director'],
  'Director of Peace & Justice': ['Director'],
  'Christian Education Director/DRE': ['Director'],
  'Camp/Conference Center Director': ['Director'],
  'Head of School': ['Head of School'],
  'Church Planter': ['Church Planter'],
  'Youth Minister': ['Youth Minister'],
  'Deacon': ['Deacon'],
  'Academic Research': ['Other'],
};

/**
 * Map a raw VocationHub position_type string to an array of canonical types.
 *
 * @param {string} raw - the raw position_type value from VocationHub
 * @returns {string[]} array of canonical type strings
 */
function normalizePositionType(raw) {
  return POSITION_TYPE_MAP[raw] || [raw || 'Other'];
}

const CANONICAL_POSITION_TYPES = [
  'Rector', 'Vicar', 'Priest-in-Charge',
  'Assistant', 'Associate', 'Curate', 'Senior Associate',
  'Dean', 'Cathedral Staff',
  'Canon', 'Missioner', 'Diocesan Staff',
  'Interim', 'Supply',
  'Bishop',
  'Chaplain',
  'Deacon',
  'Director', 'Head of School', 'Church Planter', 'Youth Minister',
  'Other',
];

module.exports = {
  POSITION_TYPE_MAP,
  normalizePositionType,
  CANONICAL_POSITION_TYPES,
};
