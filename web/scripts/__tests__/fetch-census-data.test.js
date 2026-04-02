import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const path = require('path');
const os = require('os');
const fs = require('fs');

const { getDb, closeDb } = require('../db.js');

let db, testDbPath;

beforeEach(() => {
  testDbPath = path.join(os.tmpdir(), `vocationhub-census-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.VOCATIONHUB_DB_PATH = testDbPath;
  db = getDb();
});

afterEach(() => {
  closeDb();
  delete process.env.VOCATIONHUB_DB_PATH;
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}
});

describe('collectZipCodesFromDb', () => {
  it('should collect unique zip codes from parishes table', () => {
    db.prepare(`INSERT INTO parishes (id, name, diocese, zip, source)
      VALUES (1, 'St. Paul''s', 'Massachusetts', '02134', 'asset_map')`).run();
    db.prepare(`INSERT INTO parishes (id, name, diocese, zip, source)
      VALUES (2, 'St. Mark''s', 'Massachusetts', '02134', 'asset_map')`).run();
    db.prepare(`INSERT INTO parishes (id, name, diocese, zip, source)
      VALUES (3, 'Trinity', 'New York', '10001', 'ecdplus')`).run();

    const { collectZipCodesFromDb } = require('../fetch-census-data.js');
    const zips = collectZipCodesFromDb(db);

    expect(zips).toEqual(['02134', '10001']);
  });

  it('should normalize zip codes to 5 digits', () => {
    db.prepare(`INSERT INTO parishes (id, name, diocese, zip, source)
      VALUES (1, 'St. Paul''s', 'Massachusetts', '02134-2308', 'asset_map')`).run();

    const { collectZipCodesFromDb } = require('../fetch-census-data.js');
    const zips = collectZipCodesFromDb(db);

    expect(zips).toEqual(['02134']);
  });

  it('should skip parishes with no or invalid zip', () => {
    db.prepare(`INSERT INTO parishes (id, name, diocese, source)
      VALUES (1, 'St. Paul''s', 'Massachusetts', 'asset_map')`).run();
    db.prepare(`INSERT INTO parishes (id, name, diocese, zip, source)
      VALUES (2, 'St. Mark''s', 'Massachusetts', '123', 'asset_map')`).run();

    const { collectZipCodesFromDb } = require('../fetch-census-data.js');
    const zips = collectZipCodesFromDb(db);

    expect(zips).toEqual([]);
  });
});

describe('writeCensusToDb', () => {
  it('should insert census data rows', () => {
    const { writeCensusToDb } = require('../fetch-census-data.js');
    const data = {
      '02134': { median_household_income: 75000, population: 30000 },
      '10001': { median_household_income: 95000, population: 21000 },
    };

    writeCensusToDb(db, data);

    const rows = db.prepare('SELECT * FROM census_data ORDER BY zip').all();
    expect(rows).toHaveLength(2);
    expect(rows[0].zip).toBe('02134');
    expect(rows[0].median_income).toBe(75000);
    expect(rows[0].population).toBe(30000);
    expect(rows[1].zip).toBe('10001');
    expect(rows[1].median_income).toBe(95000);
  });

  it('should update existing rows on conflict', () => {
    db.prepare(`INSERT INTO census_data (zip, median_income, population) VALUES ('02134', 50000, 20000)`).run();

    const { writeCensusToDb } = require('../fetch-census-data.js');
    writeCensusToDb(db, { '02134': { median_household_income: 75000, population: 30000 } });

    const row = db.prepare('SELECT * FROM census_data WHERE zip = ?').get('02134');
    expect(row.median_income).toBe(75000);
    expect(row.population).toBe(30000);
  });

  it('should handle partial data (income only, population only)', () => {
    const { writeCensusToDb } = require('../fetch-census-data.js');
    writeCensusToDb(db, {
      '02134': { median_household_income: 75000 },
      '10001': { population: 21000 },
    });

    const row1 = db.prepare('SELECT * FROM census_data WHERE zip = ?').get('02134');
    expect(row1.median_income).toBe(75000);
    expect(row1.population).toBeNull();

    const row2 = db.prepare('SELECT * FROM census_data WHERE zip = ?').get('10001');
    expect(row2.median_income).toBeNull();
    expect(row2.population).toBe(21000);
  });
});

describe('cleanZip', () => {
  it('should extract 5-digit zip from various formats', () => {
    const { cleanZip } = require('../fetch-census-data.js');
    expect(cleanZip('02134')).toBe('02134');
    expect(cleanZip('02134-2308')).toBe('02134');
    expect(cleanZip('  02134  ')).toBe('02134');
    expect(cleanZip(null)).toBeNull();
    expect(cleanZip('')).toBeNull();
    expect(cleanZip('123')).toBeNull();
  });
});
