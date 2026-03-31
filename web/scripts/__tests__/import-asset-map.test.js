import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Use createRequire so db.js and import-asset-map.js share the same CJS
// module instance (avoids ESM/CJS dual-package singleton issues).
const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../db.js');
const { importAssetMap } = require('../import-asset-map.js');

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

const sampleData = {
  meta: { lastUpdated: '2026-03-27T16:38:05.060Z', totalChurches: 3 },
  churches: [
    {
      nid: 8925,
      name: "St. Mark's Episcopal Church",
      diocese: 'Los Angeles',
      street: '535 W. Roses Road',
      city: 'San Gabriel',
      state: 'CA',
      zip: '91775',
      phone: '626-282-2731',
      email: 'info@stmarks.org',
      website: 'http://stmarks.org',
      type: 'parish',
      lat: 34.1113,
      lng: -118.10806,
    },
    {
      nid: 1001,
      name: 'Grace Church',
      diocese: 'Virginia',
      street: '100 Main St',
      city: 'Alexandria',
      state: 'VA',
      zip: '22301',
      phone: '703-555-1234',
      email: 'office@grace.org',
      website: 'http://grace.org',
      type: 'parish',
      lat: 38.8,
      lng: -77.04,
    },
    {
      nid: 2002,
      name: 'Trinity Cathedral',
      diocese: 'Ohio',
      street: '200 Church Ave',
      city: 'Cleveland',
      state: 'OH',
      zip: '44113',
      phone: '216-555-9999',
      email: 'admin@trinity.org',
      website: 'http://trinity.org',
      type: 'cathedral',
      lat: 41.5,
      lng: -81.69,
    },
  ],
};

describe('importAssetMap()', () => {
  it('imports all churches into parishes table with correct count', () => {
    const stats = importAssetMap(sampleData);

    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as cnt FROM parishes').get().cnt;
    expect(count).toBe(3);
    expect(stats.total).toBe(3);
    expect(stats.new).toBe(3);
    expect(stats.updated).toBe(0);
    expect(stats.status).toBe('success');
    expect(typeof stats.duration_ms).toBe('number');
  });

  it('stores correct field values', () => {
    importAssetMap(sampleData);

    const db = getDb();
    const row = db.prepare('SELECT * FROM parishes WHERE nid = ?').get('8925');
    expect(row).toBeDefined();
    expect(row.name).toBe("St. Mark's Episcopal Church");
    expect(row.diocese).toBe('Los Angeles');
    expect(row.city).toBe('San Gabriel');
    expect(row.state).toBe('CA');
    expect(row.zip).toBe('91775');
    expect(row.address).toBe('535 W. Roses Road');
    expect(row.phone).toBe('626-282-2731');
    expect(row.email).toBe('info@stmarks.org');
    expect(row.website).toBe('http://stmarks.org');
    expect(row.type).toBe('parish');
    expect(row.lat).toBeCloseTo(34.1113);
    expect(row.lng).toBeCloseTo(-118.10806);
    expect(row.source).toBe('asset_map');
    expect(row.nid).toBe('8925');
  });

  it('creates parish_aliases for each church with normalized name', () => {
    importAssetMap(sampleData);

    const db = getDb();
    const aliases = db.prepare('SELECT * FROM parish_aliases').all();
    expect(aliases.length).toBe(3);

    // Check that the alias for St. Mark's is normalized
    const stMarksParish = db.prepare('SELECT id FROM parishes WHERE nid = ?').get('8925');
    const stMarksAlias = db.prepare(
      'SELECT * FROM parish_aliases WHERE parish_id = ?'
    ).get(stMarksParish.id);
    expect(stMarksAlias).toBeDefined();
    expect(stMarksAlias.alias).toBe("St. Mark's Episcopal Church");
    expect(stMarksAlias.alias_normalized).toBeTruthy();
    expect(stMarksAlias.source).toBe('asset_map');
    // normalized should strip "st.", "episcopal", "church" etc
    expect(stMarksAlias.alias_normalized).not.toContain('episcopal');
    expect(stMarksAlias.alias_normalized).not.toContain('church');
  });

  it('updates existing parishes on re-import (upsert by nid)', () => {
    importAssetMap(sampleData);

    // Modify one church and re-import
    const updatedData = {
      meta: { lastUpdated: '2026-03-28T00:00:00Z', totalChurches: 3 },
      churches: [
        {
          ...sampleData.churches[0],
          city: 'Pasadena',
          phone: '626-999-0000',
        },
        sampleData.churches[1],
        sampleData.churches[2],
      ],
    };

    closeDb(); // reset singleton
    const stats = importAssetMap(updatedData);

    expect(stats.total).toBe(3);
    expect(stats.updated).toBe(3);
    expect(stats.new).toBe(0);

    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as cnt FROM parishes').get().cnt;
    expect(count).toBe(3); // no duplicates

    const row = db.prepare('SELECT * FROM parishes WHERE nid = ?').get('8925');
    expect(row.city).toBe('Pasadena');
    expect(row.phone).toBe('626-999-0000');
  });

  it('skips churches with empty name', () => {
    const dataWithEmpty = {
      meta: { lastUpdated: '2026-03-27T00:00:00Z', totalChurches: 2 },
      churches: [
        sampleData.churches[0],
        { nid: 9999, name: '', diocese: 'Nowhere', street: '', city: '', state: '', zip: '', phone: '', email: '', website: '', type: '', lat: 0, lng: 0 },
        { nid: 9998, name: null, diocese: 'Nowhere', street: '', city: '', state: '', zip: '', phone: '', email: '', website: '', type: '', lat: 0, lng: 0 },
      ],
    };

    const stats = importAssetMap(dataWithEmpty);

    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as cnt FROM parishes').get().cnt;
    expect(count).toBe(1);
    expect(stats.total).toBe(1);
    expect(stats.new).toBe(1);
  });

  it('logs the fetch via fetch_log', () => {
    importAssetMap(sampleData);

    const db = getDb();
    const log = db.prepare("SELECT * FROM fetch_log WHERE source = 'asset_map'").get();
    expect(log).toBeDefined();
    expect(log.records_total).toBe(3);
    expect(log.status).toBe('success');
  });
});
