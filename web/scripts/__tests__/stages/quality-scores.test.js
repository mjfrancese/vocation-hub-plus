import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const computeQualityScores = require('../../stages/quality-scores.js');
const { parseMMDDYYYY, ACTIVE_STATUSES, IN_PROGRESS_STATUSES } = computeQualityScores;

// ---------------------------------------------------------------------------
// parseMMDDYYYY
// ---------------------------------------------------------------------------

describe('parseMMDDYYYY', () => {
  it('returns null for null input', () => {
    expect(parseMMDDYYYY(null)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseMMDDYYYY('')).toBeNull();
  });

  it('returns null for a non-matching string', () => {
    expect(parseMMDDYYYY('2024-01-15')).toBeNull();
    expect(parseMMDDYYYY('January 15, 2024')).toBeNull();
  });

  it('parses a valid MM/DD/YYYY date', () => {
    const d = parseMMDDYYYY('03/15/2024');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(2); // 0-indexed March
    expect(d.getDate()).toBe(15);
  });

  it('parses single-digit month and day', () => {
    const d = parseMMDDYYYY('1/5/2023');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2023);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Public positions always score 100
// ---------------------------------------------------------------------------

describe('computeQualityScores -- public positions', () => {
  it('assigns score=100, visibility=public, and correct component', () => {
    const positions = [{ vh_id: '1', name: 'St. Foo Church' }];
    computeQualityScores(positions, true);
    expect(positions[0].quality_score).toBe(100);
    expect(positions[0].quality_components).toEqual(['Public listing (100)']);
    expect(positions[0].visibility).toBe('public');
  });

  it('scores all public positions at 100 regardless of data', () => {
    const positions = [
      { name: 'Position in Somewhere' },
      { name: 'Unknown Position' },
      {},
    ];
    computeQualityScores(positions, true);
    for (const pos of positions) {
      expect(pos.quality_score).toBe(100);
      expect(pos.visibility).toBe('public');
    }
  });

  it('returns the positions array', () => {
    const positions = [{ name: 'St. Bar' }];
    const result = computeQualityScores(positions, true);
    expect(result).toBe(positions);
  });
});

// ---------------------------------------------------------------------------
// Extended positions -- status component
// ---------------------------------------------------------------------------

describe('computeQualityScores -- status scoring', () => {
  it('awards 25 points for an active status', () => {
    for (const status of ACTIVE_STATUSES) {
      const positions = [{ vh_status: status, name: 'St. Active' }];
      computeQualityScores(positions, false);
      expect(positions[0].quality_components).toContain('Active status (25)');
      expect(positions[0].quality_score).toBeGreaterThanOrEqual(25);
    }
  });

  it('awards 15 points for an in-progress status', () => {
    for (const status of IN_PROGRESS_STATUSES) {
      const positions = [{ vh_status: status, name: 'St. Progress' }];
      computeQualityScores(positions, false);
      expect(positions[0].quality_components).toContain('In-progress status (15)');
    }
  });

  it('awards no status points for an unknown status', () => {
    const positions = [{ vh_status: 'Closed', name: 'St. Closed' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).not.toContain('Active status (25)');
    expect(positions[0].quality_components).not.toContain('In-progress status (15)');
  });

  it('awards no status points when vh_status is absent', () => {
    const positions = [{ name: 'St. NoStatus' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).not.toContain('Active status (25)');
  });
});

// ---------------------------------------------------------------------------
// Extended positions -- recency component
// ---------------------------------------------------------------------------

describe('computeQualityScores -- recency scoring', () => {
  it('awards 15 points for a date within the past year', () => {
    // Six months ago
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const mm = String(sixMonthsAgo.getMonth() + 1).padStart(2, '0');
    const dd = String(sixMonthsAgo.getDate()).padStart(2, '0');
    const yyyy = sixMonthsAgo.getFullYear();
    const positions = [{ receiving_names_from: `${mm}/${dd}/${yyyy}`, name: 'St. Recent' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).toContain('Recent date (15)');
    expect(positions[0].quality_components).not.toContain('Very recent date (5)');
  });

  it('awards 15+5 points for a date within the past 3 months', () => {
    // One month ago
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const mm = String(oneMonthAgo.getMonth() + 1).padStart(2, '0');
    const dd = String(oneMonthAgo.getDate()).padStart(2, '0');
    const yyyy = oneMonthAgo.getFullYear();
    const positions = [{ receiving_names_from: `${mm}/${dd}/${yyyy}`, name: 'St. VeryRecent' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).toContain('Recent date (15)');
    expect(positions[0].quality_components).toContain('Very recent date (5)');
  });

  it('does not award recency points for a date over one year ago', () => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const mm = String(twoYearsAgo.getMonth() + 1).padStart(2, '0');
    const dd = String(twoYearsAgo.getDate()).padStart(2, '0');
    const yyyy = twoYearsAgo.getFullYear();
    const positions = [{ receiving_names_from: `${mm}/${dd}/${yyyy}`, name: 'St. Old' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).not.toContain('Recent date (15)');
  });

  it('does not award recency points for a missing date', () => {
    const positions = [{ name: 'St. NoDate' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).not.toContain('Recent date (15)');
  });
});

// ---------------------------------------------------------------------------
// Extended positions -- name clarity component
// ---------------------------------------------------------------------------

describe('computeQualityScores -- name clarity scoring', () => {
  it('awards 10 points when congregation name is meaningful', () => {
    const positions = [{ name: 'St. Timothy Episcopal Church' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).toContain('Congregation identified (10)');
  });

  it('does not award congregation points for "Position in ..." names', () => {
    const positions = [{ name: 'Position in Alabama' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).not.toContain('Congregation identified (10)');
  });

  it('does not award congregation points for "Unknown Position"', () => {
    const positions = [{ name: 'Unknown Position' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).not.toContain('Congregation identified (10)');
  });

  it('does not award congregation points when name is absent', () => {
    const positions = [{}];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).not.toContain('Congregation identified (10)');
  });

  it('awards 5 points when congregation field is set and meaningful', () => {
    const positions = [{ congregation: 'St. Mark Church' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).toContain('Position named (5)');
  });

  it('awards 5 points when position_title is set and meaningful', () => {
    const positions = [{ position_title: 'Associate Rector' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).toContain('Position named (5)');
  });

  it('does not award position-named points when congregation starts with "Position in"', () => {
    const positions = [{ congregation: 'Position in Vermont' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).not.toContain('Position named (5)');
  });
});

// ---------------------------------------------------------------------------
// Extended positions -- data richness components
// ---------------------------------------------------------------------------

describe('computeQualityScores -- data richness scoring', () => {
  it('awards 10 points for church_infos match', () => {
    const positions = [{ church_infos: [{ id: 1 }] }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).toContain('Church matched (10)');
  });

  it('does not award church match points for empty church_infos', () => {
    const positions = [{ church_infos: [] }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).not.toContain('Church matched (10)');
  });

  it('awards 10 points for parochial data with years', () => {
    const positions = [{ parochials: [{ years: { 2023: {} } }] }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).toContain('Parochial data (10)');
  });

  it('does not award parochial points when years object is empty', () => {
    const positions = [{ parochials: [{ years: {} }] }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).not.toContain('Parochial data (10)');
  });

  it('awards 5 points for position_type', () => {
    const positions = [{ position_type: 'Rector' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).toContain('Position type (5)');
  });

  it('awards 5 points for state', () => {
    const positions = [{ state: 'Virginia' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).toContain('State known (5)');
  });

  it('awards 5 points for exact match_confidence', () => {
    const positions = [{ match_confidence: 'exact' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).toContain('Exact match (5)');
  });

  it('does not award exact match for non-exact match_confidence', () => {
    const positions = [{ match_confidence: 'fuzzy' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).not.toContain('Exact match (5)');
  });

  it('awards 5 points for a non-open-ended receiving_names_to', () => {
    const positions = [{ receiving_names_to: '06/30/2025' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).toContain('End date set (5)');
  });

  it('does not award end-date points for "Open ended"', () => {
    const positions = [{ receiving_names_to: 'Open ended' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_components).not.toContain('End date set (5)');
  });
});

// ---------------------------------------------------------------------------
// No congregation name -- score capped at 45
// ---------------------------------------------------------------------------

describe('computeQualityScores -- no congregation name capped at 45', () => {
  it('caps score at 45 for "Position in ..." name even with many data points', () => {
    const positions = [{
      name: 'Position in Vermont',
      vh_status: 'Receiving names',       // +25
      church_infos: [{ id: 1 }],          // +10
      parochials: [{ years: { 2023: {} } }], // +10
      position_type: 'Rector',            // +5
      state: 'Vermont',                   // +5
      match_confidence: 'exact',          // +5
      receiving_names_to: '06/30/2025',   // +5
    }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_score).toBe(45);
    expect(positions[0].quality_components).toContain('No congregation name (capped at 45)');
    expect(positions[0].visibility).toBe('extended_hidden');
  });

  it('caps score at 45 for "Unknown Position" name', () => {
    const positions = [{
      name: 'Unknown Position',
      vh_status: 'Receiving names',       // +25
      church_infos: [{ id: 1 }],          // +10
      position_type: 'Rector',            // +5
      state: 'Virginia',                  // +5
      match_confidence: 'exact',          // +5
    }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_score).toBe(45);
    expect(positions[0].quality_components).toContain('No congregation name (capped at 45)');
  });

  it('does not cap score for a position with a valid congregation name', () => {
    const positions = [{
      name: 'St. Timothy Church',
      vh_status: 'Receiving names',       // +25
      church_infos: [{ id: 1 }],          // +10
      position_type: 'Rector',            // +5
      state: 'Virginia',                  // +5
      match_confidence: 'exact',          // +5
    }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_score).toBeGreaterThan(45);
    expect(positions[0].quality_components).not.toContain('No congregation name (capped at 45)');
  });
});

// ---------------------------------------------------------------------------
// Visibility assignment
// ---------------------------------------------------------------------------

describe('computeQualityScores -- visibility', () => {
  it('sets visibility=extended when score >= 50', () => {
    // name 'St. Full Church' earns: congregation (10) + active status (25)
    // + church matched (10) + position type (5) + state (5) + exact match (5) = 60
    const positions = [{
      name: 'St. Full Church',
      vh_status: 'Receiving names',  // +25
      church_infos: [{ id: 1 }],     // +10
      position_type: 'Rector',       // +5
      state: 'Virginia',             // +5
      match_confidence: 'exact',     // +5
    }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_score).toBe(60);
    expect(positions[0].visibility).toBe('extended');
  });

  it('sets visibility=extended_hidden when score < 50', () => {
    const positions = [{ name: 'St. Sparse' }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_score).toBeLessThan(50);
    expect(positions[0].visibility).toBe('extended_hidden');
  });
});

// ---------------------------------------------------------------------------
// Full data extended position
// ---------------------------------------------------------------------------

describe('computeQualityScores -- full data extended position', () => {
  it('accumulates all applicable components and does not cap', () => {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const mm = String(oneMonthAgo.getMonth() + 1).padStart(2, '0');
    const dd = String(oneMonthAgo.getDate()).padStart(2, '0');
    const yyyy = oneMonthAgo.getFullYear();

    const positions = [{
      name: 'Grace Episcopal Church',             // +10 congregation
      congregation: 'Rector',                      // +5 position named
      vh_status: 'Receiving names',               // +25 active
      receiving_names_from: `${mm}/${dd}/${yyyy}`, // +15 recent, +5 very recent
      church_infos: [{ id: 42 }],                 // +10 church matched
      parochials: [{ years: { 2023: { asa: 150 } } }], // +10 parochial
      position_type: 'Rector',                    // +5
      state: 'Virginia',                          // +5
      match_confidence: 'exact',                  // +5
      receiving_names_to: '12/31/2025',           // +5
    }];
    computeQualityScores(positions, false);

    const pos = positions[0];
    // 10+5+25+15+5+10+10+5+5+5+5 = 100
    expect(pos.quality_score).toBe(100);
    expect(pos.visibility).toBe('extended');
    expect(pos.quality_components).toContain('Active status (25)');
    expect(pos.quality_components).toContain('Congregation identified (10)');
    expect(pos.quality_components).toContain('Position named (5)');
    expect(pos.quality_components).toContain('Recent date (15)');
    expect(pos.quality_components).toContain('Very recent date (5)');
    expect(pos.quality_components).toContain('Church matched (10)');
    expect(pos.quality_components).toContain('Parochial data (10)');
    expect(pos.quality_components).toContain('Position type (5)');
    expect(pos.quality_components).toContain('State known (5)');
    expect(pos.quality_components).toContain('Exact match (5)');
    expect(pos.quality_components).toContain('End date set (5)');
    expect(pos.quality_components).not.toContain('No congregation name (capped at 45)');
  });
});

// ---------------------------------------------------------------------------
// Score capped at 100
// ---------------------------------------------------------------------------

describe('computeQualityScores -- score ceiling', () => {
  it('never exceeds 100', () => {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const mm = String(oneMonthAgo.getMonth() + 1).padStart(2, '0');
    const dd = String(oneMonthAgo.getDate()).padStart(2, '0');
    const yyyy = oneMonthAgo.getFullYear();

    const positions = [{
      name: 'St. Everything Church',
      congregation: 'Rector',
      vh_status: 'Receiving names',
      receiving_names_from: `${mm}/${dd}/${yyyy}`,
      church_infos: [{ id: 1 }, { id: 2 }],
      parochials: [{ years: { 2023: {}, 2022: {} } }],
      position_type: 'Rector',
      state: 'Texas',
      match_confidence: 'exact',
      receiving_names_to: '12/31/2025',
    }];
    computeQualityScores(positions, false);
    expect(positions[0].quality_score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Mixed batch of public and extended positions
// ---------------------------------------------------------------------------

describe('computeQualityScores -- return value', () => {
  it('returns the same positions array (mutates in place)', () => {
    const positions = [{ name: 'St. Test' }];
    const result = computeQualityScores(positions, false);
    expect(result).toBe(positions);
  });

  it('handles an empty array without error', () => {
    expect(() => computeQualityScores([], false)).not.toThrow();
    expect(() => computeQualityScores([], true)).not.toThrow();
  });
});
