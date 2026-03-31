import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../db.js');
const { mergeParishes, findMatch } = require('../merge-parishes.js');

let testDbPath;

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `vocationhub-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  process.env.VOCATIONHUB_DB_PATH = testDbPath;
});

afterEach(() => {
  try {
    closeDb();
  } catch { /* ignore */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(testDbPath + suffix); } catch { /* ignore */ }
  }
  delete process.env.VOCATIONHUB_DB_PATH;
});

/**
 * Helper: seed an Asset Map parish and its alias.
 */
function seedAssetMapParish(db, { nid, name, diocese, city, state, phone, website, lat, lng }) {
  const info = db.prepare(`
    INSERT INTO parishes (nid, name, diocese, city, state, phone, website, lat, lng, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'asset_map')
  `).run(nid, name, diocese, city || null, state || null, phone || null, website || null, lat || null, lng || null);
  db.prepare(`
    INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
    VALUES (?, ?, ?, 'asset_map')
  `).run(info.lastInsertRowid, name, normalizeName(name));
  return info.lastInsertRowid;
}

/**
 * Helper: seed an ECDPlus parish and its alias.
 */
function seedEcdplusParish(db, { ecdplus_id, name, diocese, city, state, phone, website, email }) {
  const info = db.prepare(`
    INSERT INTO parishes (ecdplus_id, name, diocese, city, state, phone, website, email, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ecdplus')
  `).run(ecdplus_id, name, diocese, city || null, state || null, phone || null, website || null, email || null);
  db.prepare(`
    INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
    VALUES (?, ?, ?, 'ecdplus')
  `).run(info.lastInsertRowid, name, normalizeName(name));
  return info.lastInsertRowid;
}

/** Simple name normalizer matching what normalizeChurchName does. */
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\bsaints?\b/g, 'st')
    .replace(/\bsts\.?\s/g, 'st ')
    .replace(/\bst\.\s*/g, 'st ')
    .replace(/\bmount\b/g, 'mt')
    .replace(/\bmt\.\s*/g, 'mt ')
    .replace(/\s*\/.*$/, '')
    .replace(/['\u2018\u2019`]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/,.*$/, '')
    .replace(/-/g, ' ')
    .replace(/\b(the|of|and|in|at|for|a|an|be)\b/g, '')
    .replace(/\b(episcopal|church|parish|community|chapel|cathedral|mission|memorial)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/([a-z]{4,})s\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// findMatch
// ---------------------------------------------------------------------------
describe('findMatch()', () => {
  it('matches by phone number within the same diocese', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'Trinity Church', diocese: 'New York',
      phone: '(212) 555-0100',
    });
    const ecdId = seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'Trinity Episcopal Church', diocese: 'New York',
      phone: '1-212-555-0100',
    });
    const ecdRow = db.prepare('SELECT * FROM parishes WHERE id = ?').get(ecdId);
    const result = findMatch(db, ecdRow);
    expect(result).not.toBeNull();
    expect(result.method).toBe('phone');
    expect(result.parish.nid).toBe('am-1');
  });

  it('does not match by phone across different dioceses', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'Trinity Church', diocese: 'New York',
      phone: '212-555-0100',
    });
    const ecdId = seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'Trinity Church', diocese: 'Connecticut',
      phone: '212-555-0100',
    });
    const ecdRow = db.prepare('SELECT * FROM parishes WHERE id = ?').get(ecdId);
    const result = findMatch(db, ecdRow);
    // Should not match on phone alone across dioceses
    expect(result === null || result.method !== 'phone').toBe(true);
  });

  it('matches by website (normalized domain)', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'Grace Church', diocese: 'Virginia',
      website: 'https://www.gracechurch.org',
    });
    const ecdId = seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'Grace Episcopal Church', diocese: 'Virginia',
      website: 'http://gracechurch.org/home',
    });
    const ecdRow = db.prepare('SELECT * FROM parishes WHERE id = ?').get(ecdId);
    const result = findMatch(db, ecdRow);
    expect(result).not.toBeNull();
    expect(result.method).toBe('website');
    expect(result.parish.nid).toBe('am-1');
  });

  it('matches by name + diocese via parish_aliases', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'St. Paul\'s Episcopal Church', diocese: 'Massachusetts',
      city: 'Boston',
    });
    const ecdId = seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'Saint Paul\'s Church', diocese: 'Massachusetts',
      city: 'Boston',
    });
    const ecdRow = db.prepare('SELECT * FROM parishes WHERE id = ?').get(ecdId);
    const result = findMatch(db, ecdRow);
    expect(result).not.toBeNull();
    expect(result.method).toMatch(/^name_diocese/);
    expect(result.parish.nid).toBe('am-1');
  });

  it('disambiguates name+diocese matches by city', () => {
    const db = getDb();
    // Two Asset Map parishes with same name/diocese but different cities
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'St. Paul\'s Church', diocese: 'Massachusetts',
      city: 'Boston',
    });
    seedAssetMapParish(db, {
      nid: 'am-2', name: 'St. Paul\'s Church', diocese: 'Massachusetts',
      city: 'Worcester',
    });
    const ecdId = seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'Saint Paul\'s Church', diocese: 'Massachusetts',
      city: 'Worcester',
    });
    const ecdRow = db.prepare('SELECT * FROM parishes WHERE id = ?').get(ecdId);
    const result = findMatch(db, ecdRow);
    expect(result).not.toBeNull();
    expect(result.method).toBe('name_diocese_city');
    expect(result.parish.nid).toBe('am-2');
  });

  it('returns null when no match is found', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'Trinity Church', diocese: 'New York',
    });
    const ecdId = seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'All Saints Church', diocese: 'California',
    });
    const ecdRow = db.prepare('SELECT * FROM parishes WHERE id = ?').get(ecdId);
    const result = findMatch(db, ecdRow);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mergeParishes
// ---------------------------------------------------------------------------
describe('mergeParishes()', () => {
  it('merges matching parishes by phone number', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'Trinity Church', diocese: 'New York',
      phone: '212-555-0100', lat: 40.7, lng: -74.0,
    });
    seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'Trinity Episcopal Church', diocese: 'New York',
      phone: '1-212-555-0100', email: 'info@trinity.org',
    });

    const stats = mergeParishes(db);
    expect(stats.merged).toBe(1);
    expect(stats.unmatched).toBe(0);

    // ECDPlus row should be deleted
    const ecdRow = db.prepare("SELECT * FROM parishes WHERE ecdplus_id = 'ecd-1' AND source = 'ecdplus'").get();
    expect(ecdRow).toBeUndefined();

    // Asset Map row should have merged data
    const merged = db.prepare("SELECT * FROM parishes WHERE nid = 'am-1'").get();
    expect(merged.source).toBe('both');
    expect(merged.ecdplus_id).toBe('ecd-1');
    expect(merged.email).toBe('info@trinity.org');
  });

  it('merges matching parishes by website', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'Grace Church', diocese: 'Virginia',
      website: 'https://www.graceva.org', lat: 38.9, lng: -77.0,
    });
    seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'Grace Episcopal Church', diocese: 'Virginia',
      website: 'http://graceva.org',
    });

    const stats = mergeParishes(db);
    expect(stats.merged).toBe(1);
  });

  it('merges matching parishes by name + diocese', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'St. Paul\'s Episcopal Church', diocese: 'Massachusetts',
      city: 'Boston', lat: 42.3, lng: -71.0,
    });
    seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'Saint Paul\'s Church', diocese: 'Massachusetts',
      city: 'Boston',
    });

    const stats = mergeParishes(db);
    expect(stats.merged).toBe(1);

    const merged = db.prepare("SELECT * FROM parishes WHERE nid = 'am-1'").get();
    expect(merged.ecdplus_id).toBe('ecd-1');
    expect(merged.source).toBe('both');
  });

  it('leaves unmatched ECDPlus parishes intact', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'Trinity Church', diocese: 'New York',
    });
    seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'All Saints Church', diocese: 'California',
    });

    const stats = mergeParishes(db);
    expect(stats.unmatched).toBe(1);

    const row = db.prepare("SELECT * FROM parishes WHERE ecdplus_id = 'ecd-1'").get();
    expect(row).toBeDefined();
    expect(row.source).toBe('ecdplus');
  });

  it('preserves Asset Map lat/lng on merge', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'Trinity Church', diocese: 'New York',
      phone: '212-555-0100', lat: 40.712, lng: -74.006,
    });
    seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'Trinity Episcopal Church', diocese: 'New York',
      phone: '212-555-0100',
    });

    mergeParishes(db);

    const merged = db.prepare("SELECT * FROM parishes WHERE nid = 'am-1'").get();
    expect(merged.lat).toBeCloseTo(40.712);
    expect(merged.lng).toBeCloseTo(-74.006);
  });

  it('removes duplicate ECDPlus rows after merge', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'Trinity Church', diocese: 'New York',
      phone: '212-555-0100',
    });
    seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'Trinity Episcopal Church', diocese: 'New York',
      phone: '212-555-0100',
    });

    mergeParishes(db);

    // Only one row for this parish should remain
    const rows = db.prepare("SELECT * FROM parishes WHERE diocese = 'New York'").all();
    const trinityRows = rows.filter(r => r.nid === 'am-1' || r.ecdplus_id === 'ecd-1');
    expect(trinityRows).toHaveLength(1);
    expect(trinityRows[0].source).toBe('both');
  });

  it('links clergy_positions to parishes by employer_id -> ecdplus_id', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: 'am-1', name: 'Trinity Church', diocese: 'New York',
      phone: '212-555-0100',
    });
    const ecdParishId = seedEcdplusParish(db, {
      ecdplus_id: 'ecd-1', name: 'Trinity Episcopal Church', diocese: 'New York',
      phone: '212-555-0100',
    });

    // Insert clergy and a position pointing to the ECDPlus parish
    db.prepare(`INSERT INTO clergy (guid, first_name, last_name) VALUES ('clg-1', 'Jane', 'Smith')`).run();
    db.prepare(`
      INSERT INTO clergy_positions (clergy_guid, parish_id, employer_id, employer_name, is_current)
      VALUES ('clg-1', ?, 'ecd-1', 'Trinity Episcopal Church', 1)
    `).run(ecdParishId);

    mergeParishes(db);

    // The clergy_position should now point to the merged Asset Map row
    const pos = db.prepare("SELECT * FROM clergy_positions WHERE clergy_guid = 'clg-1'").get();
    const mergedParish = db.prepare("SELECT * FROM parishes WHERE nid = 'am-1'").get();
    expect(pos.parish_id).toBe(mergedParish.id);
  });

  it('links unlinked clergy_positions by employer_id after merge', () => {
    const db = getDb();
    // An unmatched ECDPlus parish that stays
    seedEcdplusParish(db, {
      ecdplus_id: 'ecd-2', name: 'Grace Church', diocese: 'Virginia',
    });

    // Clergy position with employer_id but no parish_id
    db.prepare(`INSERT INTO clergy (guid, first_name, last_name) VALUES ('clg-2', 'John', 'Doe')`).run();
    db.prepare(`
      INSERT INTO clergy_positions (clergy_guid, parish_id, employer_id, employer_name, is_current)
      VALUES ('clg-2', NULL, 'ecd-2', 'Grace Church', 1)
    `).run();

    const stats = mergeParishes(db);
    expect(stats.linked).toBeGreaterThanOrEqual(1);

    const pos = db.prepare("SELECT * FROM clergy_positions WHERE clergy_guid = 'clg-2'").get();
    const parish = db.prepare("SELECT * FROM parishes WHERE ecdplus_id = 'ecd-2'").get();
    expect(pos.parish_id).toBe(parish.id);
  });

  it('logs fetch with merge_parishes source', () => {
    const db = getDb();
    mergeParishes(db);

    const log = db.prepare("SELECT * FROM fetch_log WHERE source = 'merge_parishes'").get();
    expect(log).toBeDefined();
    expect(log.status).toBe('success');
  });
});
