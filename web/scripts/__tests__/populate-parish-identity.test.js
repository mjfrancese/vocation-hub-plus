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
    `vocationhub-identity-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  process.env.VOCATIONHUB_DB_PATH = testDbPath;
  db = getDb();
});

afterEach(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(testDbPath + suffix); } catch { /* ignore */ }
  }
  delete process.env.VOCATIONHUB_DB_PATH;
});

describe('seedFromExistingMerges', () => {
  it('should populate identity table from source=both parishes', () => {
    db.prepare(`INSERT INTO parishes (id, nid, ecdplus_id, name, diocese, source)
      VALUES (1, '100', 'ECD-1', 'St. Paul''s', 'Massachusetts', 'both')`).run();

    const { seedFromExistingMerges } = require('../populate-parish-identity.js');
    const result = seedFromExistingMerges(db);

    expect(result.seeded).toBe(1);
    const row = db.prepare('SELECT * FROM parish_identity WHERE nid = ? AND ecdplus_id = ?').get('100', 'ECD-1');
    expect(row).toBeTruthy();
    expect(row.confidence).toBe('confirmed');
    expect(row.match_method).toBe('existing_merge');
  });

  it('should skip parishes already in identity table', () => {
    db.prepare(`INSERT INTO parishes (id, nid, ecdplus_id, name, diocese, source)
      VALUES (1, '100', 'ECD-1', 'St. Paul''s', 'Massachusetts', 'both')`).run();
    db.prepare(`INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method)
      VALUES ('100', 'ECD-1', 'confirmed', 'phone')`).run();

    const { seedFromExistingMerges } = require('../populate-parish-identity.js');
    const result = seedFromExistingMerges(db);

    expect(result.seeded).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should skip parishes missing nid or ecdplus_id', () => {
    db.prepare(`INSERT INTO parishes (id, nid, name, diocese, source)
      VALUES (1, '100', 'St. Paul''s', 'Massachusetts', 'asset_map')`).run();

    const { seedFromExistingMerges } = require('../populate-parish-identity.js');
    const result = seedFromExistingMerges(db);

    expect(result.seeded).toBe(0);
  });
});
