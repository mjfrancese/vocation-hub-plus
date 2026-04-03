export interface QualityReport {
  pass: boolean;
  checks: Array<{
    name: string;
    pass: boolean;
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

export function checkQuality(input: QualityInput): QualityReport {
  const checks: QualityReport['checks'] = [];

  checks.push({
    name: 'min-positions',
    pass: input.totalPositions >= THRESHOLDS.minPositions,
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
    actual: Math.round(expiredPct),
    threshold: THRESHOLDS.maxExpiredPct,
    message: expiredPct <= THRESHOLDS.maxExpiredPct
      ? `${Math.round(expiredPct)}% expired (<= ${THRESHOLDS.maxExpiredPct}%)`
      : `${Math.round(expiredPct)}% expired exceeds ${THRESHOLDS.maxExpiredPct}% threshold`,
  });

  checks.push({
    name: 'phase2-health',
    pass: input.phase2Success,
    actual: input.phase2Success ? 1 : 0,
    threshold: 1,
    message: input.phase2Success ? 'Phase 2 (discover+scrape) succeeded' : 'Phase 2 (discover+scrape) failed',
  });

  checks.push({
    name: 'phase3-health',
    pass: input.phase3Success,
    actual: input.phase3Success ? 1 : 0,
    threshold: 1,
    message: input.phase3Success ? 'Phase 3 (backfill) succeeded' : 'Phase 3 (backfill) failed',
  });

  return {
    pass: checks.every(c => c.pass),
    checks,
  };
}
