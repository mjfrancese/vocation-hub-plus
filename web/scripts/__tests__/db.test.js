import path from 'path';
import fs from 'fs';
import os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb, getDbPath, logFetch } from '../db.js';

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

describe('db module', () => {
  describe('getDb()', () => {
    it('returns a database instance', () => {
      const db = getDb();
      expect(db).toBeDefined();
      expect(typeof db.prepare).toBe('function');
    });

    it('returns the same instance on multiple calls (singleton)', () => {
      const db1 = getDb();
      const db2 = getDb();
      expect(db1).toBe(db2);
    });

    it('enables WAL mode', () => {
      const db = getDb();
      const result = db.pragma('journal_mode');
      expect(result[0].journal_mode).toBe('wal');
    });

    it('enables foreign keys', () => {
      const db = getDb();
      const result = db.pragma('foreign_keys');
      expect(result[0].foreign_keys).toBe(1);
    });
  });

  describe('getDbPath()', () => {
    it('returns the resolved DB path', () => {
      getDb(); // ensure initialized
      expect(getDbPath()).toBe(path.resolve(testDbPath));
    });
  });

  describe('closeDb()', () => {
    it('closes the database and resets singleton', () => {
      const db1 = getDb();
      closeDb();
      const db2 = getDb();
      expect(db2).not.toBe(db1);
    });
  });

  describe('schema - tables', () => {
    const expectedTables = [
      'parishes',
      'parish_aliases',
      'clergy',
      'clergy_positions',
      'compensation_diocesan',
      'compensation_by_asa',
      'compensation_by_position',
      'compensation_by_experience',
      'compensation_by_revenue',
      'parochial_data',
      'fetch_log',
    ];

    it.each(expectedTables)('creates table: %s', (tableName) => {
      const db = getDb();
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(tableName);
      expect(row).toBeDefined();
      expect(row.name).toBe(tableName);
    });
  });

  describe('schema - indexes', () => {
    const expectedIndexes = [
      'idx_parishes_diocese',
      'idx_parishes_state',
      'idx_parishes_name_diocese',
      'idx_parishes_ecdplus_id',
      'idx_parishes_nid',
      'idx_parish_aliases_normalized',
      'idx_clergy_canonical_residence',
      'idx_clergy_last_name',
      'idx_clergy_positions_guid',
      'idx_clergy_positions_parish',
      'idx_clergy_positions_current',
      'idx_comp_diocesan_year',
      'idx_comp_diocesan_diocese',
      'idx_parochial_parish_nid',
    ];

    it.each(expectedIndexes)('creates index: %s', (indexName) => {
      const db = getDb();
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get(indexName);
      expect(row).toBeDefined();
      expect(row.name).toBe(indexName);
    });
  });

  describe('logFetch()', () => {
    it('inserts a row into fetch_log', () => {
      const db = getDb();
      logFetch('test-source', {
        records_total: 100,
        records_new: 50,
        records_updated: 30,
        duration_ms: 1234,
      });

      const row = db.prepare('SELECT * FROM fetch_log WHERE source = ?').get('test-source');
      expect(row).toBeDefined();
      expect(row.records_total).toBe(100);
      expect(row.records_new).toBe(50);
      expect(row.records_updated).toBe(30);
      expect(row.duration_ms).toBe(1234);
      expect(row.status).toBe('success');
    });

    it('records error status', () => {
      const db = getDb();
      logFetch('fail-source', {
        records_total: 0,
        records_new: 0,
        records_updated: 0,
        duration_ms: 500,
        status: 'error',
        error: 'Something broke',
      });

      const row = db.prepare('SELECT * FROM fetch_log WHERE source = ?').get('fail-source');
      expect(row.status).toBe('error');
      expect(row.error).toBe('Something broke');
    });
  });
});
