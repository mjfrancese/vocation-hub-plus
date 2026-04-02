import { createRequire } from 'module';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../db.js');

let db;
let testDbPath;

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `vocationhub-confirm-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  process.env.VOCATIONHUB_DB_PATH = testDbPath;
  db = getDb();

  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (1, '100', 'St. Paul''s', 'Massachusetts', 'Boston', 'MA', 'asset_map')`).run();
  db.prepare(`INSERT INTO parishes (id, ecdplus_id, name, diocese, city, state, source)
    VALUES (2, 'ECD-1', 'Saint Paul''s Episcopal', 'Massachusetts', 'Boston', 'MA', 'ecdplus')`).run();
  db.prepare(`INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method)
    VALUES ('100', 'ECD-1', 'auto', 'name_diocese')`).run();
});

afterEach(() => {
  closeDb();
  delete process.env.VOCATIONHUB_DB_PATH;
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(testDbPath + suffix); } catch { /* ignore */ }
  }
});

describe('confirm-parish-matches', () => {
  it('getUnconfirmedMatches should return auto-confidence matches', () => {
    const { getUnconfirmedMatches } = require('../confirm-parish-matches.js');
    const matches = getUnconfirmedMatches(db);

    expect(matches).toHaveLength(1);
    expect(matches[0].nid).toBe('100');
    expect(matches[0].ecdplus_id).toBe('ECD-1');
    expect(matches[0].asset_map_name).toBe("St. Paul's");
    expect(matches[0].ecdplus_name).toBe("Saint Paul's Episcopal");
    expect(matches[0].match_method).toBe('name_diocese');
  });

  it('confirmMatch should update confidence and confirmed_at', () => {
    const { confirmMatch } = require('../confirm-parish-matches.js');
    confirmMatch(db, '100', 'ECD-1');

    const row = db.prepare('SELECT * FROM parish_identity WHERE nid = ? AND ecdplus_id = ?').get('100', 'ECD-1');
    expect(row.confidence).toBe('confirmed');
    expect(row.confirmed_at).toBeTruthy();
  });

  it('rejectMatch should delete the identity row', () => {
    const { rejectMatch } = require('../confirm-parish-matches.js');
    rejectMatch(db, '100', 'ECD-1');

    const row = db.prepare('SELECT * FROM parish_identity WHERE nid = ? AND ecdplus_id = ?').get('100', 'ECD-1');
    expect(row).toBeUndefined();
  });

  it('getStats should return counts by confidence', () => {
    const { getStats } = require('../confirm-parish-matches.js');
    db.prepare(`INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method, confirmed_at)
      VALUES ('200', 'ECD-2', 'confirmed', 'phone', datetime('now'))`).run();

    const stats = getStats(db);
    expect(stats.auto).toBe(1);
    expect(stats.confirmed).toBe(1);
    expect(stats.total).toBe(2);
  });
});
