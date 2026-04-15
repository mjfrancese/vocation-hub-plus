export interface QualityReport {
  pass: boolean;
  checks: Array<{
    name: string;
    pass: boolean;
    blocking: boolean;
    actual: number;
    threshold: number;
    message: string;
  }>;
}

interface QualityInput {
  totalPositions: number;
  newCount: number;
  expiredCount: number;
  phase2Success: boolean;
  phase3Success: boolean;
}

const THRESHOLDS = {
  minPositions: 30,
  maxExpiredPct: 50,
};

/**
 * Quality check for a finished scrape.
 *
 * Only the data-volume checks (min-positions, max-expired-pct) are
 * blocking — these are the real signals of bad input data. Phase 2
 * and Phase 3 health are reported as informational because a partial
 * Phase 1 run with a cleanly-aborted Phase 2 is still valuable output
 * (Phase 1 data is the bulk of what consumers need). Blocking on
 * Phase 2/3 turns every timeout into zero-output, which is exactly
 * the failure mode this release fixes.
 */
export function checkQuality(input: QualityInput): QualityReport {
  const checks: QualityReport['checks'] = [];

  checks.push({
    name: 'min-positions',
    pass: input.totalPositions >= THRESHOLDS.minPositions,
    blocking: true,
    actual: input.totalPositions,
    threshold: THRESHOLDS.minPositions,
    message: input.totalPositions >= THRESHOLDS.minPositions
      ? `Found ${input.totalPositions} positions (>= ${THRESHOLDS.minPositions})`
      : `Only ${input.totalPositions} positions found (expected >= ${THRESHOLDS.minPositions})`,
  });

  const expiredPct = input.totalPositions > 0
    ? (input.expiredCount / input.totalPositions) * 100
    : 0;
  checks.push({
    name: 'max-expired-pct',
    pass: expiredPct <= THRESHOLDS.maxExpiredPct,
    blocking: true,
    actual: Math.round(expiredPct),
    threshold: THRESHOLDS.maxExpiredPct,
    message: expiredPct <= THRESHOLDS.maxExpiredPct
      ? `${Math.round(expiredPct)}% expired (<= ${THRESHOLDS.maxExpiredPct}%)`
      : `${Math.round(expiredPct)}% expired exceeds ${THRESHOLDS.maxExpiredPct}% threshold`,
  });

  checks.push({
    name: 'phase2-health',
    pass: input.phase2Success,
    blocking: false,
    actual: input.phase2Success ? 1 : 0,
    threshold: 1,
    message: input.phase2Success ? 'Phase 2 (discover+refresh) succeeded' : 'Phase 2 (discover+refresh) did not complete fully',
  });

  checks.push({
    name: 'phase3-health',
    pass: input.phase3Success,
    blocking: false,
    actual: input.phase3Success ? 1 : 0,
    threshold: 1,
    message: input.phase3Success ? 'Phase 3 (backfill) succeeded' : 'Phase 3 (backfill) did not complete fully',
  });

  return {
    pass: checks.filter(c => c.blocking).every(c => c.pass),
    checks,
  };
}
