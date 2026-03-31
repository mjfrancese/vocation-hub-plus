import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../db.js');
const {
  parseClergyList,
  parseClergyDetail,
  upsertClergy,
} = require('../fetch-ecdplus-clergy.js');

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
// parseClergyList
// ---------------------------------------------------------------------------
describe('parseClergyList()', () => {
  it('extracts guid, first_name, middle_name, last_name, street_city, street_state from results', () => {
    const response = {
      results: [
        {
          guid: 'abc-123',
          first_name: 'Jane',
          middle_name: 'A',
          last_name: 'Smith',
          street_city: 'New York',
          street_state: 'NY',
          street_country: 'US',
        },
        {
          guid: 'def-456',
          first_name: 'John',
          middle_name: '',
          last_name: 'Doe',
          street_city: 'Boston',
          street_state: 'MA',
          street_country: 'US',
        },
      ],
    };

    const list = parseClergyList(response);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      guid: 'abc-123',
      first_name: 'Jane',
      middle_name: 'A',
      last_name: 'Smith',
      street_city: 'New York',
      street_state: 'NY',
    });
    expect(list[1].guid).toBe('def-456');
    expect(list[1].middle_name).toBe('');
  });

  it('returns empty array for missing or empty results', () => {
    expect(parseClergyList({})).toEqual([]);
    expect(parseClergyList({ results: [] })).toEqual([]);
    expect(parseClergyList(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseClergyDetail
// ---------------------------------------------------------------------------
describe('parseClergyDetail()', () => {
  const detail = {
    full_name: 'The Rev. Jane Smith',
    published_address: '123 Church St\nNew York, NY 10001',
    email_address: 'jane@church.org',
    canonical_residence: 'New York',
    ordination_information: {
      diaconal_data: { date: '06/15/2010', bishop: 'Mark Sisk', diocese: 'New York' },
      priesting_data: { date: '12/20/2010', bishop: 'Mark Sisk', diocese: 'New York' },
      bishop_consecration_data: {},
    },
    principal_positions: [
      {
        position_title: 'Rector',
        start_date: '01/01/2018',
        end_date: null,
        employer_name: 'Trinity Church',
        employer_id: '9870396045',
        employer_address: '75 Broadway',
        employer_phone_number: '212-555-0100',
      },
      {
        position_title: 'Associate Rector',
        start_date: '07/01/2012',
        end_date: '12/31/2017',
        employer_name: "St. Paul's",
        employer_id: '9870396050',
        employer_address: '',
        employer_phone_number: '',
      },
    ],
  };

  it('extracts email and canonical_residence', () => {
    const parsed = parseClergyDetail(detail);
    expect(parsed.email).toBe('jane@church.org');
    expect(parsed.canonical_residence).toBe('New York');
  });

  it('parses multi-line address into address/city/state/zip', () => {
    const parsed = parseClergyDetail(detail);
    expect(parsed.address).toBe('123 Church St');
    expect(parsed.city).toBe('New York');
    expect(parsed.state).toBe('NY');
    expect(parsed.zip).toBe('10001');
  });

  it('extracts ordination data', () => {
    const parsed = parseClergyDetail(detail);
    expect(parsed.diaconate_date).toBe('06/15/2010');
    expect(parsed.diaconate_bishop).toBe('Mark Sisk');
    expect(parsed.diaconate_diocese).toBe('New York');
    expect(parsed.priesting_date).toBe('12/20/2010');
    expect(parsed.priesting_bishop).toBe('Mark Sisk');
    expect(parsed.priesting_diocese).toBe('New York');
    expect(parsed.bishop_consecration_date).toBeNull();
    expect(parsed.bishop_consecration_diocese).toBeNull();
  });

  it('parses positions with is_current flag', () => {
    const parsed = parseClergyDetail(detail);
    expect(parsed.positions).toHaveLength(2);
    expect(parsed.positions[0]).toEqual({
      position_title: 'Rector',
      employer_name: 'Trinity Church',
      employer_id: '9870396045',
      employer_address: '75 Broadway',
      employer_phone: '212-555-0100',
      start_date: '01/01/2018',
      end_date: null,
      is_current: 1,
    });
    expect(parsed.positions[1]).toEqual({
      position_title: 'Associate Rector',
      employer_name: "St. Paul's",
      employer_id: '9870396050',
      employer_address: '',
      employer_phone: '',
      start_date: '07/01/2012',
      end_date: '12/31/2017',
      is_current: 0,
    });
  });

  it('handles missing ordination_information gracefully', () => {
    const noOrd = { ...detail, ordination_information: null };
    const parsed = parseClergyDetail(noOrd);
    expect(parsed.diaconate_date).toBeNull();
    expect(parsed.priesting_date).toBeNull();
  });

  it('handles missing principal_positions gracefully', () => {
    const noPos = { ...detail, principal_positions: null };
    const parsed = parseClergyDetail(noPos);
    expect(parsed.positions).toEqual([]);
  });

  it('handles missing published_address gracefully', () => {
    const noAddr = { ...detail, published_address: null };
    const parsed = parseClergyDetail(noAddr);
    expect(parsed.address).toBeNull();
    expect(parsed.city).toBeNull();
    expect(parsed.state).toBeNull();
    expect(parsed.zip).toBeNull();
  });

  it('handles address with zip+4', () => {
    const zip4 = { ...detail, published_address: '123 Church St\nNew York, NY 10001-4567' };
    const parsed = parseClergyDetail(zip4);
    expect(parsed.zip).toBe('10001-4567');
  });

  it('handles single-line address that is just city/state/zip', () => {
    const cityOnly = { ...detail, published_address: 'New York, NY 10001' };
    const parsed = parseClergyDetail(cityOnly);
    expect(parsed.address).toBeNull();
    expect(parsed.city).toBe('New York');
    expect(parsed.state).toBe('NY');
    expect(parsed.zip).toBe('10001');
  });
});

// ---------------------------------------------------------------------------
// upsertClergy
// ---------------------------------------------------------------------------
describe('upsertClergy()', () => {
  const listData = {
    guid: 'abc-123',
    first_name: 'Jane',
    middle_name: 'A',
    last_name: 'Smith',
  };

  const detailData = {
    email: 'jane@church.org',
    canonical_residence: 'New York',
    address: '123 Church St',
    city: 'New York',
    state: 'NY',
    zip: '10001',
    country: null,
    diaconate_date: '06/15/2010',
    diaconate_bishop: 'Mark Sisk',
    diaconate_diocese: 'New York',
    priesting_date: '12/20/2010',
    priesting_bishop: 'Mark Sisk',
    priesting_diocese: 'New York',
    bishop_consecration_date: null,
    bishop_consecration_diocese: null,
    positions: [
      {
        position_title: 'Rector',
        employer_name: 'Trinity Church',
        employer_id: '9870396045',
        employer_address: '75 Broadway',
        employer_phone: '212-555-0100',
        start_date: '01/01/2018',
        end_date: null,
        is_current: 1,
      },
    ],
  };

  it('inserts a new clergy record and positions', () => {
    const db = getDb();
    const result = upsertClergy(db, { ...listData, ...detailData });
    expect(result).toBe('new');

    const row = db.prepare('SELECT * FROM clergy WHERE guid = ?').get('abc-123');
    expect(row).toBeDefined();
    expect(row.first_name).toBe('Jane');
    expect(row.middle_name).toBe('A');
    expect(row.last_name).toBe('Smith');
    expect(row.email).toBe('jane@church.org');
    expect(row.canonical_residence).toBe('New York');
    expect(row.diaconate_date).toBe('06/15/2010');

    const positions = db.prepare('SELECT * FROM clergy_positions WHERE clergy_guid = ?').all('abc-123');
    expect(positions).toHaveLength(1);
    expect(positions[0].position_title).toBe('Rector');
    expect(positions[0].employer_name).toBe('Trinity Church');
    expect(positions[0].is_current).toBe(1);
    expect(positions[0].parish_id).toBeNull();
  });

  it('updates existing clergy without overwriting non-empty fields with empty strings', () => {
    const db = getDb();
    upsertClergy(db, { ...listData, ...detailData });

    // Update with some empty fields
    const result = upsertClergy(db, {
      ...listData,
      ...detailData,
      email: '',
      canonical_residence: 'Connecticut',
    });
    expect(result).toBe('updated');

    const row = db.prepare('SELECT * FROM clergy WHERE guid = ?').get('abc-123');
    // email should be preserved (COALESCE/NULLIF)
    expect(row.email).toBe('jane@church.org');
    // canonical_residence should be updated
    expect(row.canonical_residence).toBe('Connecticut');
  });

  it('replaces all positions on update', () => {
    const db = getDb();
    upsertClergy(db, { ...listData, ...detailData });

    // Update with different positions
    const newPositions = [
      {
        position_title: 'Dean',
        employer_name: 'Cathedral of St. John',
        employer_id: '1111111111',
        employer_address: '1047 Amsterdam Ave',
        employer_phone: '212-555-0200',
        start_date: '01/01/2023',
        end_date: null,
        is_current: 1,
      },
      {
        position_title: 'Rector',
        employer_name: 'Trinity Church',
        employer_id: '9870396045',
        employer_address: '75 Broadway',
        employer_phone: '212-555-0100',
        start_date: '01/01/2018',
        end_date: '12/31/2022',
        is_current: 0,
      },
    ];

    upsertClergy(db, { ...listData, ...detailData, positions: newPositions });

    const positions = db.prepare(
      'SELECT * FROM clergy_positions WHERE clergy_guid = ? ORDER BY start_date DESC'
    ).all('abc-123');
    expect(positions).toHaveLength(2);
    expect(positions[0].position_title).toBe('Dean');
    expect(positions[0].is_current).toBe(1);
    expect(positions[1].position_title).toBe('Rector');
    expect(positions[1].is_current).toBe(0);
  });

  it('handles clergy with no positions', () => {
    const db = getDb();
    const result = upsertClergy(db, { ...listData, ...detailData, positions: [] });
    expect(result).toBe('new');

    const positions = db.prepare('SELECT * FROM clergy_positions WHERE clergy_guid = ?').all('abc-123');
    expect(positions).toHaveLength(0);
  });
});
