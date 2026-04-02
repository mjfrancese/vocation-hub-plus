import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../../db.js');
const backfillCoordinates = require('../../stages/backfill-coordinates.js');

let testDbPath;
let db;

function seedDB() {
  db = getDb();

  // Parish with coordinates (Asset Map)
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, source, lat, lng)
    VALUES (1, '1001', 'St. Paul''s', 'Diocese of Virginia', 'asset_map', 38.8, -77.04)`).run();

  // Parish without coordinates (ECDPlus)
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, source, lat, lng)
    VALUES (2, '1002', 'Grace Church', 'Diocese of Virginia', 'ecdplus', NULL, NULL)`).run();

  // Parish with zero coordinates (treated as missing)
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, source, lat, lng)
    VALUES (3, '1003', 'Trinity Church', 'Diocese of Connecticut', 'ecdplus', 0, 0)`).run();

  return db;
}

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `vocationhub-backfill-coords-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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
// backfillCoordinates
// ---------------------------------------------------------------------------

describe('backfillCoordinates', () => {
  it('copies lat/lng from parish to church_info when church_info lacks coords', () => {
    const positions = [
      {
        _parish_ids: [1],
        church_infos: [{ name: "St. Paul's", lat: null, lng: null }],
      },
    ];

    const result = backfillCoordinates(positions, db);

    expect(result[0].church_infos[0].lat).toBe(38.8);
    expect(result[0].church_infos[0].lng).toBe(-77.04);
  });

  it('does not overwrite church_info that already has coords', () => {
    const positions = [
      {
        _parish_ids: [1],
        church_infos: [{ name: "St. Paul's", lat: 39.9, lng: -75.0 }],
      },
    ];

    const result = backfillCoordinates(positions, db);

    // Original coords should be preserved
    expect(result[0].church_infos[0].lat).toBe(39.9);
    expect(result[0].church_infos[0].lng).toBe(-75.0);
  });

  it('leaves church_info unchanged when parish has no coords', () => {
    const positions = [
      {
        _parish_ids: [2],
        church_infos: [{ name: 'Grace Church', lat: null, lng: null }],
      },
    ];

    const result = backfillCoordinates(positions, db);

    expect(result[0].church_infos[0].lat).toBeNull();
    expect(result[0].church_infos[0].lng).toBeNull();
  });

  it('leaves positions with no matches unchanged', () => {
    const positions = [
      {
        _parish_ids: [],
        church_infos: [],
      },
    ];

    const result = backfillCoordinates(positions, db);

    expect(result[0]._parish_ids).toEqual([]);
    expect(result[0].church_infos).toEqual([]);
  });

  it('handles positions with no _parish_ids property', () => {
    const positions = [
      {
        church_infos: [{ name: 'Unknown', lat: null, lng: null }],
      },
    ];

    const result = backfillCoordinates(positions, db);

    expect(result[0].church_infos[0].lat).toBeNull();
  });

  it('backfills coords for each church_info in a multi-parish position', () => {
    // Add a second parish with coords
    db.prepare(`INSERT INTO parishes (id, nid, name, diocese, source, lat, lng)
      VALUES (4, '1004', 'Christ Church', 'Diocese of Virginia', 'asset_map', 37.5, -77.4)`).run();

    const positions = [
      {
        _parish_ids: [1, 4],
        church_infos: [
          { name: "St. Paul's", lat: null, lng: null },
          { name: 'Christ Church', lat: null, lng: null },
        ],
      },
    ];

    const result = backfillCoordinates(positions, db);

    expect(result[0].church_infos[0].lat).toBe(38.8);
    expect(result[0].church_infos[0].lng).toBe(-77.04);
    expect(result[0].church_infos[1].lat).toBe(37.5);
    expect(result[0].church_infos[1].lng).toBe(-77.4);
  });

  it('returns positions array unmodified in structure', () => {
    const positions = [
      {
        _parish_ids: [1],
        church_infos: [{ name: "St. Paul's", lat: null, lng: null }],
        name: 'Rector',
      },
    ];

    const result = backfillCoordinates(positions, db);

    expect(result).toBe(positions); // same array reference (mutates in place)
    expect(result[0].name).toBe('Rector');
  });
});
