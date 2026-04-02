import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../../db.js');
const attachParochial = require('../../stages/attach-parochial.js');
const { lookupParochial } = attachParochial;

let testDbPath;
let db;

function seedDB() {
  db = getDb();

  // Parishes (needed for FK if enforced, but parochial_data uses parish_nid as text key)
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (1, '1001', 'St. Paul''s', 'Diocese of Virginia', 'Alexandria', 'VA', 'both')`).run();

  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (2, '1002', 'Grace Church', 'Diocese of Virginia', 'Richmond', 'VA', 'both')`).run();

  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (3, '1003', 'Trinity Church', 'Diocese of Connecticut', 'Hartford', 'CT', 'both')`).run();

  // Parochial data -- keyed by name+city string (as stored in parochial_data.parish_nid)
  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership, operating_revenue)
    VALUES ('St. Paul''s (Alexandria)', 2022, 120, 250000.0, 200, 310000.0)`).run();
  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership, operating_revenue)
    VALUES ('St. Paul''s (Alexandria)', 2023, 130, 270000.0, 210, 330000.0)`).run();

  // Parochial data keyed by NID for Grace Church (to test NID fallback)
  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership, operating_revenue)
    VALUES ('1002', 2023, 80, 180000.0, 150, 220000.0)`).run();

  return db;
}

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `vocationhub-attach-parochial-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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
// lookupParochial helper
// ---------------------------------------------------------------------------

describe('lookupParochial', () => {
  it('returns null for a key with no matching rows', () => {
    expect(lookupParochial(db, 'Nonexistent Church')).toBeNull();
  });

  it('returns null for a null or empty key', () => {
    expect(lookupParochial(db, null)).toBeNull();
    expect(lookupParochial(db, '')).toBeNull();
  });

  it('returns years object for a name+city key', () => {
    const result = lookupParochial(db, "St. Paul's (Alexandria)");
    expect(result).not.toBeNull();
    expect(result.years).toBeDefined();
    expect(Object.keys(result.years).sort()).toEqual(['2022', '2023']);
  });

  it('maps DB columns to camelCase fields', () => {
    const result = lookupParochial(db, "St. Paul's (Alexandria)");
    const yr = result.years['2022'];
    expect(yr.averageAttendance).toBe(120);
    expect(yr.plateAndPledge).toBe(250000.0);
    expect(yr.membership).toBe(200);
    expect(yr.operatingRevenue).toBe(310000.0);
  });

  it('returns data keyed by NID when stored that way', () => {
    const result = lookupParochial(db, '1002');
    expect(result).not.toBeNull();
    expect(result.years['2023'].averageAttendance).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// attachParochial stage
// ---------------------------------------------------------------------------

describe('attachParochial stage', () => {
  it('attaches parochial data for a matched parish (name+city key)', () => {
    const positions = [
      {
        church_infos: [{ nid: '1001', name: "St. Paul's", city: 'Alexandria' }],
      },
    ];
    const result = attachParochial(positions, db);
    expect(result[0].parochials).toHaveLength(1);
    expect(Object.keys(result[0].parochials[0].years).sort()).toEqual(['2022', '2023']);
  });

  it('groups multiple years correctly under a single entry', () => {
    const positions = [
      {
        church_infos: [{ nid: '1001', name: "St. Paul's", city: 'Alexandria' }],
      },
    ];
    const result = attachParochial(positions, db);
    const yr2023 = result[0].parochials[0].years['2023'];
    expect(yr2023.averageAttendance).toBe(130);
    expect(yr2023.plateAndPledge).toBe(270000.0);
    expect(yr2023.membership).toBe(210);
    expect(yr2023.operatingRevenue).toBe(330000.0);
  });

  it('falls back to NID lookup when name-based lookup finds nothing', () => {
    // Grace Church has no name-based parochial row, only a NID-based one
    const positions = [
      {
        church_infos: [{ nid: '1002', name: 'Grace Church', city: 'Richmond' }],
      },
    ];
    const result = attachParochial(positions, db);
    expect(result[0].parochials).toHaveLength(1);
    expect(result[0].parochials[0].years['2023'].averageAttendance).toBe(80);
  });

  it('sets empty parochials array for a position with no matched parishes', () => {
    const positions = [
      {
        church_infos: [],
      },
    ];
    const result = attachParochial(positions, db);
    expect(result[0].parochials).toEqual([]);
  });

  it('sets empty parochials array when church_infos is absent', () => {
    const positions = [{}];
    const result = attachParochial(positions, db);
    expect(result[0].parochials).toEqual([]);
  });

  it('sets empty parochials for a parish with no parochial data at all', () => {
    const positions = [
      {
        church_infos: [{ nid: '1003', name: 'Trinity Church', city: 'Hartford' }],
      },
    ];
    const result = attachParochial(positions, db);
    expect(result[0].parochials).toEqual([]);
  });

  it('produces one parochials entry per church_info for a multi-parish position', () => {
    // Insert parochial row for Trinity by NID so both churches have data
    db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership, operating_revenue)
      VALUES ('Trinity Church (Hartford)', 2023, 60, 120000.0, 100, 150000.0)`).run();

    const positions = [
      {
        church_infos: [
          { nid: '1001', name: "St. Paul's", city: 'Alexandria' },
          { nid: '1003', name: 'Trinity Church', city: 'Hartford' },
        ],
      },
    ];
    const result = attachParochial(positions, db);
    expect(result[0].parochials).toHaveLength(2);
  });

  it('skips church_info entries that have no parochial data without affecting others', () => {
    const positions = [
      {
        church_infos: [
          { nid: '1001', name: "St. Paul's", city: 'Alexandria' },
          { nid: '1003', name: 'Trinity Church', city: 'Hartford' },
        ],
      },
    ];
    // Trinity has no data, St. Paul's does
    const result = attachParochial(positions, db);
    expect(result[0].parochials).toHaveLength(1);
    expect(Object.keys(result[0].parochials[0].years)).toContain('2022');
  });

  it('returns the positions array (mutates in place and returns)', () => {
    const positions = [{ church_infos: [] }];
    const result = attachParochial(positions, db);
    expect(result).toBe(positions);
  });
});
