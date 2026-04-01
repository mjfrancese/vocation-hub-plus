import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

const require = createRequire(import.meta.url);

let testDbPath;

beforeEach(() => {
  testDbPath = path.join(os.tmpdir(), `vocationhub-tokens-${Date.now()}-${Math.random()}.db`);
  process.env.VOCATIONHUB_DB_PATH = testDbPath;
  process.env.CLERGY_TOKEN_SECRET = 'test-secret-key-for-hmac';
});

afterEach(() => {
  const { closeDb } = require('../db.js');
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(testDbPath + suffix); } catch { /* ignore */ }
  }
  delete process.env.VOCATIONHUB_DB_PATH;
  delete process.env.CLERGY_TOKEN_SECRET;
});

function seedData() {
  const { getDb } = require('../db.js');
  const db = getDb();
  // Two clergy with positions and compensation data
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
}

describe('generateToken', () => {
  it('produces a 12-char URL-safe string', () => {
    const { generateToken } = require('../generate-clergy-tokens.js');
    const token = generateToken('guid-alice');
    expect(token).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it('is deterministic for the same GUID and secret', () => {
    const { generateToken } = require('../generate-clergy-tokens.js');
    const t1 = generateToken('guid-alice');
    const t2 = generateToken('guid-alice');
    expect(t1).toBe(t2);
  });

  it('produces different tokens for different GUIDs', () => {
    const { generateToken } = require('../generate-clergy-tokens.js');
    const t1 = generateToken('guid-alice');
    const t2 = generateToken('guid-bob');
    expect(t1).not.toBe(t2);
  });
});

describe('buildPersonalData', () => {
  it('includes clergy identity and current position', () => {
    seedData();
    const { buildPersonalData } = require('../generate-clergy-tokens.js');
    const data = buildPersonalData('guid-alice');
    expect(data.name).toBe('Alice Smith');
    expect(data.clergy_guid).toBe('guid-alice');
    expect(data.current_position).toBeDefined();
    expect(data.current_position.title).toBe('Rector');
    expect(data.current_position.parish).toBe("St. Mark's");
    expect(data.current_position.diocese).toBe('Virginia');
  });

  it('includes full position history', () => {
    seedData();
    const { buildPersonalData } = require('../generate-clergy-tokens.js');
    const data = buildPersonalData('guid-alice');
    expect(data.positions).toHaveLength(2);
    expect(data.positions[0].is_current).toBe(true);
    expect(data.positions[1].is_current).toBe(false);
  });

  it('includes compensation benchmarks', () => {
    seedData();
    const { buildPersonalData } = require('../generate-clergy-tokens.js');
    const data = buildPersonalData('guid-alice');
    expect(data.compensation_benchmarks.diocese_median).toBe(78000);
    expect(data.compensation_benchmarks.diocese_female_median).toBe(74000);
    expect(data.compensation_benchmarks.diocese_male_median).toBe(80000);
  });

  it('includes current parish context', () => {
    seedData();
    const { buildPersonalData } = require('../generate-clergy-tokens.js');
    const data = buildPersonalData('guid-alice');
    expect(data.current_parish).toBeDefined();
    expect(data.current_parish.asa).toBe(145);
    expect(data.current_parish.lat).toBe(38.88);
  });

  it('computes ordination year and experience', () => {
    seedData();
    const { buildPersonalData } = require('../generate-clergy-tokens.js');
    const data = buildPersonalData('guid-alice');
    expect(data.ordination_year).toBe(2015);
    expect(data.experience_years).toBeGreaterThanOrEqual(10);
  });
});

describe('buildSearchIndex', () => {
  it('returns lightweight entries for the claim page', () => {
    seedData();
    const { buildSearchIndex } = require('../generate-clergy-tokens.js');
    const entries = buildSearchIndex();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const alice = entries.find(e => e.name === 'Alice Smith');
    expect(alice).toBeDefined();
    expect(alice.token).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(alice.diocese).toBe('Diocese of Virginia');
    expect(alice.current_position).toBe('Rector');
    expect(alice.current_parish).toBe("St. Mark's");
  });
});

describe('generateAllTokens', () => {
  it('writes clergy-tokens.json and clergy-search-index.json', () => {
    seedData();
    const { generateAllTokens } = require('../generate-clergy-tokens.js');
    const DATA_DIR = path.resolve(__dirname, '../../public/data');
    const tokensPath = path.join(DATA_DIR, 'clergy-tokens.json');
    const indexPath = path.join(DATA_DIR, 'clergy-search-index.json');

    // Clean up if exists
    try { fs.unlinkSync(tokensPath); } catch { /* ignore */ }
    try { fs.unlinkSync(indexPath); } catch { /* ignore */ }

    generateAllTokens();

    expect(fs.existsSync(tokensPath)).toBe(true);
    expect(fs.existsSync(indexPath)).toBe(true);

    const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

    expect(Object.keys(tokens).length).toBe(2);
    expect(index.length).toBe(2);

    // Clean up
    fs.unlinkSync(tokensPath);
    fs.unlinkSync(indexPath);
  });
});
