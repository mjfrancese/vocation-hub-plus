/**
 * CPG (Church Pension Group) position-type mapping for frontend display.
 *
 * Maps canonical position types to CPG compensation categories.
 * Mirrors the pipeline logic in web/scripts/stages/compute-compensation.js.
 */

const CPG_TYPE_MAP: Record<string, (asa: number | null) => string> = {
  'Rector': (asa) => (asa != null && asa >= 400) ? 'Senior Rector' : 'Solo Rector',
  'Vicar': () => 'Solo Rector',
  'Priest-in-Charge': () => 'Solo Rector',
  'Assistant': () => 'Assistant',
  'Associate': () => 'Assistant',
  'Curate': () => 'Assistant',
  'Senior Associate': () => 'Assistant',
  'Deacon': () => 'Parish Deacon',
};

/**
 * Get the CPG position type for display purposes.
 * Returns null if no mapping exists (position falls back to diocese-wide median).
 */
export function getCpgDisplayType(positionTypes: string[], asa: number | null): string | null {
  for (const pt of positionTypes) {
    const mapper = CPG_TYPE_MAP[pt];
    if (mapper) return mapper(asa);
  }
  return null;
}
