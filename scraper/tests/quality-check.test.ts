import { describe, it, expect } from 'vitest';
import { checkQuality } from '../src/quality-check';

describe('checkQuality', () => {
  it('passes for healthy scrape', () => {
    const result = checkQuality({
      totalPositions: 200, newCount: 5, expiredCount: 3,
      phase2Success: true, phase3Success: true,
    });
    expect(result.pass).toBe(true);
    expect(result.checks.every(c => c.pass)).toBe(true);
  });

  it('fails when position count is too low', () => {
    const result = checkQuality({
      totalPositions: 10, newCount: 0, expiredCount: 0,
      phase2Success: true, phase3Success: true,
    });
    expect(result.pass).toBe(false);
    expect(result.checks.find(c => c.name === 'min-positions')?.pass).toBe(false);
  });

  it('fails when too many positions expire', () => {
    const result = checkQuality({
      totalPositions: 100, newCount: 0, expiredCount: 60,
      phase2Success: true, phase3Success: true,
    });
    expect(result.pass).toBe(false);
    expect(result.checks.find(c => c.name === 'max-expired-pct')?.pass).toBe(false);
  });

  it('reports phase failures as non-blocking informational checks', () => {
    // Phase 2/3 failures are reported but do NOT fail the overall pass,
    // so that a cleanly-aborted run with good Phase 1 data still ships.
    // Only data-volume gates (min-positions, max-expired-pct) are blocking.
    const result = checkQuality({
      totalPositions: 200, newCount: 5, expiredCount: 3,
      phase2Success: false, phase3Success: false,
    });
    expect(result.pass).toBe(true);
    expect(result.checks.find(c => c.name === 'phase2-health')?.pass).toBe(false);
    expect(result.checks.find(c => c.name === 'phase2-health')?.blocking).toBe(false);
    expect(result.checks.find(c => c.name === 'phase3-health')?.pass).toBe(false);
    expect(result.checks.find(c => c.name === 'phase3-health')?.blocking).toBe(false);
  });

  it('marks min-positions and max-expired-pct as blocking', () => {
    const result = checkQuality({
      totalPositions: 200, newCount: 5, expiredCount: 3,
      phase2Success: true, phase3Success: true,
    });
    expect(result.checks.find(c => c.name === 'min-positions')?.blocking).toBe(true);
    expect(result.checks.find(c => c.name === 'max-expired-pct')?.blocking).toBe(true);
  });
});
