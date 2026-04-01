import { describe, it, expect } from 'vitest';
import {
  computeCompComparison,
  computeDistanceKm,
  computeCostOfLivingRatio,
  computeRelocationIndicator,
  computeExperienceMatch,
  computePositionTypeMatch,
  computeDioceseFamiliarity,
  computeTimeSinceLastMove,
  computeStipendToIncomeRatio,
  computeAllComparisons,
} from '../personal-context';
import type { PersonalData, Position } from '../types';

const mockUser: PersonalData = {
  name: 'Rev. Alice Smith',
  clergy_guid: 'guid-alice',
  current_position: {
    title: 'Rector',
    parish: "St. Mark's",
    parish_id: 1,
    start_date: null,
    diocese: 'Virginia',
    city: 'Arlington',
    state: 'VA',
  },
  ordination_year: 2015,
  experience_years: 11,
  positions: [
    { title: 'Rector', parish: "St. Mark's", parish_id: 1, diocese: 'Virginia', city: 'Arlington', state: 'VA', start_year: 2019, end_year: null, is_current: true },
    { title: 'Assoc. Rector', parish: 'Grace Church', parish_id: 2, diocese: 'Texas', city: 'Houston', state: 'TX', start_year: 2015, end_year: 2018, is_current: false },
  ],
  compensation_benchmarks: {
    diocese_median: 78000,
    diocese_female_median: 74000,
    diocese_male_median: 80000,
    asa_bucket_median: 75000,
    position_type_median: 82000,
    experience_bracket_median: 79000,
    year: 2023,
  },
  current_parish: {
    asa: 145,
    plate_pledge: 285000,
    membership: 312,
    operating_revenue: 350000,
    lat: 38.88,
    lng: -77.10,
    census_median_income: 72500,
    census_population: 50000,
    clergy_count_10yr: 3,
    avg_tenure_years: 4.2,
  },
};

describe('computeCompComparison', () => {
  it('returns percentage difference between two values', () => {
    const result = computeCompComparison(78000, 85000);
    expect(result).toBeCloseTo(9.0, 0);
  });

  it('returns null if either value is null', () => {
    expect(computeCompComparison(null, 85000)).toBeNull();
    expect(computeCompComparison(78000, null)).toBeNull();
  });
});

describe('computeDistanceKm', () => {
  it('computes haversine distance between two points', () => {
    // Arlington VA to Houston TX is ~2000km
    const dist = computeDistanceKm(38.88, -77.10, 29.76, -95.37);
    expect(dist).toBeGreaterThan(1900);
    expect(dist).toBeLessThan(2200);
  });

  it('returns null if any coordinate is null', () => {
    expect(computeDistanceKm(null, -77, 29, -95)).toBeNull();
  });
});

describe('computeCostOfLivingRatio', () => {
  it('returns ratio of target to source median income', () => {
    const ratio = computeCostOfLivingRatio(72500, 60000);
    expect(ratio).toBeCloseTo(0.83, 1);
  });

  it('returns null if either value is null', () => {
    expect(computeCostOfLivingRatio(null, 60000)).toBeNull();
  });
});

describe('computeRelocationIndicator', () => {
  it('returns Same diocese when dioceses match', () => {
    expect(computeRelocationIndicator('Virginia', 'VA', 'Virginia', 'VA')).toBe('Same diocese');
  });

  it('returns Different diocese, same state when states match', () => {
    expect(computeRelocationIndicator('Virginia', 'VA', 'Southern Virginia', 'VA')).toBe('Different diocese, same state');
  });

  it('returns Relocation required when different state', () => {
    expect(computeRelocationIndicator('Virginia', 'VA', 'Texas', 'TX')).toBe('Relocation required');
  });
});

describe('computeDioceseFamiliarity', () => {
  it('returns true if user has served in target diocese', () => {
    expect(computeDioceseFamiliarity(mockUser.positions, 'Texas')).toBe(true);
  });

  it('returns false if user has never served in target diocese', () => {
    expect(computeDioceseFamiliarity(mockUser.positions, 'Massachusetts')).toBe(false);
  });
});

describe('computePositionTypeMatch', () => {
  it('returns same when position types match', () => {
    expect(computePositionTypeMatch('Rector', 'Rector')).toBe('same');
  });

  it('returns progression for associate -> rector', () => {
    expect(computePositionTypeMatch('Assoc. Rector', 'Rector')).toBe('progression');
  });

  it('returns different for unrelated types', () => {
    expect(computePositionTypeMatch('Rector', 'Chaplain')).toBe('different');
  });
});

describe('computeAllComparisons', () => {
  it('returns an object with all non-null comparisons', () => {
    const mockPosition = {
      diocese: 'Texas',
      state: 'TX',
      compensation: { diocese_median: 85000 },
      estimated_total_comp: 90000,
      church_infos: [{ lat: 29.76, lng: -95.37 }],
      census: { median_household_income: 60000, population: 40000 },
      parish_contexts: [{ clergy_count_10yr: 2, avg_tenure_years: 3.5, current_clergy_count: 1 }],
      position_type: 'Rector',
    } as unknown as Position;

    const result = computeAllComparisons(mockUser, mockPosition);
    expect(result.diocese_median_diff_pct).toBeDefined();
    expect(result.distance_km).toBeGreaterThan(0);
    expect(result.relocation).toBe('Relocation required');
    expect(result.diocese_familiar).toBe(true);  // served in Texas
  });
});
