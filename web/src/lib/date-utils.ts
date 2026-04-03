/**
 * Shared date parsing and formatting utilities.
 */

/**
 * Parse a date string in MM/DD/YYYY or ISO format into a Date object.
 * Returns null if the string is empty or unparseable.
 */
export function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Try MM/DD/YYYY
  const mdyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    return new Date(parseInt(mdyMatch[3]), parseInt(mdyMatch[1]) - 1, parseInt(mdyMatch[2]));
  }
  // Try ISO or other parseable format
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse a date string that may be a range like "02/18/2026 to 03/31/2026"
 * or "03/12/2026 -". Extracts the first date from such ranges, then
 * delegates to parseDate.
 */
export function parseAnyDate(str: string | undefined | null): Date | null {
  if (!str) return null;
  const first = str.split(/\s+(?:to|-)\s*/)[0].trim();
  return parseDate(first);
}

/**
 * Return the ordinal suffix for a number (st, nd, rd, th).
 */
export function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  const mod10 = n % 10;
  if (mod10 === 1) return 'st';
  if (mod10 === 2) return 'nd';
  if (mod10 === 3) return 'rd';
  return 'th';
}
