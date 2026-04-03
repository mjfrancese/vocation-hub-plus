/**
 * Narrative helpers for the Overview tab.
 *
 * Pure functions that transform raw position data into display-ready strings.
 * The Overview tab calls these helpers -- it does not contain data
 * transformation logic itself.
 */

import { Position } from './types';
import { parseAnyDate } from './date-utils';

// ---------------------------------------------------------------------------
// Parochial data extraction
// ---------------------------------------------------------------------------

interface ParochialMetrics {
  latestAsa: number | null;
  latestAsaYear: string | null;
  latestPlatePledge: number | null;
  latestPlatePledgeYear: string | null;
  latestMembership: number | null;
  latestMembershipYear: string | null;
  asaTrend: TrendResult | null;
  givingTrend: TrendResult | null;
  membershipTrend: TrendResult | null;
  givingPerAttendee: number | null;
  yearRange: string | null;
}

interface TrendResult {
  pct: number;
  direction: 'up' | 'down' | 'flat';
  startYear: string;
  endYear: string;
  startValue: number;
  endValue: number;
}

/**
 * Extract all parochial metrics for the first (or selected) church.
 * Finds the latest year with data for each metric independently,
 * so membership can come from 2023 even if ASA is from 2024.
 */
export function extractParochialMetrics(pos: Position, churchIndex = 0): ParochialMetrics {
  const result: ParochialMetrics = {
    latestAsa: null, latestAsaYear: null,
    latestPlatePledge: null, latestPlatePledgeYear: null,
    latestMembership: null, latestMembershipYear: null,
    asaTrend: null, givingTrend: null, membershipTrend: null,
    givingPerAttendee: null, yearRange: null,
  };

  const parochial = pos.parochials?.[churchIndex];
  if (!parochial) return result;

  const years = Object.keys(parochial.years).sort();
  if (years.length === 0) return result;

  // Find latest non-null value for each metric
  for (let i = years.length - 1; i >= 0; i--) {
    const d = parochial.years[years[i]];
    if (result.latestAsa === null && d.averageAttendance != null && d.averageAttendance > 0) {
      result.latestAsa = d.averageAttendance;
      result.latestAsaYear = years[i];
    }
    if (result.latestPlatePledge === null && d.plateAndPledge != null && d.plateAndPledge > 0) {
      result.latestPlatePledge = d.plateAndPledge;
      result.latestPlatePledgeYear = years[i];
    }
    if (result.latestMembership === null && d.membership != null && d.membership > 0) {
      result.latestMembership = d.membership;
      result.latestMembershipYear = years[i];
    }
  }

  result.asaTrend = computeTrend(years, y => parochial.years[y]?.averageAttendance);
  result.givingTrend = computeTrend(years, y => parochial.years[y]?.plateAndPledge);
  result.membershipTrend = computeTrend(years, y => parochial.years[y]?.membership);

  if (result.latestAsa && result.latestPlatePledge) {
    result.givingPerAttendee = Math.round(result.latestPlatePledge / result.latestAsa);
  }

  result.yearRange = years.length > 1 ? `${years[0]}-${years[years.length - 1]}` : years[0];

  return result;
}

// ---------------------------------------------------------------------------
// Trend computation
// ---------------------------------------------------------------------------

function computeTrend(
  years: string[],
  getValue: (year: string) => number | null | undefined,
): TrendResult | null {
  let earliest: { value: number; year: string } | null = null;
  let latest: { value: number; year: string } | null = null;

  for (const y of years) {
    const v = getValue(y);
    if (v != null && v > 0) {
      if (!earliest) earliest = { value: v, year: y };
      latest = { value: v, year: y };
    }
  }

  if (!earliest || !latest || earliest.year === latest.year || earliest.value === 0) return null;

  const pct = ((latest.value - earliest.value) / earliest.value) * 100;
  const direction = pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat';
  return {
    pct,
    direction,
    startYear: earliest.year,
    endYear: latest.year,
    startValue: earliest.value,
    endValue: latest.value,
  };
}

// ---------------------------------------------------------------------------
// Display-ready string formatters
// ---------------------------------------------------------------------------

/**
 * "up 13% over 2014-2024" or "down 8% over 2018-2024" or "stable over 2014-2024"
 */
export function trendDescription(trend: TrendResult | null): string {
  if (!trend) return '';
  const period = `${trend.startYear}-${trend.endYear}`;
  if (trend.direction === 'flat') return `stable over ${period}`;
  const verb = trend.direction === 'up' ? 'up' : 'down';
  return `${verb} ${Math.abs(Math.round(trend.pct))}% over ${period}`;
}

/**
 * Trend CSS class: green for up, red for down, gray for flat/null.
 */
export function trendColorClass(trend: TrendResult | null): string {
  if (!trend || trend.direction === 'flat') return 'text-gray-500';
  return trend.direction === 'up' ? 'text-green-600' : 'text-red-600';
}

/**
 * "Annual plate & pledge / ASA" with the computed value.
 */
export function givingPerAttendeeDescription(givingPerAttendee: number | null): string {
  if (givingPerAttendee == null) return '';
  return `$${givingPerAttendee.toLocaleString()} per attendee`;
}

/**
 * "Compensation is 1.2x the area median household income"
 */
export function compToLocalIncomeRatio(totalComp: number | undefined, censusMedianIncome: number | undefined): string {
  if (!totalComp || !censusMedianIncome) return '';
  const ratio = (totalComp / censusMedianIncome).toFixed(1);
  return `Compensation is ${ratio}x the area median household income`;
}

/**
 * "larger than 67% of parishes in the diocese"
 */
export function diocesePercentileDescription(percentile: number | undefined, metric: string): string {
  if (percentile == null) return '';
  return `${metric} is larger than ${percentile}% of parishes in the diocese`;
}

/**
 * Format a dollar value compactly: $85k or $1.2M
 */
export function formatDollar(value: number | null | undefined): string {
  if (value == null) return '--';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value.toLocaleString()}`;
}

/**
 * Format a dollar value with full precision: $85,000
 */
export function formatDollarFull(value: number | null | undefined): string {
  if (value == null) return '--';
  return `$${value.toLocaleString()}`;
}

/**
 * Determine if a position is interim based on its position types or work type.
 */
export function isInterimPosition(pos: Position): boolean {
  const types = pos.position_types || [];
  if (types.includes('Interim') || types.includes('Supply')) return true;
  const pt = (pos.position_type || '').toLowerCase();
  return pt.includes('interim') || pt.includes('supply');
}

/**
 * Get the deep scrape field value by label keyword.
 * Skips values longer than 5000 chars (gibberish protection).
 */
export function findField(fields: Array<{ label: string; value: string }>, ...keywords: string[]): string {
  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    const match = fields.find(f =>
      f.label.toLowerCase().includes(lower) && f.value && f.value.length < 5000
    );
    if (match?.value) return match.value;
  }
  return '';
}

/**
 * Compute time on market from receiving_names_from or first_seen.
 */
export function timeOnMarket(pos: Position): string {
  const now = new Date();

  const firstSeen = parseAnyDate(pos.first_seen);
  const usable = firstSeen && (now.getTime() - firstSeen.getTime()) > 86400000 ? firstSeen : null;
  const seen = usable || parseAnyDate(pos.receiving_names_from);
  if (!seen) return '';

  const days = Math.floor((now.getTime() - seen.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return '';
  if (days < 1) return 'today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month';
  if (months < 12) return `${months} months`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1 year' : `${years} years`;
}
