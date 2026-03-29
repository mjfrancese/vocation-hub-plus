import MAPPING from '../../../shared/diocese-to-state.json';

/**
 * Mapping of Episcopal Church diocese names to US state abbreviations.
 * Sourced from shared/diocese-to-state.json -- edit there, not here.
 */
export const DIOCESE_TO_STATE: Record<string, string> = MAPPING;

/**
 * Look up the US state abbreviation for a diocese name.
 * Falls back to empty string if the diocese is not recognized.
 */
export function getStateForDiocese(diocese: string): string {
  if (!diocese) return '';

  // Try exact match first
  const exact = DIOCESE_TO_STATE[diocese];
  if (exact) return exact;

  // Try case-insensitive match
  const lower = diocese.toLowerCase();
  for (const [key, value] of Object.entries(DIOCESE_TO_STATE)) {
    if (key.toLowerCase() === lower) return value;
  }

  // Try partial match (diocese name might have extra text)
  for (const [key, value] of Object.entries(DIOCESE_TO_STATE)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return value;
    }
  }

  return '';
}
