/**
 * Shared position display helpers used by PositionTable, ComparisonModal, etc.
 */

import { Position } from './types';

/** Get the display name for a position: prefer church_infos names, fall back to pos.name */
export function getChurchName(pos: Position): { text: string; suffix?: string; isEnriched: boolean } {
  if (pos.church_infos && pos.church_infos.length > 0) {
    const names = pos.church_infos.map(c => c.name).filter(Boolean);
    if (names.length > 2) {
      return { text: names[0], suffix: `+${names.length - 1} more`, isEnriched: true };
    }
    if (names.length > 0) return { text: names.join(' & '), isEnriched: true };
  }
  // For unmatched multi-congregation names, count parenthesized groups as congregations
  const parenCount = (pos.name.match(/\([^)]+\)/g) || []).length;
  if (parenCount > 2) {
    const firstName = pos.name.split(/\n/)[0].trim();
    return { text: firstName, suffix: `+${parenCount - 1} more`, isEnriched: false };
  }
  return { text: pos.name, isEnriched: false };
}

/** Get the city for a position: prefer church_infos cities, fall back to pos.city */
export function getCity(pos: Position): string {
  if (pos.church_infos && pos.church_infos.length > 0) {
    const cities = Array.from(new Set(pos.church_infos.map(c => c.city).filter(Boolean)));
    if (cities.length > 0) return cities.join(' & ');
  }
  return pos.city || '';
}

/** Get the state for a position: prefer church_infos first entry, fall back to pos.state */
export function getState(pos: Position): string {
  return pos.church_infos?.[0]?.state || pos.state || '';
}
