import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const findSimilar = require('../../stages/find-similar.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a bare-minimum position with controllable scoring fields.
 * Defaults leave comp and housing undefined so individual tests can opt in.
 */
function makePos({
  id = '1',
  vh_id = 1,
  asa = null,
  comp = null,
  state = 'VA',
  position_type = 'Rector',
  housing_type = null,
  name = 'St. Paul\'s',
  city = 'Springfield',
} = {}) {
  const pos = {
    id,
    vh_id,
    position_type: position_type || undefined,
  };

  // Only attach estimated_total_comp when a value was explicitly provided
  if (comp !== null) pos.estimated_total_comp = comp;

  // Only attach housing_type when provided
  if (housing_type !== null) pos.housing_type = housing_type;

  // State via church_infos
  pos.church_infos = [{ name, city, state }];

  // Parochial data only when ASA was provided
  if (asa !== null) {
    pos.parochials = [{ years: { '2023': { averageAttendance: asa } } }];
  }

  return pos;
}

// ---------------------------------------------------------------------------
// findSimilar -- basic matching
// ---------------------------------------------------------------------------

describe('findSimilar -- same position_type matches', () => {
  it('attaches similar_positions when two positions share position type and close ASA', () => {
    const a = makePos({ id: '1', asa: 100, position_type: 'Rector', state: 'VA' });
    const b = makePos({ id: '2', vh_id: 2, asa: 105, position_type: 'Rector', state: 'VA' });
    findSimilar([a, b]);
    expect(a.similar_positions).toBeDefined();
    expect(a.similar_positions).toHaveLength(1);
    expect(a.similar_positions[0].id).toBe('2');
  });

  it('includes score in each similar_positions entry', () => {
    const a = makePos({ id: '1', asa: 100, position_type: 'Rector', state: 'VA' });
    const b = makePos({ id: '2', vh_id: 2, asa: 105, position_type: 'Rector', state: 'VA' });
    findSimilar([a, b]);
    expect(typeof a.similar_positions[0].score).toBe('number');
    expect(a.similar_positions[0].score).toBeGreaterThanOrEqual(3);
  });

  it('includes all expected fields in similar_positions entries', () => {
    const a = makePos({ id: '1', asa: 100, state: 'VA' });
    const b = makePos({ id: '2', vh_id: 2, asa: 105, state: 'VA',
      name: 'Grace Church', city: 'Richmond' });
    findSimilar([a, b]);
    const entry = a.similar_positions[0];
    expect(entry).toMatchObject({
      id: '2',
      vh_id: 2,
      name: 'Grace Church',
      city: 'Richmond',
      state: 'VA',
      position_type: 'Rector',
    });
    expect('asa' in entry).toBe(true);
    expect('estimated_total_comp' in entry).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findSimilar -- scoring: ASA ±25% adds 3 points
// ---------------------------------------------------------------------------

describe('findSimilar -- scoring: ASA within ±25% adds 3 points', () => {
  it('awards +3 when ASA ratio is exactly 0.75 (lower boundary)', () => {
    // Use only ASA + state to produce a clean score: ASA(3) + state(2) = 5
    // No comp, no housing, same position_type would add 2 more -- neutralize it
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: null });
    const b = makePos({ id: '2', vh_id: 2, asa: 75, state: 'VA', position_type: null });
    findSimilar([a, b]);
    // ASA(3) + state(2) = 5
    expect(a.similar_positions).toBeDefined();
    expect(a.similar_positions[0].score).toBe(5);
  });

  it('awards +3 for ASA when ratio is exactly 1.25 (upper boundary)', () => {
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: null });
    const b = makePos({ id: '2', vh_id: 2, asa: 125, state: 'VA', position_type: null });
    findSimilar([a, b]);
    // ASA(3) + state(2) = 5
    expect(a.similar_positions[0].score).toBe(5);
  });

  it('does not award ASA points when ratio exceeds 1.25', () => {
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: null });
    const b = makePos({ id: '2', vh_id: 2, asa: 130, state: 'VA', position_type: null });
    // 130/100 = 1.30 > 1.25, no ASA bonus; state(2) only = 2, below threshold
    findSimilar([a, b]);
    // score=2 < 3, so no similar_positions
    expect(a.similar_positions).toBeUndefined();
  });

  it('does not award ASA points when ratio is below 0.75', () => {
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: null });
    const b = makePos({ id: '2', vh_id: 2, asa: 74, state: 'VA', position_type: null });
    // 74/100 = 0.74 < 0.75, no ASA bonus; state(2) = 2 < 3, excluded
    findSimilar([a, b]);
    expect(a.similar_positions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findSimilar -- scoring: comp ±20% adds 2 points
// ---------------------------------------------------------------------------

describe('findSimilar -- scoring: comp within ±20% adds 2 points', () => {
  it('awards +2 when comp is within 20%', () => {
    // Use comp + state + position_type for a clean score: comp(2)+state(2)+type(2)=6
    const a = makePos({ id: '1', comp: 80000, state: 'VA', position_type: 'Rector' });
    const b = makePos({ id: '2', vh_id: 2, comp: 88000, state: 'VA', position_type: 'Rector' });
    findSimilar([a, b]);
    // comp(2) + state(2) + position_type(2) = 6
    expect(a.similar_positions).toBeDefined();
    expect(a.similar_positions[0].score).toBe(6);
  });

  it('awards comp points at exact 0.8 lower boundary', () => {
    const a = makePos({ id: '1', comp: 100000, state: 'VA', position_type: 'Rector' });
    const b = makePos({ id: '2', vh_id: 2, comp: 80000, state: 'VA', position_type: 'Rector' });
    findSimilar([a, b]);
    // comp(2) + state(2) + position_type(2) = 6
    expect(a.similar_positions[0].score).toBe(6);
  });

  it('does not award comp points when ratio exceeds 1.2', () => {
    const a = makePos({ id: '1', comp: 80000, state: 'VA', position_type: 'Rector' });
    const b = makePos({ id: '2', vh_id: 2, comp: 100000, state: 'VA', position_type: 'Rector' });
    // 100000/80000 = 1.25 > 1.2, no comp bonus
    // state(2) + position_type(2) = 4
    findSimilar([a, b]);
    expect(a.similar_positions[0].score).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// findSimilar -- scoring: same state adds 2 points
// ---------------------------------------------------------------------------

describe('findSimilar -- scoring: same state adds 2 points', () => {
  it('awards +2 for same state', () => {
    // ASA only + same state: ASA(3) + state(2) = 5, no type (null)
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: null });
    const b = makePos({ id: '2', vh_id: 2, asa: 105, state: 'VA', position_type: null });
    findSimilar([a, b]);
    expect(a.similar_positions[0].score).toBe(5);
  });

  it('awards only +3 (ASA) for different states (no state bonus)', () => {
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: null });
    const b = makePos({ id: '2', vh_id: 2, asa: 105, state: 'CT', position_type: null });
    findSimilar([a, b]);
    // ASA(3) only = 3
    expect(a.similar_positions[0].score).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// findSimilar -- scoring: same position_type adds 2 points
// ---------------------------------------------------------------------------

describe('findSimilar -- scoring: same position_type adds 2 points', () => {
  it('awards +2 for same position_type', () => {
    // ASA + position_type, different states: ASA(3) + type(2) = 5
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: 'Rector' });
    const b = makePos({ id: '2', vh_id: 2, asa: 105, state: 'CT', position_type: 'Rector' });
    findSimilar([a, b]);
    expect(a.similar_positions[0].score).toBe(5);
  });

  it('does not award type points for different position types', () => {
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: 'Rector' });
    const b = makePos({ id: '2', vh_id: 2, asa: 105, state: 'CT', position_type: 'Curate' });
    findSimilar([a, b]);
    // ASA(3) only = 3
    expect(a.similar_positions[0].score).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// findSimilar -- scoring: same housing_type adds 1 point
// ---------------------------------------------------------------------------

describe('findSimilar -- scoring: same housing_type adds 1 point', () => {
  it('awards +1 for same housing_type', () => {
    // ASA + housing only: ASA(3) + housing(1) = 4; different state and type
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: null, housing_type: 'Rectory' });
    const b = makePos({ id: '2', vh_id: 2, asa: 105, state: 'CT', position_type: null, housing_type: 'Rectory' });
    findSimilar([a, b]);
    expect(a.similar_positions[0].score).toBe(4);
  });

  it('compares housing_type case-insensitively', () => {
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: null, housing_type: 'Rectory' });
    const b = makePos({ id: '2', vh_id: 2, asa: 105, state: 'CT', position_type: null, housing_type: 'RECTORY' });
    findSimilar([a, b]);
    // ASA(3) + housing(1) = 4
    expect(a.similar_positions[0].score).toBe(4);
  });

  it('does not award housing points for different housing types', () => {
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: null, housing_type: 'Rectory' });
    const b = makePos({ id: '2', vh_id: 2, asa: 105, state: 'CT', position_type: null, housing_type: 'Allowance' });
    findSimilar([a, b]);
    // ASA(3) only = 3
    expect(a.similar_positions[0].score).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// findSimilar -- minimum score threshold
// ---------------------------------------------------------------------------

describe('findSimilar -- minimum score threshold of 3', () => {
  it('excludes a candidate with score < 3', () => {
    // Only matching criterion is housing_type (score 1); all others differ
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: 'Rector', housing_type: 'Rectory' });
    const b = makePos({ id: '2', vh_id: 2, asa: 200, state: 'CT', position_type: 'Curate', housing_type: 'Rectory' });
    // 200/100 = 2.0 -- no ASA; different state, type; housing(1) = 1 < 3
    findSimilar([a, b]);
    expect(a.similar_positions).toBeUndefined();
  });

  it('includes a candidate with score exactly 3', () => {
    // Only ASA matches: ASA(3) = 3 >= 3
    const a = makePos({ id: '1', asa: 100, state: 'VA', position_type: null });
    const b = makePos({ id: '2', vh_id: 2, asa: 105, state: 'CT', position_type: null });
    findSimilar([a, b]);
    expect(a.similar_positions).toBeDefined();
    expect(a.similar_positions[0].score).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// findSimilar -- capped at top SIMILAR_MAX_RESULTS (15)
// ---------------------------------------------------------------------------

describe('findSimilar -- top-15 cap', () => {
  it('returns at most 15 similar positions', () => {
    // One source position and 20 highly similar candidates
    const positions = [
      makePos({ id: '0', vh_id: 0, asa: 100, state: 'VA', position_type: null }),
    ];
    for (let k = 1; k <= 20; k++) {
      positions.push(makePos({ id: String(k), vh_id: k, asa: 100, state: 'VA', position_type: null }));
    }
    findSimilar(positions);
    expect(positions[0].similar_positions).toBeDefined();
    expect(positions[0].similar_positions.length).toBeLessThanOrEqual(15);
  });

  it('sorts by score descending before slicing', () => {
    const a = makePos({ id: '0', vh_id: 0, asa: 100, comp: 80000,
      state: 'VA', position_type: 'Rector', housing_type: 'Rectory' });

    // b: matches ASA, comp, state, type, housing => max score
    const b = makePos({ id: '1', vh_id: 1, asa: 105, comp: 82000,
      state: 'VA', position_type: 'Rector', housing_type: 'Rectory' });

    // c: matches ASA and state only (comp too far, different type, no housing)
    const c = makePos({ id: '2', vh_id: 2, asa: 105, comp: 200000,
      state: 'VA', position_type: 'Curate', housing_type: 'Allowance' });

    findSimilar([a, b, c]);
    // b should be ranked first (higher score)
    expect(a.similar_positions[0].id).toBe('1');
    expect(a.similar_positions[0].score).toBeGreaterThan(a.similar_positions[1].score);
  });
});

// ---------------------------------------------------------------------------
// findSimilar -- skips positions with no ASA and no comp
// ---------------------------------------------------------------------------

describe('findSimilar -- skips ineligible positions', () => {
  it('does not assign similar_positions to a position with neither ASA nor comp', () => {
    const a = makePos({ id: '1', asa: 100, state: 'VA' });
    // b has no asa and no comp -- it is not added to posData
    const b = { id: '2', vh_id: 2, position_type: 'Rector',
      church_infos: [{ state: 'VA' }] };
    findSimilar([a, b]);
    // b excluded from candidate pool, so a has no peers
    expect(a.similar_positions).toBeUndefined();
    expect(b.similar_positions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findSimilar -- state and name resolution
// ---------------------------------------------------------------------------

describe('findSimilar -- field resolution', () => {
  it('falls back to pos.state when church_infos is absent', () => {
    const a = makePos({ id: '1', asa: 100, position_type: 'Rector', state: 'VA' });
    delete a.church_infos;
    a.state = 'VA';

    const b = makePos({ id: '2', vh_id: 2, asa: 105, position_type: 'Rector', state: 'VA' });
    delete b.church_infos;
    b.state = 'VA';

    findSimilar([a, b]);
    expect(a.similar_positions).toBeDefined();
    expect(a.similar_positions[0].state).toBe('VA');
  });

  it('reads name and city from church_infos[0]', () => {
    const a = makePos({ id: '1', asa: 100, state: 'VA', name: 'Ignored', city: 'Ignored' });
    const b = makePos({ id: '2', vh_id: 2, asa: 105, state: 'VA',
      name: 'Grace Church', city: 'Richmond' });
    findSimilar([a, b]);
    expect(a.similar_positions[0].name).toBe('Grace Church');
    expect(a.similar_positions[0].city).toBe('Richmond');
  });
});

// ---------------------------------------------------------------------------
// findSimilar -- return value and mutation
// ---------------------------------------------------------------------------

describe('findSimilar -- return value', () => {
  it('returns the positions array (mutates in place)', () => {
    const positions = [makePos({ id: '1', asa: 100 })];
    const result = findSimilar(positions);
    expect(result).toBe(positions);
  });

  it('returns the positions array even when nothing scored', () => {
    const positions = [makePos({ id: '1', asa: 100 })];
    const result = findSimilar(positions);
    expect(result).toBe(positions);
  });
});

// ---------------------------------------------------------------------------
// findSimilar -- empty input
// ---------------------------------------------------------------------------

describe('findSimilar -- empty input', () => {
  it('handles an empty positions array without throwing', () => {
    expect(() => findSimilar([])).not.toThrow();
    expect(findSimilar([])).toEqual([]);
  });
});
