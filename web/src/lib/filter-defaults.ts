import { Position } from './types';
import { getUnifiedStatus, UnifiedStatus, isQualifyingUnlisted } from './status-helpers';

/**
 * Default statuses shown on page load (chips pre-selected).
 */
export const DEFAULT_ACTIVE_STATUSES: UnifiedStatus[] = ['Active', 'Developing', 'Interim'];

/**
 * Check if a position should appear in the default view.
 * Active/New/Developing/Interim always show; qualifying Unlisted positions also show.
 */
export function passesDefaultFilter(pos: Position): boolean {
  const unified = getUnifiedStatus(pos.vh_status || pos.status, pos.visibility);
  if (unified === 'Active' || unified === 'Developing' || unified === 'Interim') return true;
  if (isQualifyingUnlisted(pos)) return true;
  return false;
}

/**
 * Duration shorthand to milliseconds for date range filtering.
 */
const DURATION_MS: Record<string, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '6m': 182 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

export const POSTED_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '6m', label: 'Last 6 months' },
  { value: '1y', label: 'Last year' },
] as const;

/**
 * Check if a position was posted within the given duration.
 * Uses receiving_names_from, falls back to first_seen.
 */
export function isPostedWithin(pos: Position, duration: string): boolean {
  const ms = DURATION_MS[duration];
  if (!ms) return true; // unknown duration = no filter

  const dateStr = pos.receiving_names_from || pos.first_seen;
  if (!dateStr) return false;

  const parsed = parseAnyDate(dateStr);
  if (!parsed) return false;

  const cutoff = Date.now() - ms;
  return parsed.getTime() >= cutoff;
}

function parseAnyDate(str: string): Date | null {
  if (!str) return null;
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
