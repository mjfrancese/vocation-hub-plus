import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../../db.js');
const attachClergyContext = require('../../stages/clergy-context.js');
const { attachClergyInfo, computeParishContext } = attachClergyContext;

let testDbPath;
let db;

const CURRENT_YEAR = new Date().getFullYear();

function seedDB() {
  db = getDb();

  // Parishes
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (1, '1001', 'St. Paul''s', 'Diocese of Virginia', 'Alexandria', 'VA', 'both')`).run();

  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (2, '1002', 'Grace Church', 'Diocese of Virginia', 'Richmond', 'VA', 'both')`).run();

  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (3, '1003', 'Trinity Church', 'Diocese of Connecticut', 'Hartford', 'CT', 'both')`).run();

  // Clergy
  db.prepare(`INSERT INTO clergy (guid, first_name, last_name)
    VALUES ('clergy-001', 'Jane', 'Smith')`).run();

  db.prepare(`INSERT INTO clergy (guid, first_name, last_name)
    VALUES ('clergy-002', 'John', 'Doe')`).run();

  db.prepare(`INSERT INTO clergy (guid, first_name, last_name)
    VALUES ('clergy-003', 'Mary', 'Jones')`).run();

  // Current assignment at parish 1: Jane Smith, started 2020
  db.prepare(`INSERT INTO clergy_positions
    (clergy_guid, parish_id, position_title, start_date, end_date, is_current)
    VALUES ('clergy-001', 1, 'Rector', '01/01/2020', NULL, 1)`).run();

  // Past assignment at parish 1: John Doe, 2015-2019 (ended within 10 years)
  db.prepare(`INSERT INTO clergy_positions
    (clergy_guid, parish_id, position_title, start_date, end_date, is_current)
    VALUES ('clergy-002', 1, 'Rector', '01/01/2015', '12/31/2019', 0)`).run();

  // Current assignment at parish 2: Mary Jones, started 2018
  db.prepare(`INSERT INTO clergy_positions
    (clergy_guid, parish_id, position_title, start_date, end_date, is_current)
    VALUES ('clergy-003', 2, 'Vicar', '01/01/2018', NULL, 1)`).run();

  // Parochial data for parish 1 (growing attendance, declining giving)
  db.prepare(`INSERT INTO parochial_data
    (parish_nid, year, average_attendance, plate_and_pledge, membership, operating_revenue)
    VALUES ('1001', 2018, 100, 200000.0, 150, 250000.0)`).run();

  db.prepare(`INSERT INTO parochial_data
    (parish_nid, year, average_attendance, plate_and_pledge, membership, operating_revenue)
    VALUES ('1001', 2023, 120, 180000.0, 155, 280000.0)`).run();

  return db;
}

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `vocationhub-clergy-context-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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
// attachClergyInfo helper
// ---------------------------------------------------------------------------

describe('attachClergyInfo', () => {
  it('returns current clergy for a parish with an active assignment', () => {
    const result = attachClergyInfo(1, db);
    expect(result.current_clergy).not.toBeNull();
    expect(result.current_clergy.name).toBe('Jane Smith');
    expect(result.current_clergy.position_title).toBe('Rector');
    expect(result.current_clergy.start_date).toBe('01/01/2020');
  });

  it('computes years_tenure from MM/DD/YYYY start date', () => {
    const result = attachClergyInfo(1, db);
    const expectedTenure = CURRENT_YEAR - 2020;
    expect(result.current_clergy.years_tenure).toBe(expectedTenure);
  });

  it('computes years_tenure from YYYY-only start date', () => {
    db.prepare(`INSERT INTO clergy (guid, first_name, last_name)
      VALUES ('clergy-004', 'Alex', 'Brown')`).run();
    db.prepare(`INSERT INTO clergy_positions
      (clergy_guid, parish_id, position_title, start_date, end_date, is_current)
      VALUES ('clergy-004', 3, 'Rector', '2019', NULL, 1)`).run();

    const result = attachClergyInfo(3, db);
    expect(result.current_clergy).not.toBeNull();
    expect(result.current_clergy.years_tenure).toBe(CURRENT_YEAR - 2019);
  });

  it('returns current_clergy null when no is_current=1 assignment exists', () => {
    const result = attachClergyInfo(3, db);
    expect(result.current_clergy).toBeNull();
  });

  it('returns parish_clergy_history with recent_count and avg_tenure_years', () => {
    const result = attachClergyInfo(1, db);
    // Two positions at parish 1: one current (2020-now), one past (2015-2019, ended within 10yr)
    expect(result.parish_clergy_history.recent_count).toBe(2);
    expect(typeof result.parish_clergy_history.avg_tenure_years).toBe('number');
  });

  it('returns recent_count 0 and avg_tenure_years 0 when no positions exist', () => {
    const result = attachClergyInfo(3, db);
    expect(result.parish_clergy_history.recent_count).toBe(0);
    expect(result.parish_clergy_history.avg_tenure_years).toBe(0);
  });

  it('returns avg_tenure_years rounded to one decimal place', () => {
    const result = attachClergyInfo(1, db);
    const str = String(result.parish_clergy_history.avg_tenure_years);
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(1);
  });

  it('years_tenure is never negative', () => {
    // Insert a position with a future start date
    db.prepare(`INSERT INTO clergy (guid, first_name, last_name)
      VALUES ('clergy-005', 'Future', 'Clergy')`).run();
    db.prepare(`INSERT INTO clergy_positions
      (clergy_guid, parish_id, position_title, start_date, end_date, is_current)
      VALUES ('clergy-005', 3, 'Deacon', '01/01/2099', NULL, 1)`).run();

    const result = attachClergyInfo(3, db);
    expect(result.current_clergy.years_tenure).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// computeParishContext helper
// ---------------------------------------------------------------------------

describe('computeParishContext', () => {
  it('returns correct clergy_count_10yr counting recent and current clergy', () => {
    const result = computeParishContext(1, db);
    // Both positions at parish 1 overlap the 10-year window
    expect(result.clergy_count_10yr).toBe(2);
  });

  it('returns current_clergy_count reflecting is_current=1 rows', () => {
    const result = computeParishContext(1, db);
    expect(result.current_clergy_count).toBe(1);
  });

  it('returns avg_tenure_years rounded to one decimal, or null when no data', () => {
    const result = computeParishContext(1, db);
    expect(result.avg_tenure_years).not.toBeNull();
    const str = String(result.avg_tenure_years);
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(1);
  });

  it('returns avg_tenure_years null when no recent clergy', () => {
    const result = computeParishContext(3, db);
    expect(result.avg_tenure_years).toBeNull();
  });

  it('computes growing attendance trend when attendance increased >5%', () => {
    // Parish 1: 100 -> 120 = +20%
    const result = computeParishContext(1, db);
    expect(result.attendance_trend).toBe('growing');
    expect(result.attendance_change_pct).toBe(20);
  });

  it('computes declining giving trend when giving decreased >5%', () => {
    // Parish 1: 200000 -> 180000 = -10%
    const result = computeParishContext(1, db);
    expect(result.giving_trend).toBe('declining');
    expect(result.giving_change_pct).toBe(-10);
  });

  it('computes stable membership trend when change is within +/-5%', () => {
    // Parish 1: 150 -> 155 = +3.3%
    const result = computeParishContext(1, db);
    expect(result.membership_trend).toBe('stable');
  });

  it('sets latest_operating_revenue from most recent parochial row', () => {
    const result = computeParishContext(1, db);
    expect(result.latest_operating_revenue).toBe(280000.0);
  });

  it('sets years_of_data to the number of parochial rows', () => {
    const result = computeParishContext(1, db);
    expect(result.years_of_data).toBe(2);
  });

  it('returns null trends and zero years_of_data when no parochial data exists', () => {
    // Parish 2 has no parochial data
    const result = computeParishContext(2, db);
    expect(result.attendance_trend).toBeNull();
    expect(result.giving_trend).toBeNull();
    expect(result.membership_trend).toBeNull();
    expect(result.years_of_data).toBe(0);
  });

  it('returns latest_operating_revenue when only one parochial row exists', () => {
    db.prepare(`INSERT INTO parochial_data
      (parish_nid, year, average_attendance, plate_and_pledge, membership, operating_revenue)
      VALUES ('1002', 2023, 50, 100000.0, 80, 120000.0)`).run();

    const result = computeParishContext(2, db);
    expect(result.latest_operating_revenue).toBe(120000.0);
    expect(result.attendance_trend).toBeNull(); // only one row, no trend
  });

  it('does not count clergy outside the 10-year window', () => {
    // Add a very old past position at parish 3
    db.prepare(`INSERT INTO clergy (guid, first_name, last_name)
      VALUES ('clergy-old', 'Old', 'Rector')`).run();
    db.prepare(`INSERT INTO clergy_positions
      (clergy_guid, parish_id, start_date, end_date, is_current)
      VALUES ('clergy-old', 3, '01/01/1990', '12/31/1999', 0)`).run();

    const result = computeParishContext(3, db);
    expect(result.clergy_count_10yr).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// attachClergyContext stage
// ---------------------------------------------------------------------------

describe('attachClergyContext stage', () => {
  it('attaches clergy and parish_contexts for a position with a matched parish', () => {
    const positions = [
      { church_infos: [{ id: 1, nid: '1001', name: "St. Paul's", city: 'Alexandria' }] },
    ];
    const result = attachClergyContext(positions, db);
    expect(result[0].clergy).not.toBeNull();
    expect(result[0].clergy.current_clergy.name).toBe('Jane Smith');
    expect(result[0].parish_contexts).toHaveLength(1);
  });

  it('sets clergy null and empty parish_contexts for a position with no church_infos', () => {
    const positions = [{ church_infos: [] }];
    const result = attachClergyContext(positions, db);
    expect(result[0].clergy).toBeNull();
    expect(result[0].parish_contexts).toEqual([]);
  });

  it('sets clergy null and empty parish_contexts when church_infos is absent', () => {
    const positions = [{}];
    const result = attachClergyContext(positions, db);
    expect(result[0].clergy).toBeNull();
    expect(result[0].parish_contexts).toEqual([]);
  });

  it('sets clergy null when church_infos entries have no id field', () => {
    const positions = [
      { church_infos: [{ name: "St. Paul's", city: 'Alexandria' }] },
    ];
    const result = attachClergyContext(positions, db);
    expect(result[0].clergy).toBeNull();
    expect(result[0].parish_contexts).toEqual([]);
  });

  it('uses the first church_info with an id for the clergy field', () => {
    // church_infos[0] has no id; church_infos[1] maps to parish 2 (Mary Jones)
    const positions = [
      {
        church_infos: [
          { name: 'No Id Church' },
          { id: 2, nid: '1002', name: 'Grace Church', city: 'Richmond' },
        ],
      },
    ];
    const result = attachClergyContext(positions, db);
    expect(result[0].clergy.current_clergy.name).toBe('Mary Jones');
  });

  it('produces one parish_contexts entry per church_info with an id', () => {
    const positions = [
      {
        church_infos: [
          { id: 1, nid: '1001', name: "St. Paul's", city: 'Alexandria' },
          { id: 2, nid: '1002', name: 'Grace Church', city: 'Richmond' },
        ],
      },
    ];
    const result = attachClergyContext(positions, db);
    expect(result[0].parish_contexts).toHaveLength(2);
  });

  it('skips church_info entries without an id in parish_contexts', () => {
    const positions = [
      {
        church_infos: [
          { id: 1, nid: '1001', name: "St. Paul's" },
          { name: 'No Id Church' },
        ],
      },
    ];
    const result = attachClergyContext(positions, db);
    expect(result[0].parish_contexts).toHaveLength(1);
  });

  it('processes multiple positions independently', () => {
    const positions = [
      { church_infos: [{ id: 1, nid: '1001', name: "St. Paul's" }] },
      { church_infos: [] },
      { church_infos: [{ id: 2, nid: '1002', name: 'Grace Church' }] },
    ];
    const result = attachClergyContext(positions, db);
    expect(result[0].clergy).not.toBeNull();
    expect(result[1].clergy).toBeNull();
    expect(result[2].clergy.current_clergy.name).toBe('Mary Jones');
  });

  it('returns the positions array (mutates in place and returns)', () => {
    const positions = [{ church_infos: [] }];
    const result = attachClergyContext(positions, db);
    expect(result).toBe(positions);
  });

  it('parish_contexts entries contain all expected keys', () => {
    const positions = [
      { church_infos: [{ id: 1, nid: '1001', name: "St. Paul's" }] },
    ];
    const result = attachClergyContext(positions, db);
    const ctx = result[0].parish_contexts[0];
    expect(ctx).toHaveProperty('clergy_count_10yr');
    expect(ctx).toHaveProperty('avg_tenure_years');
    expect(ctx).toHaveProperty('current_clergy_count');
    expect(ctx).toHaveProperty('attendance_trend');
    expect(ctx).toHaveProperty('attendance_change_pct');
    expect(ctx).toHaveProperty('giving_trend');
    expect(ctx).toHaveProperty('giving_change_pct');
    expect(ctx).toHaveProperty('membership_trend');
    expect(ctx).toHaveProperty('membership_change_pct');
    expect(ctx).toHaveProperty('latest_operating_revenue');
    expect(ctx).toHaveProperty('years_of_data');
  });
});
