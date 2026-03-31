import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../db.js');
const {
  parseParishList,
  parseParishDetail,
  upsertParish,
} = require('../fetch-ecdplus-parishes.js');

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

// ---------------------------------------------------------------------------
// parseParishList
// ---------------------------------------------------------------------------
describe('parseParishList()', () => {
  it('extracts id, name, type, phone, maps_link from results', () => {
    const response = {
      results: [
        {
          id: '9870396045',
          name: 'Trinity Church',
          address: '75 Broadway, New York, NY 10006',
          number: '212-555-0100',
          type: 'Parish',
          maps_link: 'https://maps.google.com/?q=Trinity',
        },
        {
          id: '1234567890',
          name: 'Grace Church',
          address: '100 Main St, Boston, MA 02101',
          number: '617-555-0200',
          type: 'Mission',
          maps_link: 'https://maps.google.com/?q=Grace',
        },
      ],
    };

    const list = parseParishList(response);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      id: '9870396045',
      name: 'Trinity Church',
      type: 'Parish',
      phone: '212-555-0100',
      maps_link: 'https://maps.google.com/?q=Trinity',
    });
    expect(list[1].id).toBe('1234567890');
  });

  it('returns empty array for missing or empty results', () => {
    expect(parseParishList({})).toEqual([]);
    expect(parseParishList({ results: [] })).toEqual([]);
    expect(parseParishList(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseParishDetail
// ---------------------------------------------------------------------------
describe('parseParishDetail()', () => {
  const detail = {
    name: 'Trinity Church',
    address: '75 Broadway\nNew York, NY 10006',
    diocese: 'New York',
    website: 'https://trinitywallstreet.org',
    email: 'info@trinitywallstreet.org',
    number: '212-555-0100',
    type: 'Parish',
    clergy_count: 5,
    clergy: [{ first_name: 'Jane', last_name: 'Smith', id: '12345' }],
    maps_link: 'https://maps.google.com/?q=Trinity',
  };

  it('extracts all top-level fields', () => {
    const parsed = parseParishDetail(detail);
    expect(parsed.name).toBe('Trinity Church');
    expect(parsed.diocese).toBe('New York');
    expect(parsed.website).toBe('https://trinitywallstreet.org');
    expect(parsed.email).toBe('info@trinitywallstreet.org');
    expect(parsed.phone).toBe('212-555-0100');
    expect(parsed.type).toBe('Parish');
    expect(parsed.clergy_count).toBe(5);
    expect(parsed.clergy).toEqual([{ first_name: 'Jane', last_name: 'Smith', id: '12345' }]);
    expect(parsed.maps_link).toBe('https://maps.google.com/?q=Trinity');
  });

  it('parses multi-line address into address/city/state/zip', () => {
    const parsed = parseParishDetail(detail);
    expect(parsed.address).toBe('75 Broadway');
    expect(parsed.city).toBe('New York');
    expect(parsed.state).toBe('NY');
    expect(parsed.zip).toBe('10006');
  });

  it('handles address with multiple street lines', () => {
    const multi = {
      ...detail,
      address: 'Suite 200\n75 Broadway\nNew York, NY 10006',
    };
    const parsed = parseParishDetail(multi);
    expect(parsed.address).toBe('Suite 200\n75 Broadway');
    expect(parsed.city).toBe('New York');
    expect(parsed.state).toBe('NY');
    expect(parsed.zip).toBe('10006');
  });

  it('handles zip+4 format', () => {
    const zip4 = {
      ...detail,
      address: '75 Broadway\nNew York, NY 10006-1234',
    };
    const parsed = parseParishDetail(zip4);
    expect(parsed.zip).toBe('10006-1234');
  });

  it('handles missing address gracefully', () => {
    const noAddr = { ...detail, address: null };
    const parsed = parseParishDetail(noAddr);
    expect(parsed.address).toBeNull();
    expect(parsed.city).toBeNull();
    expect(parsed.state).toBeNull();
    expect(parsed.zip).toBeNull();
  });

  it('handles single-line address (no city/state/zip line)', () => {
    const single = { ...detail, address: 'PO Box 123' };
    const parsed = parseParishDetail(single);
    // Single line doesn't match city/state/zip regex, so treat as address only
    expect(parsed.address).toBe('PO Box 123');
    expect(parsed.city).toBeNull();
    expect(parsed.state).toBeNull();
    expect(parsed.zip).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// upsertParish
// ---------------------------------------------------------------------------
describe('upsertParish()', () => {
  const baseData = {
    ecdplus_id: '9870396045',
    name: 'Trinity Church',
    diocese: 'New York',
    address: '75 Broadway',
    city: 'New York',
    state: 'NY',
    zip: '10006',
    phone: '212-555-0100',
    email: 'info@trinitywallstreet.org',
    website: 'https://trinitywallstreet.org',
    type: 'Parish',
    clergy_count: 5,
    maps_link: 'https://maps.google.com/?q=Trinity',
  };

  it('inserts a new parish with source=ecdplus', () => {
    const db = getDb();
    const result = upsertParish(db, baseData);
    expect(result).toBe('new');

    const row = db.prepare('SELECT * FROM parishes WHERE ecdplus_id = ?').get('9870396045');
    expect(row).toBeDefined();
    expect(row.name).toBe('Trinity Church');
    expect(row.diocese).toBe('New York');
    expect(row.address).toBe('75 Broadway');
    expect(row.city).toBe('New York');
    expect(row.state).toBe('NY');
    expect(row.zip).toBe('10006');
    expect(row.phone).toBe('212-555-0100');
    expect(row.email).toBe('info@trinitywallstreet.org');
    expect(row.website).toBe('https://trinitywallstreet.org');
    expect(row.type).toBe('Parish');
    expect(row.ecdplus_clergy_count).toBe(5);
    expect(row.maps_link).toBe('https://maps.google.com/?q=Trinity');
    expect(row.source).toBe('ecdplus');
  });

  it('creates a parish_alias with normalized name on insert', () => {
    const db = getDb();
    upsertParish(db, baseData);

    const parish = db.prepare('SELECT id FROM parishes WHERE ecdplus_id = ?').get('9870396045');
    const alias = db.prepare('SELECT * FROM parish_aliases WHERE parish_id = ?').get(parish.id);
    expect(alias).toBeDefined();
    expect(alias.alias).toBe('Trinity Church');
    expect(alias.alias_normalized).toBeTruthy();
    expect(alias.source).toBe('ecdplus');
    // Normalized name should not contain "church"
    expect(alias.alias_normalized).not.toContain('church');
  });

  it('updates existing ecdplus parish without overwriting with empty strings', () => {
    const db = getDb();
    upsertParish(db, baseData);

    // Update with some fields empty
    const result = upsertParish(db, {
      ...baseData,
      email: '',
      website: '',
      phone: '212-999-0000',
    });
    expect(result).toBe('updated');

    const row = db.prepare('SELECT * FROM parishes WHERE ecdplus_id = ?').get('9870396045');
    // email and website should be preserved (COALESCE)
    expect(row.email).toBe('info@trinitywallstreet.org');
    expect(row.website).toBe('https://trinitywallstreet.org');
    // phone should be updated
    expect(row.phone).toBe('212-999-0000');
  });

  it('sets source to "both" when updating an asset_map parish', () => {
    const db = getDb();
    // First insert via asset_map
    db.prepare(`
      INSERT INTO parishes (nid, ecdplus_id, name, diocese, source)
      VALUES ('nid-123', '9870396045', 'Trinity Church', 'New York', 'asset_map')
    `).run();

    const result = upsertParish(db, baseData);
    expect(result).toBe('updated');

    const row = db.prepare('SELECT * FROM parishes WHERE ecdplus_id = ?').get('9870396045');
    expect(row.source).toBe('both');
  });

  it('keeps source as "ecdplus" when updating an ecdplus parish', () => {
    const db = getDb();
    upsertParish(db, baseData);
    upsertParish(db, { ...baseData, phone: '212-999-0000' });

    const row = db.prepare('SELECT * FROM parishes WHERE ecdplus_id = ?').get('9870396045');
    expect(row.source).toBe('ecdplus');
  });

  it('keeps source as "both" when updating a "both" parish', () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO parishes (ecdplus_id, name, diocese, source)
      VALUES ('9870396045', 'Trinity Church', 'New York', 'both')
    `).run();

    upsertParish(db, baseData);

    const row = db.prepare('SELECT * FROM parishes WHERE ecdplus_id = ?').get('9870396045');
    expect(row.source).toBe('both');
  });
});
