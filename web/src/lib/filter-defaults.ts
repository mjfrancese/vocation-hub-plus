import { Position } from './types';
import { getUnifiedStatus, UnifiedStatus, isQualifyingUnlisted } from './status-helpers';
import { parseDate } from './date-utils';

/**
 * Default statuses shown on page load (chips pre-selected).
 */
export const DEFAULT_ACTIVE_STATUSES: UnifiedStatus[] = ['Active', 'Interim'];

/**
 * Check if a position should appear in the default view.
 *
 * Public positions: Active/Developing/Interim always show.
 * Extended positions: must also pass data-quality checks (quality >= 85,
 * receiving_names_from within 12 months, parochial data present) regardless
 * of their VH status.  Without this gate, extended positions with an active
 * VH status but no location/parochial data would slip through.
 */
export function passesDefaultFilter(pos: Position): boolean {
  const unified = getUnifiedStatus(pos.vh_status || pos.status, pos.visibility);
  const isExtended = pos.visibility === 'extended' || pos.visibility === 'extended_hidden';

  if (isExtended) {
    // All extended positions must meet data-quality requirements
    return isQualifyingUnlisted(pos, true);
  }

  // Public positions: show Active/Developing/Interim
  if (unified === 'Active' || unified === 'Developing' || unified === 'Interim') return true;
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

/**
 * Check if a position was posted within the given duration.
 * Uses receiving_names_from, falls back to first_seen.
 */
export function isPostedWithin(pos: Position, duration: string): boolean {
  const ms = DURATION_MS[duration];
  if (!ms) return true; // unknown duration = no filter

  const dateStr = pos.receiving_names_from || pos.first_seen;
  if (!dateStr) return false;

  const parsed = parseDate(dateStr);
  if (!parsed) return false;

  const cutoff = Date.now() - ms;
  return parsed.getTime() >= cutoff;
}
