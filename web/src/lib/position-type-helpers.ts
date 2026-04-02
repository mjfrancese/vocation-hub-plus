/**
 * Position Type Normalization Helpers (TypeScript / Frontend)
 *
 * Maps raw VocationHub position_type strings to arrays of canonical types.
 * The canonical mapping mirrors web/scripts/position-type-map.js (the CommonJS
 * version used by the enrichment pipeline).
 *
 * KEEP IN SYNC with web/scripts/position-type-map.js (CommonJS pipeline version)
 */

// ---------------------------------------------------------------------------
// Raw -> canonical mapping
// ---------------------------------------------------------------------------

const POSITION_TYPE_MAP: Record<string, string[]> = {
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
 */
export function normalizePositionType(raw: string): string[] {
  return POSITION_TYPE_MAP[raw] || [raw || 'Other'];
}

// ---------------------------------------------------------------------------
// Canonical type list
// ---------------------------------------------------------------------------

export const CANONICAL_POSITION_TYPES = [
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
] as const;

// ---------------------------------------------------------------------------
// Display groups for the filter UI
// ---------------------------------------------------------------------------

/**
 * Groups canonical types into human-friendly labels for the filter dropdown.
 * Keys are the display labels; values are the canonical types in that group.
 */
export const POSITION_TYPE_DISPLAY_GROUPS: Record<string, string[]> = {
  'Rector / Vicar / PiC': ['Rector', 'Vicar', 'Priest-in-Charge'],
  'Assistant / Associate / Curate': ['Assistant', 'Associate', 'Curate', 'Senior Associate'],
  'Dean / Cathedral': ['Dean', 'Cathedral Staff'],
  'Interim / Supply': ['Interim', 'Supply'],
  'Bishop': ['Bishop'],
  'Canon / Diocesan Staff': ['Canon', 'Missioner', 'Diocesan Staff'],
  'Chaplain': ['Chaplain'],
  'Deacon': ['Deacon'],
  'Other': ['Director', 'Head of School', 'Church Planter', 'Youth Minister', 'Other'],
};

/**
 * Build a reverse map: canonical type -> display group label.
 * Useful for filtering positions by their position_types array.
 */
export function buildCanonicalToGroupMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [group, types] of Object.entries(POSITION_TYPE_DISPLAY_GROUPS)) {
    for (const t of types) {
      map[t] = group;
    }
  }
  return map;
}
