import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../db.js');
const { importParochialData } = require('../import-parochial-data.js');

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
  meta: { totalCongregations: 2, yearRange: [2015, 2017] },
  congregations: [
    {
      congregationCity: 'All Saints Episcopal Church (Birmingham)',
      diocese: 'Alabama',
      years: {
        '2015': { averageAttendance: 404, plateAndPledge: 1078777, membership: 1823 },
        '2016': { averageAttendance: 401, plateAndPledge: 1765957, membership: 1864 },
        '2017': { averageAttendance: 394, plateAndPledge: 1211343, membership: 1912 },
      },
    },
    {
      congregationCity: 'Grace Church (Alexandria)',
      diocese: 'Virginia',
      years: {
        '2015': { averageAttendance: 100, plateAndPledge: 200000, membership: 300, operatingRevenue: 250000 },
        '2016': { averageAttendance: 105, plateAndPledge: 210000, membership: 310 },
      },
    },
  ],
};

describe('importParochialData()', () => {
  it('imports all year-rows correctly (3 years + 2 years = 5 rows)', () => {
    const stats = importParochialData(sampleData);

    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as cnt FROM parochial_data').get().cnt;
    expect(count).toBe(5);
    expect(stats.total).toBe(5);
    expect(stats.new).toBe(5);
    expect(stats.updated).toBe(0);
    expect(stats.status).toBe('success');
    expect(typeof stats.duration_ms).toBe('number');
  });

  it('stores correct values per year', () => {
    importParochialData(sampleData);

    const db = getDb();
    const row = db.prepare(
      'SELECT * FROM parochial_data WHERE parish_nid = ? AND year = ?'
    ).get('All Saints Episcopal Church (Birmingham)', 2016);

    expect(row).toBeDefined();
    expect(row.average_attendance).toBe(401);
    expect(row.plate_and_pledge).toBe(1765957);
    expect(row.membership).toBe(1864);
    expect(row.operating_revenue).toBeNull();
  });

  it('stores operatingRevenue when present', () => {
    importParochialData(sampleData);

    const db = getDb();
    const row = db.prepare(
      'SELECT * FROM parochial_data WHERE parish_nid = ? AND year = ?'
    ).get('Grace Church (Alexandria)', 2015);

    expect(row.operating_revenue).toBe(250000);
  });

  it('uses congregationCity as parish_nid key', () => {
    importParochialData(sampleData);

    const db = getDb();
    const nids = db.prepare(
      'SELECT DISTINCT parish_nid FROM parochial_data ORDER BY parish_nid'
    ).all().map(r => r.parish_nid);

    expect(nids).toEqual([
      'All Saints Episcopal Church (Birmingham)',
      'Grace Church (Alexandria)',
    ]);
  });

  it('handles re-import with upsert (same count, updated values)', () => {
    importParochialData(sampleData);

    // Modify a value and re-import
    const updatedData = {
      ...sampleData,
      congregations: [
        {
          ...sampleData.congregations[0],
          years: {
            ...sampleData.congregations[0].years,
            '2016': { averageAttendance: 999, plateAndPledge: 2000000, membership: 2000 },
          },
        },
        sampleData.congregations[1],
      ],
    };

    closeDb(); // reset singleton
    const stats = importParochialData(updatedData);

    expect(stats.total).toBe(5);
    expect(stats.updated).toBe(5);
    expect(stats.new).toBe(0);

    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as cnt FROM parochial_data').get().cnt;
    expect(count).toBe(5); // no duplicates

    const row = db.prepare(
      'SELECT * FROM parochial_data WHERE parish_nid = ? AND year = ?'
    ).get('All Saints Episcopal Church (Birmingham)', 2016);
    expect(row.average_attendance).toBe(999);
    expect(row.plate_and_pledge).toBe(2000000);
    expect(row.membership).toBe(2000);
  });

  it('logs the fetch via fetch_log', () => {
    importParochialData(sampleData);

    const db = getDb();
    const log = db.prepare("SELECT * FROM fetch_log WHERE source = 'parochial_data'").get();
    expect(log).toBeDefined();
    expect(log.records_total).toBe(5);
    expect(log.status).toBe('success');
  });

  it('handles null values in year data gracefully', () => {
    const dataWithNulls = {
      meta: { totalCongregations: 1, yearRange: [2024, 2024] },
      congregations: [
        {
          congregationCity: 'Test Church (Nowhere)',
          diocese: 'Test',
          years: {
            '2024': { averageAttendance: 50, plateAndPledge: null, membership: null },
          },
        },
      ],
    };

    const stats = importParochialData(dataWithNulls);
    expect(stats.total).toBe(1);

    const db = getDb();
    const row = db.prepare(
      'SELECT * FROM parochial_data WHERE parish_nid = ? AND year = ?'
    ).get('Test Church (Nowhere)', 2024);
    expect(row.average_attendance).toBe(50);
    expect(row.plate_and_pledge).toBeNull();
    expect(row.membership).toBeNull();
  });
});
