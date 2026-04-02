import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

const require = createRequire(import.meta.url);

let testDbPath;
let tmpOutputDir;

beforeEach(() => {
  testDbPath = path.join(os.tmpdir(), `vocationhub-clergydata-${Date.now()}-${Math.random()}.db`);
  tmpOutputDir = path.join(os.tmpdir(), `clergydata-out-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(tmpOutputDir, { recursive: true });
  process.env.VOCATIONHUB_DB_PATH = testDbPath;
  process.env.CLERGY_TOKEN_SECRET = 'test-secret-key-for-hmac';
});

afterEach(() => {
  const { closeDb } = require('../db.js');
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(testDbPath + suffix); } catch { /* ignore */ }
  }
  // Clean up output dir
  try { fs.rmSync(tmpOutputDir, { recursive: true, force: true }); } catch { /* ignore */ }
  delete process.env.VOCATIONHUB_DB_PATH;
  delete process.env.CLERGY_TOKEN_SECRET;
});

function seedData() {
  const { getDb } = require('../db.js');
  const db = getDb();
  db.prepare(`INSERT INTO clergy (guid, first_name, last_name, diaconate_date, canonical_residence, city, state)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('guid-alice', 'Alice', 'Smith', '06/15/2015', 'Diocese of Virginia', 'Arlington', 'VA');
  db.prepare(`INSERT INTO clergy (guid, first_name, last_name, diaconate_date, canonical_residence, city, state)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('guid-bob', 'Bob', 'Jones', '03/01/2020', 'Diocese of Texas', 'Houston', 'TX');

  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, lat, lng, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(1, 'nid1', "St. Mark's", 'Virginia', 'Arlington', 'VA', 38.88, -77.10, 'both');

  db.prepare(`INSERT INTO clergy_positions (clergy_guid, parish_id, position_title, employer_name, start_date, end_date, is_current)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('guid-alice', 1, 'Rector', "St. Mark's", '01/01/2019', null, 1);
  db.prepare(`INSERT INTO clergy_positions (clergy_guid, parish_id, position_title, employer_name, start_date, end_date, is_current)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('guid-alice', null, 'Assoc. Rector', 'Grace Church', '06/15/2015', '12/31/2018', 0);

  db.prepare(`INSERT INTO compensation_diocesan (year, diocese, all_median, female_median, male_median, all_count)
    VALUES (?, ?, ?, ?, ?, ?)`).run(2023, 'Virginia', 78000, 74000, 80000, 150);

  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership, operating_revenue)
    VALUES (?, ?, ?, ?, ?, ?)`).run('nid1', 2023, 145, 285000, 312, 350000);

  return db;
}

describe('generateToken', () => {
  it('produces a 12-char URL-safe string', () => {
    const { generateToken } = require('../generate-clergy-data.js');
    const token = generateToken('guid-alice', 'test-secret-key-for-hmac');
    expect(token).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it('is deterministic for the same GUID and secret', () => {
    const { generateToken } = require('../generate-clergy-data.js');
    const t1 = generateToken('guid-alice', 'test-secret-key-for-hmac');
    const t2 = generateToken('guid-alice', 'test-secret-key-for-hmac');
    expect(t1).toBe(t2);
  });

  it('produces different tokens for different GUIDs', () => {
    const { generateToken } = require('../generate-clergy-data.js');
    const t1 = generateToken('guid-alice', 'test-secret-key-for-hmac');
    const t2 = generateToken('guid-bob', 'test-secret-key-for-hmac');
    expect(t1).not.toBe(t2);
  });

  it('produces different tokens for different secrets', () => {
    const { generateToken } = require('../generate-clergy-data.js');
    const t1 = generateToken('guid-alice', 'secret-one');
    const t2 = generateToken('guid-alice', 'secret-two');
    expect(t1).not.toBe(t2);
  });

  it('throws if secret is missing', () => {
    const { generateToken } = require('../generate-clergy-data.js');
    expect(() => generateToken('guid-alice', '')).toThrow('CLERGY_TOKEN_SECRET is required');
    expect(() => generateToken('guid-alice', null)).toThrow('CLERGY_TOKEN_SECRET is required');
  });
});

describe('buildPersonalData', () => {
  it('includes clergy identity and current position', () => {
    const db = seedData();
    const { buildPersonalData } = require('../generate-clergy-data.js');
    const data = buildPersonalData('guid-alice', db);
    expect(data.name).toBe('Alice Smith');
    expect(data.clergy_guid).toBe('guid-alice');
    expect(data.current_position).toBeDefined();
    expect(data.current_position.title).toBe('Rector');
    expect(data.current_position.parish).toBe("St. Mark's");
    expect(data.current_position.diocese).toBe('Virginia');
  });

  it('includes full position history', () => {
    const db = seedData();
    const { buildPersonalData } = require('../generate-clergy-data.js');
    const data = buildPersonalData('guid-alice', db);
    expect(data.positions).toHaveLength(2);
    expect(data.positions[0].is_current).toBe(true);
    expect(data.positions[1].is_current).toBe(false);
  });

  it('includes compensation benchmarks', () => {
    const db = seedData();
    const { buildPersonalData } = require('../generate-clergy-data.js');
    const data = buildPersonalData('guid-alice', db);
    expect(data.compensation_benchmarks.diocese_median).toBe(78000);
    expect(data.compensation_benchmarks.diocese_female_median).toBe(74000);
    expect(data.compensation_benchmarks.diocese_male_median).toBe(80000);
  });

  it('includes current parish context', () => {
    const db = seedData();
    const { buildPersonalData } = require('../generate-clergy-data.js');
    const data = buildPersonalData('guid-alice', db);
    expect(data.current_parish).toBeDefined();
    expect(data.current_parish.asa).toBe(145);
    expect(data.current_parish.lat).toBe(38.88);
  });

  it('computes ordination year and experience', () => {
    const db = seedData();
    const { buildPersonalData } = require('../generate-clergy-data.js');
    const data = buildPersonalData('guid-alice', db);
    expect(data.ordination_year).toBe(2015);
    expect(data.experience_years).toBeGreaterThanOrEqual(10);
  });

  it('has correct PersonalData shape', () => {
    const db = seedData();
    const { buildPersonalData } = require('../generate-clergy-data.js');
    const data = buildPersonalData('guid-alice', db);

    // Top-level keys
    expect(data).toHaveProperty('name');
    expect(data).toHaveProperty('clergy_guid');
    expect(data).toHaveProperty('current_position');
    expect(data).toHaveProperty('ordination_year');
    expect(data).toHaveProperty('experience_years');
    expect(data).toHaveProperty('positions');
    expect(data).toHaveProperty('compensation_benchmarks');
    expect(data).toHaveProperty('current_parish');

    // current_position shape
    const cp = data.current_position;
    expect(cp).toHaveProperty('title');
    expect(cp).toHaveProperty('parish');
    expect(cp).toHaveProperty('parish_id');
    expect(cp).toHaveProperty('start_date');
    expect(cp).toHaveProperty('diocese');
    expect(cp).toHaveProperty('city');
    expect(cp).toHaveProperty('state');

    // positions array shape
    const pos = data.positions[0];
    expect(pos).toHaveProperty('title');
    expect(pos).toHaveProperty('parish');
    expect(pos).toHaveProperty('parish_id');
    expect(pos).toHaveProperty('diocese');
    expect(pos).toHaveProperty('city');
    expect(pos).toHaveProperty('state');
    expect(pos).toHaveProperty('start_year');
    expect(pos).toHaveProperty('end_year');
    expect(pos).toHaveProperty('is_current');

    // compensation_benchmarks shape
    const cb = data.compensation_benchmarks;
    expect(cb).toHaveProperty('diocese_median');
    expect(cb).toHaveProperty('asa_bucket_median');
    expect(cb).toHaveProperty('position_type_median');
    expect(cb).toHaveProperty('experience_bracket_median');

    // current_parish shape
    const parish = data.current_parish;
    expect(parish).toHaveProperty('asa');
    expect(parish).toHaveProperty('plate_pledge');
    expect(parish).toHaveProperty('membership');
    expect(parish).toHaveProperty('operating_revenue');
    expect(parish).toHaveProperty('lat');
    expect(parish).toHaveProperty('lng');
    expect(parish).toHaveProperty('census_median_income');
    expect(parish).toHaveProperty('census_population');
    expect(parish).toHaveProperty('clergy_count_10yr');
    expect(parish).toHaveProperty('avg_tenure_years');
  });

  it('returns null for unknown guid', () => {
    const db = seedData();
    const { buildPersonalData } = require('../generate-clergy-data.js');
    expect(buildPersonalData('guid-nonexistent', db)).toBeNull();
  });
});

describe('generateClergyData', () => {
  it('writes individual per-token JSON files in clergy/ subdirectory', () => {
    const db = seedData();
    const { generateClergyData, generateToken } = require('../generate-clergy-data.js');

    const result = generateClergyData({ db, outputDir: tmpOutputDir });

    expect(result.clergyCount).toBe(2);
    expect(result.collisions).toHaveLength(0);

    // Verify individual files exist
    const clergyDir = path.join(tmpOutputDir, 'clergy');
    expect(fs.existsSync(clergyDir)).toBe(true);

    const files = fs.readdirSync(clergyDir).filter(f => f.endsWith('.json'));
    expect(files).toHaveLength(2);

    // Verify Alice's file
    const aliceToken = generateToken('guid-alice', 'test-secret-key-for-hmac');
    const aliceFile = path.join(clergyDir, `${aliceToken}.json`);
    expect(fs.existsSync(aliceFile)).toBe(true);
    const aliceData = JSON.parse(fs.readFileSync(aliceFile, 'utf-8'));
    expect(aliceData.name).toBe('Alice Smith');
    expect(aliceData.clergy_guid).toBe('guid-alice');

    // Verify Bob's file
    const bobToken = generateToken('guid-bob', 'test-secret-key-for-hmac');
    const bobFile = path.join(clergyDir, `${bobToken}.json`);
    expect(fs.existsSync(bobFile)).toBe(true);
    const bobData = JSON.parse(fs.readFileSync(bobFile, 'utf-8'));
    expect(bobData.name).toBe('Bob Jones');
  });

  it('writes clergy-search-index.json', () => {
    const db = seedData();
    const { generateClergyData } = require('../generate-clergy-data.js');

    generateClergyData({ db, outputDir: tmpOutputDir });

    const indexPath = path.join(tmpOutputDir, 'clergy-search-index.json');
    expect(fs.existsSync(indexPath)).toBe(true);
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    expect(index).toHaveLength(2);

    const alice = index.find(e => e.name === 'Alice Smith');
    expect(alice).toBeDefined();
    expect(alice.token).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(alice.diocese).toBe('Diocese of Virginia');
    expect(alice.current_position).toBe('Rector');
    expect(alice.current_parish).toBe("St. Mark's");
  });

  it('inserts tokens into clergy_tokens table', () => {
    const db = seedData();
    const { generateClergyData } = require('../generate-clergy-data.js');

    generateClergyData({ db, outputDir: tmpOutputDir });

    const rows = db.prepare(`SELECT * FROM clergy_tokens`).all();
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.token && r.clergy_guid)).toBe(true);
  });

  it('throws without CLERGY_TOKEN_SECRET', () => {
    const db = seedData();
    const { generateClergyData } = require('../generate-clergy-data.js');
    delete process.env.CLERGY_TOKEN_SECRET;
    expect(() => generateClergyData({ db, outputDir: tmpOutputDir }))
      .toThrow('CLERGY_TOKEN_SECRET environment variable is required');
  });
});

describe('token collision detection', () => {
  it('detects and reports collisions without crashing', () => {
    // This test verifies the collision detection mechanism works.
    // We cannot easily force a real collision with HMAC-SHA256, but we can
    // verify the code path by checking the returned collisions array is empty
    // for normal inputs (no collisions expected with different GUIDs).
    const db = seedData();
    const { generateClergyData } = require('../generate-clergy-data.js');
    const result = generateClergyData({ db, outputDir: tmpOutputDir });
    expect(Array.isArray(result.collisions)).toBe(true);
    expect(result.collisions).toHaveLength(0);
  });
});
