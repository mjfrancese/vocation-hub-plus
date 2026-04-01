import type { PersonalData, Position } from './types';

/**
 * Compute percentage difference: how much higher/lower target is vs source.
 * Returns positive if target > source, negative if target < source.
 */
export function computeCompComparison(
  sourceMedian: number | null | undefined,
  targetMedian: number | null | undefined,
): number | null {
  if (sourceMedian == null || targetMedian == null || sourceMedian === 0) return null;
  return Math.round(((targetMedian - sourceMedian) / sourceMedian) * 1000) / 10;
}

/**
 * Haversine distance between two lat/lng points in kilometers.
 */
export function computeDistanceKm(
  lat1: number | null | undefined, lng1: number | null | undefined,
  lat2: number | null | undefined, lng2: number | null | undefined,
): number | null {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Cost of living ratio: target / source median household income.
 * < 1.0 means target area is cheaper; > 1.0 means more expensive.
 */
export function computeCostOfLivingRatio(
  sourceIncome: number | null | undefined,
  targetIncome: number | null | undefined,
): number | null {
  if (sourceIncome == null || targetIncome == null || sourceIncome === 0) return null;
  return Math.round((targetIncome / sourceIncome) * 100) / 100;
}

/**
 * Stipend-to-local-income ratio: what fraction of local median income the stipend covers.
 */
export function computeStipendToIncomeRatio(
  stipend: number | null | undefined,
  localMedianIncome: number | null | undefined,
): number | null {
  if (stipend == null || localMedianIncome == null || localMedianIncome === 0) return null;
  return Math.round((stipend / localMedianIncome) * 100) / 100;
}

/**
 * Relocation indicator based on diocese and state.
 */
export function computeRelocationIndicator(
  userDiocese: string | null | undefined, userState: string | null | undefined,
  targetDiocese: string | null | undefined, targetState: string | null | undefined,
): string | null {
  if (!userDiocese || !targetDiocese) return null;
  if (userDiocese.toLowerCase() === targetDiocese.toLowerCase()) return 'Same diocese';
  if (userState && targetState && userState.toLowerCase() === targetState.toLowerCase()) return 'Different diocese, same state';
  return 'Relocation required';
}

/**
 * Check whether the user has previously served in a given diocese.
 */
export function computeDioceseFamiliarity(
  positions: PersonalData['positions'],
  targetDiocese: string | null | undefined,
): boolean {
  if (!targetDiocese || !positions) return false;
  const target = targetDiocese.toLowerCase();
  return positions.some(p => p.diocese?.toLowerCase() === target);
}

/**
 * Position type match: same, progression (career advancement), or different.
 */
export function computePositionTypeMatch(
  currentType: string | null | undefined,
  targetType: string | null | undefined,
): 'same' | 'progression' | 'different' | null {
  if (!currentType || !targetType) return null;
  const curr = currentType.toLowerCase();
  const tgt = targetType.toLowerCase();
  if (curr === tgt) return 'same';
  // Common progressions
  const progressions: Record<string, string[]> = {
    'assoc. rector': ['rector'],
    'associate rector': ['rector'],
    'assistant rector': ['rector', 'associate rector'],
    'curate': ['rector', 'associate rector', 'assoc. rector'],
    'deacon': ['rector', 'vicar', 'priest-in-charge'],
    'vicar': ['rector'],
    'priest-in-charge': ['rector'],
    'interim rector': ['rector'],
  };
  if (progressions[curr]?.some(p => tgt.includes(p))) return 'progression';
  return 'different';
}

/**
 * Experience match: user's years vs. typical at this parish size.
 * Returns null if data insufficient.
 */
export function computeExperienceMatch(
  userExperience: number | null | undefined,
  _targetAsa: number | null | undefined,
): string | null {
  if (userExperience == null) return null;
  return `${userExperience} years of experience`;
}

/**
 * Time since last move.
 */
export function computeTimeSinceLastMove(
  currentPositionStartYear: number | null | undefined,
): number | null {
  if (currentPositionStartYear == null) return null;
  return new Date().getFullYear() - currentPositionStartYear;
}

/** Result of all personal context comparisons for a position */
export interface PersonalComparisons {
  // Compensation
  diocese_median_diff_pct: number | null;
  estimated_comp_diff_pct: number | null;
  asa_bucket_median_diff_pct: number | null;
  position_type_median_diff_pct: number | null;
  // Parish profile
  asa_comparison: { yours: number; theirs: number } | null;
  plate_pledge_comparison: { yours: number; theirs: number } | null;
  membership_comparison: { yours: number; theirs: number } | null;
  operating_revenue_comparison: null;
  // Geographic
  distance_km: number | null;
  cost_of_living_ratio: number | null;
  stipend_to_income_ratio: number | null;
  relocation: string | null;
  // Career fit
  experience_info: string | null;
  position_type_match: 'same' | 'progression' | 'different' | null;
  diocese_familiar: boolean;
  years_since_last_move: number | null;
}

/**
 * Compute all personal context comparisons for a given position.
 */
export function computeAllComparisons(user: PersonalData, position: Position): PersonalComparisons {
  const cp = user.current_parish;
  const cb = user.compensation_benchmarks;
  const posComp = position.compensation;
  const posChurch = position.church_info;
  const posCensus = position.census;

  // Parse avg_sunday_attendance (stored as a string on Position)
  const posAsa = position.avg_sunday_attendance
    ? parseInt(position.avg_sunday_attendance, 10) || null
    : null;

  return {
    // Compensation
    diocese_median_diff_pct: computeCompComparison(cb?.diocese_median, posComp?.diocese_median),
    estimated_comp_diff_pct: computeCompComparison(
      cb?.diocese_median,
      position.estimated_total_comp,
    ),
    asa_bucket_median_diff_pct: computeCompComparison(cb?.asa_bucket_median, posComp?.diocese_median),
    position_type_median_diff_pct: computeCompComparison(cb?.position_type_median, posComp?.diocese_median),

    // Parish profile
    asa_comparison: (cp?.asa != null && posAsa != null)
      ? { yours: cp.asa, theirs: posAsa }
      : null,
    plate_pledge_comparison: (cp?.plate_pledge != null && position.parochial?.years)
      ? (() => {
          const years = Object.values(position.parochial!.years);
          const latest = years[years.length - 1];
          return latest?.plateAndPledge != null
            ? { yours: cp.plate_pledge!, theirs: latest.plateAndPledge }
            : null;
        })()
      : null,
    membership_comparison: (cp?.membership != null && position.parochial?.years)
      ? (() => {
          const years = Object.values(position.parochial!.years);
          const latest = years[years.length - 1];
          return latest?.membership != null
            ? { yours: cp.membership!, theirs: latest.membership }
            : null;
        })()
      : null,
    operating_revenue_comparison: null,

    // Geographic
    distance_km: computeDistanceKm(cp?.lat, cp?.lng, posChurch?.lat, posChurch?.lng),
    cost_of_living_ratio: computeCostOfLivingRatio(cp?.census_median_income, posCensus?.median_household_income),
    stipend_to_income_ratio: computeStipendToIncomeRatio(position.estimated_total_comp, posCensus?.median_household_income),
    relocation: computeRelocationIndicator(
      user.current_position?.diocese, user.current_position?.state,
      position.diocese, position.state,
    ),

    // Career fit
    experience_info: computeExperienceMatch(user.experience_years, null),
    position_type_match: computePositionTypeMatch(user.current_position?.title, position.position_type),
    diocese_familiar: computeDioceseFamiliarity(user.positions, position.diocese),
    years_since_last_move: computeTimeSinceLastMove(
      user.positions.find(p => p.is_current)?.start_year,
    ),
  };
}
