import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../db.js');
const { mergeParishes } = require('../merge-parishes.js');

let testDbPath;

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
    .replace(/\s+/g, ' ')
    .trim();
}

function seedAssetMapParish(db, { nid, name, diocese, city, state, phone, website }) {
  const info = db.prepare(`
    INSERT INTO parishes (nid, name, diocese, city, state, phone, website, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'asset_map')
  `).run(nid, name, diocese, city || null, state || null, phone || null, website || null);
  db.prepare(`
    INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
    VALUES (?, ?, ?, 'asset_map')
  `).run(info.lastInsertRowid, name, normalizeName(name));
  return info.lastInsertRowid;
}

function seedEcdplusParish(db, { ecdplus_id, name, diocese, city, state, phone, website }) {
  const info = db.prepare(`
    INSERT INTO parishes (ecdplus_id, name, diocese, city, state, phone, website, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ecdplus')
  `).run(ecdplus_id, name, diocese, city || null, state || null, phone || null, website || null);
  db.prepare(`
    INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
    VALUES (?, ?, ?, 'ecdplus')
  `).run(info.lastInsertRowid, name, normalizeName(name));
  return info.lastInsertRowid;
}

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `vocationhub-merge-identity-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  process.env.VOCATIONHUB_DB_PATH = testDbPath;
});

afterEach(() => {
  try { closeDb(); } catch { /* ignore */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(testDbPath + suffix); } catch { /* ignore */ }
  }
  delete process.env.VOCATIONHUB_DB_PATH;
});

describe('merge-parishes identity table integration', () => {
  it('should write to parish_identity after successful phone merge', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: '100', name: "St. Paul's", diocese: 'Massachusetts',
      city: 'Boston', state: 'MA', phone: '617-555-1234',
    });
    seedEcdplusParish(db, {
      ecdplus_id: 'ECD-1', name: "Saint Paul's Episcopal", diocese: 'Massachusetts',
      city: 'Boston', state: 'MA', phone: '617-555-1234',
    });

    mergeParishes(db);

    const row = db.prepare(
      'SELECT * FROM parish_identity WHERE nid = ? AND ecdplus_id = ?'
    ).get('100', 'ECD-1');
    expect(row).toBeTruthy();
    expect(row.confidence).toBe('confirmed');
    expect(row.match_method).toBe('phone');
  });

  it('should write confirmed confidence for website merge', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: '100', name: 'Grace Church', diocese: 'Virginia',
      website: 'https://www.graceva.org',
    });
    seedEcdplusParish(db, {
      ecdplus_id: 'ECD-1', name: 'Grace Episcopal Church', diocese: 'Virginia',
      website: 'http://graceva.org',
    });

    mergeParishes(db);

    const row = db.prepare(
      'SELECT * FROM parish_identity WHERE nid = ? AND ecdplus_id = ?'
    ).get('100', 'ECD-1');
    expect(row).toBeTruthy();
    expect(row.confidence).toBe('confirmed');
    expect(row.match_method).toBe('website');
  });

  it('should record auto confidence for name-only matches', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: '100', name: "St. Paul's", diocese: 'Massachusetts',
      city: 'Boston', state: 'MA',
    });
    seedEcdplusParish(db, {
      ecdplus_id: 'ECD-1', name: "St. Paul's", diocese: 'Massachusetts',
      city: 'Boston', state: 'MA',
    });

    mergeParishes(db);

    const row = db.prepare(
      'SELECT * FROM parish_identity WHERE nid = ? AND ecdplus_id = ?'
    ).get('100', 'ECD-1');
    expect(row).toBeTruthy();
    expect(row.confidence).toBe('auto');
    expect(row.match_method).toMatch(/^name_diocese/);
  });

  it('should use identity table instead of heuristics when match exists', () => {
    const db = getDb();
    // Asset Map parish
    seedAssetMapParish(db, {
      nid: '100', name: "St. Paul's", diocese: 'Massachusetts',
      city: 'Boston', state: 'MA',
    });
    // ECDPlus parish with DIFFERENT name -- would NOT match heuristically
    seedEcdplusParish(db, {
      ecdplus_id: 'ECD-1', name: 'Completely Different Name', diocese: 'Massachusetts',
      city: 'Boston', state: 'MA',
    });
    // Pre-existing identity link
    db.prepare(
      `INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method)
       VALUES ('100', 'ECD-1', 'confirmed', 'phone')`
    ).run();

    const result = mergeParishes(db);

    expect(result.merged).toBe(1);
    const parish = db.prepare("SELECT * FROM parishes WHERE nid = '100'").get();
    expect(parish.source).toBe('both');
    expect(parish.ecdplus_id).toBe('ECD-1');
  });

  it('should not duplicate identity rows when identity match already exists', () => {
    const db = getDb();
    seedAssetMapParish(db, {
      nid: '100', name: "St. Paul's", diocese: 'Massachusetts',
      city: 'Boston', state: 'MA',
    });
    seedEcdplusParish(db, {
      ecdplus_id: 'ECD-1', name: 'Completely Different Name', diocese: 'Massachusetts',
      city: 'Boston', state: 'MA',
    });
    db.prepare(
      `INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method)
       VALUES ('100', 'ECD-1', 'confirmed', 'phone')`
    ).run();

    mergeParishes(db);

    const rows = db.prepare(
      'SELECT * FROM parish_identity WHERE nid = ? AND ecdplus_id = ?'
    ).all('100', 'ECD-1');
    expect(rows).toHaveLength(1);
  });

  it('should skip identity lookup when ecdplus parish has no ecdplus_id', () => {
    const db = getDb();
    // An ecdplus parish without an ecdplus_id should still use heuristics
    seedAssetMapParish(db, {
      nid: '100', name: "St. Paul's", diocese: 'Massachusetts',
      city: 'Boston', state: 'MA', phone: '617-555-1234',
    });
    // Seed manually without ecdplus_id
    db.prepare(`
      INSERT INTO parishes (name, diocese, city, state, phone, source)
      VALUES ('St. Paul''s', 'Massachusetts', 'Boston', 'MA', '617-555-1234', 'ecdplus')
    `).run();

    const result = mergeParishes(db);
    // Should still merge via phone heuristic
    expect(result.merged).toBe(1);
  });
});
