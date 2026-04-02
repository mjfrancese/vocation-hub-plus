import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../../db.js');
const attachCensus = require('../../stages/attach-census.js');

let testDbPath;
let db;

function seedDB() {
  db = getDb();

  db.prepare(`INSERT INTO census_data (zip, median_income, population)
    VALUES ('10001', 65000, 21000)`).run();

  db.prepare(`INSERT INTO census_data (zip, median_income, population)
    VALUES ('90210', 120000, 35000)`).run();

  return db;
}

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `vocationhub-attach-census-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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
// attachCensus stage
// ---------------------------------------------------------------------------

describe('attachCensus stage', () => {
  it('attaches census data when church_infos[0] has a matching zip', () => {
    const positions = [
      { church_infos: [{ zip: '10001' }] },
    ];
    const result = attachCensus(positions, db);
    expect(result[0].census).toEqual({
      median_household_income: 65000,
      population: 21000,
    });
  });

  it('uses only church_infos[0] when multiple churches are present', () => {
    const positions = [
      { church_infos: [{ zip: '90210' }, { zip: '10001' }] },
    ];
    const result = attachCensus(positions, db);
    expect(result[0].census).toEqual({
      median_household_income: 120000,
      population: 35000,
    });
  });

  it('returns null when zip has no matching census row', () => {
    const positions = [
      { church_infos: [{ zip: '00000' }] },
    ];
    const result = attachCensus(positions, db);
    expect(result[0].census).toBeNull();
  });

  it('returns null when church_infos is an empty array', () => {
    const positions = [
      { church_infos: [] },
    ];
    const result = attachCensus(positions, db);
    expect(result[0].census).toBeNull();
  });

  it('returns null when church_infos is absent', () => {
    const positions = [{}];
    const result = attachCensus(positions, db);
    expect(result[0].census).toBeNull();
  });

  it('returns null when church_infos[0] has no zip field', () => {
    const positions = [
      { church_infos: [{ name: 'St. Paul\'s' }] },
    ];
    const result = attachCensus(positions, db);
    expect(result[0].census).toBeNull();
  });

  it('returns null when zip is fewer than 5 digits after stripping non-numeric chars', () => {
    const positions = [
      { church_infos: [{ zip: '123' }] },
    ];
    const result = attachCensus(positions, db);
    expect(result[0].census).toBeNull();
  });

  it('strips non-numeric characters from zip before lookup', () => {
    const positions = [
      { church_infos: [{ zip: '10001-2345' }] },
    ];
    const result = attachCensus(positions, db);
    expect(result[0].census).toEqual({
      median_household_income: 65000,
      population: 21000,
    });
  });

  it('processes multiple positions independently', () => {
    const positions = [
      { church_infos: [{ zip: '10001' }] },
      { church_infos: [{ zip: '90210' }] },
      { church_infos: [] },
    ];
    const result = attachCensus(positions, db);
    expect(result[0].census).not.toBeNull();
    expect(result[1].census).not.toBeNull();
    expect(result[2].census).toBeNull();
  });

  it('returns the positions array (mutates in place and returns)', () => {
    const positions = [{ church_infos: [] }];
    const result = attachCensus(positions, db);
    expect(result).toBe(positions);
  });
});
