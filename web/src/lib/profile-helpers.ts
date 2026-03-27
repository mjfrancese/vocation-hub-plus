import { Position } from './types';

interface ProfileField {
  label: string;
  value: string;
}

/**
 * Extract city from a position name.
 * Most names follow the pattern "Church Name (City)".
 */
export function extractCity(name: string): string {
  const match = name.match(/\(([^)]+)\)$/);
  return match ? match[1].trim() : '';
}

/**
 * Extract a field value from a position's deep_scrape_fields by label.
 */
export function getProfileField(pos: Position, ...labels: string[]): string {
  const fields = pos.deep_scrape_fields || [];
  for (const label of labels) {
    const match = fields.find(f => f.label.toLowerCase() === label.toLowerCase());
    if (match?.value) return match.value;
  }
  return '';
}

/**
 * Categorize housing type into a clean bucket.
 */
export function categorizeHousing(raw: string): string {
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower.includes('rectory') && (lower.includes('optional') || lower.includes('negotiable'))) return 'Rectory (optional)';
  if (lower.includes('rectory') || lower.includes('bed') || lower.includes('bath') || lower.includes('required')) return 'Rectory';
  if (lower === 'cash stipend') return 'Cash Stipend';
  if (lower.includes('housing allowance') || lower.includes('portion of') || lower.includes('allotted') || lower.includes('cash compensation')) return 'Housing Allowance';
  if (lower === 'no housing or stipend provided' || lower === 'n/a') return 'No Housing Provided';
  if (lower.includes('negotiable')) return 'Negotiable';
  if (raw.length > 50) return 'Other (see details)';
  return raw;
}

// Vocation Hub's predefined compensation ranges
export const COMPENSATION_RANGES = [
  '$0 - $25,000',
  '$25,001 - $50,000',
  '$50,001 - $75,000',
  '$75,001 - $100,000',
  '$100,001 - $125,000',
  '$125,001 - $150,000',
  '$150,001 - $175,000',
  '$175,001 - $200,000',
  '$200,001 and above',
];

/**
 * Extract the compensation range for a position.
 */
export function getCompensationRange(pos: Position): string {
  const fields = pos.deep_scrape_fields || [];
  for (const f of fields) {
    const label = f.label.toLowerCase();
    if (label === 'range' || label.includes('compensation') || label.includes('stipend')) {
      for (const range of COMPENSATION_RANGES) {
        if (f.value.includes(range) || f.value.startsWith(range.split(' ')[0])) {
          return range;
        }
      }
      return f.value;
    }
  }
  return '';
}

/**
 * Get all unique values for a profile field across positions.
 */
export function getUniqueProfileValues(
  positions: Position[],
  ...labels: string[]
): string[] {
  const values = new Set<string>();
  for (const pos of positions) {
    const val = getProfileField(pos, ...labels);
    if (val) values.add(val);
  }
  return Array.from(values).sort();
}

/**
 * Get unique categorized housing values.
 */
export function getUniqueHousingValues(positions: Position[]): string[] {
  const values = new Set<string>();
  for (const pos of positions) {
    const raw = getProfileField(pos, 'Type of Housing Provided');
    const cat = categorizeHousing(raw);
    if (cat) values.add(cat);
  }
  return Array.from(values).sort();
}
