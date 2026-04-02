import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../../db.js');
const computePercentiles = require('../../stages/compute-percentiles.js');
const { percentile, buildDioceseMetrics } = computePercentiles;

let testDbPath;
let db;

/**
 * Helper: build a parochials object as attach-parochial would produce it.
 */
function makeParochials(yearData) {
  const years = {};
  for (const [year, data] of Object.entries(yearData)) {
    years[String(year)] = data;
  }
  return [{ years }];
}

function seedDB() {
  db = getDb();

  // Three parishes in Diocese of Virginia
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (1, '1001', 'St. Paul''s', 'Diocese of Virginia', 'Alexandria', 'VA', 'both')`).run();
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (2, '1002', 'Grace Church', 'Diocese of Virginia', 'Richmond', 'VA', 'both')`).run();
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (3, '1003', 'All Saints', 'Diocese of Virginia', 'Arlington', 'VA', 'both')`).run();

  // One parish in Diocese of Connecticut
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (4, '2001', 'Trinity Church', 'Diocese of Connecticut', 'Hartford', 'CT', 'both')`).run();

  // One parish with no parochial data (for coverage)
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (5, '9999', 'Empty Parish', 'Diocese of Virginia', 'Roanoke', 'VA', 'both')`).run();

  // Diocese of Virginia parochial data (NID-keyed)
  // St. Paul's: two years -- only the latest (2023) should be used for diocese metrics
  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership)
    VALUES ('1001', 2022, 80, 180000.0, 150)`).run();
  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership)
    VALUES ('1001', 2023, 100, 220000.0, 180)`).run();

  // Grace Church: ASA = 60, plate = 140000, membership = 110
  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership)
    VALUES ('1002', 2023, 60, 140000.0, 110)`).run();

  // All Saints: ASA = 200, plate = 400000, membership = 320
  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership)
    VALUES ('1003', 2023, 200, 400000.0, 320)`).run();

  // Trinity (Connecticut): ASA = 50
  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership)
    VALUES ('2001', 2023, 50, 90000.0, 80)`).run();

  // A parochial_data row keyed by Name+City composite (to test the composite JOIN path)
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (6, NULL, 'St. Mark''s', 'Diocese of Virginia', 'Charlottesville', 'VA', 'both')`).run();
  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership)
    VALUES ('St. Mark''s (Charlottesville)', 2023, 75, 160000.0, 130)`).run();

  return db;
}

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `vocationhub-compute-pct-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  process.env.VOCATIONHUB_DB_PATH = testDbPath;
  seedDB();
});

afterEach(() => {
  try { closeDb(); } catch { /* ignore */ }
  try {
    const fs = require('fs');
    fs.unlinkSync(testDbPath);
  } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// percentile helper
// ---------------------------------------------------------------------------

describe('percentile', () => {
  it('returns 0 when value is the lowest in the array', () => {
    expect(percentile([10, 20, 30, 40, 50], 10)).toBe(0);
  });

  it('returns 0 when value is below all array entries', () => {
    expect(percentile([10, 20, 30], 5)).toBe(0);
  });

  it('returns 100 when value is above all array entries', () => {
    expect(percentile([10, 20, 30], 100)).toBe(100);
  });

  it('counts strictly less-than values', () => {
    // [10, 20, 30, 40, 50] -- 3 values below 40 => 3/5 = 60%
    expect(percentile([10, 20, 30, 40, 50], 40)).toBe(60);
  });

  it('rounds fractional percentiles to nearest integer', () => {
    // [10, 20, 30] -- value=25 => 2 below out of 3 => 66.67% => 67
    expect(percentile([10, 20, 30], 25)).toBe(67);
  });

  it('handles a single-element array at the value itself', () => {
    expect(percentile([50], 50)).toBe(0);
  });

  it('handles a single-element array above the value', () => {
    expect(percentile([50], 100)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// buildDioceseMetrics
// ---------------------------------------------------------------------------

describe('buildDioceseMetrics', () => {
  it('returns an object keyed by diocese name', () => {
    const metrics = buildDioceseMetrics(db);
    expect(Object.keys(metrics)).toContain('Diocese of Virginia');
    expect(Object.keys(metrics)).toContain('Diocese of Connecticut');
  });

  it('uses only the most recent year per parish', () => {
    // St. Paul's has 2022 (ASA=80) and 2023 (ASA=100); only 2023 should appear
    const metrics = buildDioceseMetrics(db);
    const dm = metrics['Diocese of Virginia'];
    // Arrays are sorted; 80 (from 2022 St. Paul's) should NOT be present
    expect(dm.asa).not.toContain(80);
    expect(dm.asa).toContain(100);
  });

  it('sorts each metric array ascending', () => {
    const metrics = buildDioceseMetrics(db);
    const dm = metrics['Diocese of Virginia'];
    const asaSorted = [...dm.asa].sort((a, b) => a - b);
    expect(dm.asa).toEqual(asaSorted);
  });

  it('resolves diocese for Name+City composite keys', () => {
    // St. Mark's (Charlottesville) is stored with a composite key
    const metrics = buildDioceseMetrics(db);
    const dm = metrics['Diocese of Virginia'];
    expect(dm.asa).toContain(75);
  });

  it('excludes null and zero metric values', () => {
    // Insert a parish with null and zero values
    db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
      VALUES (7, '3001', 'Zero Parish', 'Diocese of Virginia', 'Norfolk', 'VA', 'both')`).run();
    db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership)
      VALUES ('3001', 2023, 0, NULL, 0)`).run();

    const metrics = buildDioceseMetrics(db);
    const dm = metrics['Diocese of Virginia'];
    expect(dm.asa).not.toContain(0);
    expect(dm.platePledge).not.toContain(null);
    expect(dm.membership).not.toContain(0);
  });
});

// ---------------------------------------------------------------------------
// computePercentiles -- position with no parochial data
// ---------------------------------------------------------------------------

describe('computePercentiles -- position with no parochial data', () => {
  it('does not attach diocese_percentiles when parochials is absent', () => {
    const positions = [{ diocese: 'Diocese of Virginia' }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles).toBeUndefined();
  });

  it('does not attach diocese_percentiles when parochials is empty', () => {
    const positions = [{ diocese: 'Diocese of Virginia', parochials: [] }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles).toBeUndefined();
  });

  it('does not attach diocese_percentiles when parochials[0].years is empty', () => {
    const positions = [{
      diocese: 'Diocese of Virginia',
      parochials: [{ years: {} }],
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles).toBeUndefined();
  });

  it('does not attach diocese_percentiles when diocese is absent', () => {
    const positions = [{
      parochials: makeParochials({ 2023: { averageAttendance: 100, plateAndPledge: 200000, membership: 150 } }),
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles).toBeUndefined();
  });

  it('does not attach diocese_percentiles when diocese is unknown', () => {
    const positions = [{
      diocese: 'Diocese of Narnia',
      parochials: makeParochials({ 2023: { averageAttendance: 100, plateAndPledge: 200000, membership: 150 } }),
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computePercentiles -- percentile ranking within diocese
// ---------------------------------------------------------------------------

describe('computePercentiles -- parish ranked within diocese', () => {
  it('attaches diocese_percentiles for a position with parochial data', () => {
    // Diocese of Virginia has parishes with ASA: 60, 75, 100, 200 (sorted)
    // A position with ASA=100: 2 values below (60, 75) => 2/4 = 50%
    const positions = [{
      diocese: 'Diocese of Virginia',
      parochials: makeParochials({
        2023: { averageAttendance: 100, plateAndPledge: 220000, membership: 180 },
      }),
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles).toBeDefined();
    expect(positions[0].diocese_percentiles.asa).toBe(50);
    expect(positions[0].diocese_percentiles.asa_value).toBe(100);
  });

  it('computes plate_pledge percentile correctly', () => {
    // Diocese of Virginia plate values (sorted): 140000, 160000, 220000, 400000
    // plate=220000 => 2 below => 2/4 = 50%
    const positions = [{
      diocese: 'Diocese of Virginia',
      parochials: makeParochials({
        2023: { averageAttendance: 100, plateAndPledge: 220000, membership: 180 },
      }),
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles.plate_pledge).toBe(50);
    expect(positions[0].diocese_percentiles.plate_pledge_value).toBe(220000);
  });

  it('computes membership percentile correctly', () => {
    // Diocese of Virginia membership (sorted): 110, 130, 180, 320
    // membership=180 => 2 below => 2/4 = 50%
    const positions = [{
      diocese: 'Diocese of Virginia',
      parochials: makeParochials({
        2023: { averageAttendance: 100, plateAndPledge: 220000, membership: 180 },
      }),
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles.membership).toBe(50);
    expect(positions[0].diocese_percentiles.membership_value).toBe(180);
  });

  it('returns 0th percentile for the smallest parish in the diocese', () => {
    // ASA=60 is the smallest in Diocese of Virginia (sorted: 60, 75, 100, 200)
    const positions = [{
      diocese: 'Diocese of Virginia',
      parochials: makeParochials({
        2023: { averageAttendance: 60, plateAndPledge: 140000, membership: 110 },
      }),
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles.asa).toBe(0);
    expect(positions[0].diocese_percentiles.asa_value).toBe(60);
  });

  it('returns 100th percentile for the largest parish in the diocese', () => {
    // ASA=200 is the largest; 3 below out of 4 => 75%
    const positions = [{
      diocese: 'Diocese of Virginia',
      parochials: makeParochials({
        2023: { averageAttendance: 200, plateAndPledge: 400000, membership: 320 },
      }),
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles.asa).toBe(75);
  });

  it('uses only the most recent year from the position parochial data', () => {
    // Two years of data -- only 2023 should be used for ranking
    const positions = [{
      diocese: 'Diocese of Virginia',
      parochials: makeParochials({
        2022: { averageAttendance: 999, plateAndPledge: 999000, membership: 999 },
        2023: { averageAttendance: 60,  plateAndPledge: 140000,  membership: 110 },
      }),
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles.asa_value).toBe(60);
  });

  it('omits a metric key when the position value is null', () => {
    const positions = [{
      diocese: 'Diocese of Virginia',
      parochials: makeParochials({
        2023: { averageAttendance: 100, plateAndPledge: null, membership: 180 },
      }),
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles.asa).toBeDefined();
    expect(positions[0].diocese_percentiles.plate_pledge).toBeUndefined();
    expect(positions[0].diocese_percentiles.plate_pledge_value).toBeUndefined();
    expect(positions[0].diocese_percentiles.membership).toBeDefined();
  });

  it('omits a metric key when the position value is zero', () => {
    const positions = [{
      diocese: 'Diocese of Virginia',
      parochials: makeParochials({
        2023: { averageAttendance: 0, plateAndPledge: 220000, membership: 180 },
      }),
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles.asa).toBeUndefined();
    expect(positions[0].diocese_percentiles.plate_pledge).toBeDefined();
  });

  it('does not attach diocese_percentiles when all position metrics are null/zero', () => {
    const positions = [{
      diocese: 'Diocese of Virginia',
      parochials: makeParochials({
        2023: { averageAttendance: 0, plateAndPledge: null, membership: 0 },
      }),
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computePercentiles -- multiple parishes in diocese
// ---------------------------------------------------------------------------

describe('computePercentiles -- multiple positions across dioceses', () => {
  it('processes multiple positions independently', () => {
    const positions = [
      {
        diocese: 'Diocese of Virginia',
        parochials: makeParochials({
          2023: { averageAttendance: 60, plateAndPledge: 140000, membership: 110 },
        }),
      },
      {
        diocese: 'Diocese of Connecticut',
        parochials: makeParochials({
          2023: { averageAttendance: 50, plateAndPledge: 90000, membership: 80 },
        }),
      },
      {
        diocese: 'Diocese of Narnia',
        parochials: makeParochials({
          2023: { averageAttendance: 100, plateAndPledge: 200000, membership: 150 },
        }),
      },
    ];
    computePercentiles(positions, db);

    // Virginia position: ranked within VA diocese
    expect(positions[0].diocese_percentiles).toBeDefined();
    expect(positions[0].diocese_percentiles.asa_value).toBe(60);

    // Connecticut position: only one parish in diocese, so ranked against itself
    expect(positions[1].diocese_percentiles).toBeDefined();
    expect(positions[1].diocese_percentiles.asa).toBe(0); // only parish => 0th pctile

    // Unknown diocese: no metrics available
    expect(positions[2].diocese_percentiles).toBeUndefined();
  });

  it('returns the positions array (mutates in place)', () => {
    const positions = [{ diocese: 'Diocese of Virginia', parochials: [] }];
    const result = computePercentiles(positions, db);
    expect(result).toBe(positions);
  });
});

// ---------------------------------------------------------------------------
// computePercentiles -- single-parish diocese edge case
// ---------------------------------------------------------------------------

describe('computePercentiles -- single parish in diocese', () => {
  it('ranks the only parish at 0th percentile for all metrics', () => {
    // Diocese of Connecticut has exactly one parish (Trinity, ASA=50)
    const positions = [{
      diocese: 'Diocese of Connecticut',
      parochials: makeParochials({
        2023: { averageAttendance: 50, plateAndPledge: 90000, membership: 80 },
      }),
    }];
    computePercentiles(positions, db);
    expect(positions[0].diocese_percentiles.asa).toBe(0);
    expect(positions[0].diocese_percentiles.plate_pledge).toBe(0);
    expect(positions[0].diocese_percentiles.membership).toBe(0);
  });
});
