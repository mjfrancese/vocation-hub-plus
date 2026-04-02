import { Position } from './types';

/**
 * Compute median of a numeric array. Returns null if empty.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute percentile value from sorted array.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/**
 * Compute 25th percentile, median, and 75th percentile.
 */
export function quartiles(values: number[]): { p25: number; median: number; p75: number } | null {
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p25: percentile(sorted, 25),
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
  };
}

/**
 * Extract the latest ASA value from a position's parochial data.
 */
export function getLatestASA(pos: Position): number | null {
  const parochial = pos.parochials?.[0];
  if (!parochial?.years) return null;
  const years = Object.keys(parochial.years).sort();
  for (let i = years.length - 1; i >= 0; i--) {
    const asa = parochial.years[years[i]]?.averageAttendance;
    if (asa != null && asa > 0) return asa;
  }
  return null;
}

/**
 * Bucket ASA values into display ranges.
 */
export function getASABucket(asa: number): string {
  if (asa <= 50) return '0-50';
  if (asa <= 100) return '51-100';
  if (asa <= 200) return '101-200';
  if (asa <= 500) return '201-500';
  return '500+';
}

const ASA_BUCKET_ORDER = ['0-50', '51-100', '101-200', '201-500', '500+'];

/**
 * Sort ASA buckets in logical order.
 */
export function sortASABuckets<T extends { bucket: string }>(data: T[]): T[] {
  return [...data].sort((a, b) => ASA_BUCKET_ORDER.indexOf(a.bucket) - ASA_BUCKET_ORDER.indexOf(b.bucket));
}

/**
 * Bucket compensation values into display ranges.
 */
export function getCompBucket(comp: number): string {
  if (comp < 50000) return '$0-50k';
  if (comp < 75000) return '$50-75k';
  if (comp < 100000) return '$75-100k';
  if (comp < 125000) return '$100-125k';
  return '$125k+';
}

const COMP_BUCKET_ORDER = ['$0-50k', '$50-75k', '$75-100k', '$100-125k', '$125k+'];

/**
 * Sort compensation buckets in logical order.
 */
export function sortCompBuckets<T extends { bucket: string }>(data: T[]): T[] {
  return [...data].sort((a, b) => COMP_BUCKET_ORDER.indexOf(a.bucket) - COMP_BUCKET_ORDER.indexOf(b.bucket));
}

/**
 * Map US state abbreviations to regions.
 */
const STATE_TO_REGION: Record<string, string> = {
  CT: 'Northeast', ME: 'Northeast', MA: 'Northeast', NH: 'Northeast', RI: 'Northeast', VT: 'Northeast',
  NJ: 'Northeast', NY: 'Northeast', PA: 'Northeast',
  DE: 'Southeast', FL: 'Southeast', GA: 'Southeast', MD: 'Southeast', NC: 'Southeast', SC: 'Southeast',
  VA: 'Southeast', DC: 'Southeast', WV: 'Southeast', AL: 'Southeast', KY: 'Southeast', MS: 'Southeast',
  TN: 'Southeast', AR: 'Southeast', LA: 'Southeast',
  IL: 'Midwest', IN: 'Midwest', MI: 'Midwest', OH: 'Midwest', WI: 'Midwest',
  IA: 'Midwest', KS: 'Midwest', MN: 'Midwest', MO: 'Midwest', NE: 'Midwest', ND: 'Midwest', SD: 'Midwest',
  AZ: 'Southwest', NM: 'Southwest', OK: 'Southwest', TX: 'Southwest',
  AK: 'West', CA: 'West', CO: 'West', HI: 'West', ID: 'West', MT: 'West', NV: 'West',
  OR: 'West', UT: 'West', WA: 'West', WY: 'West',
};

export function getRegion(state: string): string {
  return STATE_TO_REGION[state] || 'Other';
}

/**
 * Count occurrences in an array, returning sorted {name, count} pairs.
 */
export function countBy(values: string[]): Array<{ name: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Format a number as a compact dollar string (e.g., 92000 -> "$92k").
 */
export function formatCompact(value: number): string {
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${value}`;
}
