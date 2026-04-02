import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../../db.js');
const matchParishes = require('../../stages/match-parishes.js');
const {
  matchPositionToParish,
  matchPositionToParishes,
  buildChurchInfo,
  normalizeDioceseName,
  isGenericDomain,
  extractCity,
} = matchParishes;

let testDbPath;
let db;

function seedDB() {
  db = getDb();

  db.prepare(`INSERT INTO parishes (id, nid, ecdplus_id, name, diocese, city, state, zip, phone, email, website, lat, lng, source)
    VALUES (1, '1001', 'E001', 'St. Paul''s', 'Diocese of Virginia', 'Alexandria', 'VA', '22314', '703-555-0100', 'office@stpauls-alexandria.org', 'http://stpauls-alexandria.org', 38.8, -77.04, 'both')`).run();

  db.prepare(`INSERT INTO parishes (id, nid, ecdplus_id, name, diocese, city, state, zip, phone, email, website, lat, lng, source)
    VALUES (2, '1002', 'E002', 'Grace Church', 'Diocese of Virginia', 'Richmond', 'VA', '23220', '804-555-0200', 'info@gracechurchrva.org', 'http://gracechurchrva.org', 37.5, -77.4, 'both')`).run();

  db.prepare(`INSERT INTO parishes (id, nid, ecdplus_id, name, diocese, city, state, zip, phone, email, website, lat, lng, source)
    VALUES (3, '1003', 'E003', 'Trinity Church', 'Diocese of Connecticut', 'Hartford', 'CT', '06103', '860-555-0300', 'info@trinityhartford.org', 'http://trinityhartford.org', 41.76, -72.68, 'both')`).run();

  db.prepare(`INSERT INTO parishes (id, nid, ecdplus_id, name, diocese, city, state, zip, phone, email, website, lat, lng, source)
    VALUES (4, '1004', 'E004', 'Christ Church', 'Diocese of Connecticut', 'Glastonbury', 'CT', '06033', '860-555-0400', 'info@christglastonbury.org', 'http://christglastonbury.org', 41.71, -72.60, 'both')`).run();

  // Aliases
  db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source) VALUES (1, 'St. Paul''s', 'st paul', 'asset-map')`).run();
  db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source) VALUES (2, 'Grace Church', 'grace', 'asset-map')`).run();
  db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source) VALUES (3, 'Trinity Church', 'trinity', 'asset-map')`).run();
  db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source) VALUES (4, 'Christ Church', 'christ', 'asset-map')`).run();

  return db;
}

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `vocationhub-match-parishes-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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
// matchPositionToParish
// ---------------------------------------------------------------------------

describe('matchPositionToParish', () => {
  it('matches by website', () => {
    const pos = {
      name: 'Some Position',
      diocese: 'Virginia',
      website_url: 'https://www.stpauls-alexandria.org/jobs',
      contact_email: '',
      contact_phone: '',
    };
    const result = matchPositionToParish(pos, db);
    expect(result).not.toBeNull();
    expect(result.parish.id).toBe(1);
    expect(result.confidence).toBe('exact');
    expect(result.method).toBe('website');
  });

  it('matches by email domain', () => {
    const pos = {
      name: 'Some Position',
      diocese: 'Virginia',
      website_url: '',
      contact_email: 'rector@gracechurchrva.org',
      contact_phone: '',
    };
    const result = matchPositionToParish(pos, db);
    expect(result).not.toBeNull();
    expect(result.parish.id).toBe(2);
    expect(result.confidence).toBe('exact');
    expect(result.method).toBe('email');
  });

  it('matches by name + diocese via aliases', () => {
    const pos = {
      name: 'Grace Church',
      diocese: 'Virginia',
      website_url: '',
      contact_email: '',
      contact_phone: '',
    };
    const result = matchPositionToParish(pos, db);
    expect(result).not.toBeNull();
    expect(result.parish.id).toBe(2);
    expect(result.confidence).toBe('high');
    expect(result.method).toBe('name_diocese');
  });

  it('returns null for unmatched position', () => {
    const pos = {
      name: 'Nonexistent Church',
      diocese: 'Unknown Diocese',
      website_url: '',
      contact_email: '',
      contact_phone: '',
    };
    const result = matchPositionToParish(pos, db);
    expect(result).toBeNull();
  });

  it('skips generic email domains', () => {
    const pos = {
      name: 'Some Position',
      diocese: 'Virginia',
      website_url: '',
      contact_email: 'rector@gmail.com',
      contact_phone: '',
    };
    const result = matchPositionToParish(pos, db);
    // Should not match by email since gmail is generic; may match by other strategy or return null
    if (result) {
      expect(result.method).not.toBe('email');
    }
  });

  it('matches by phone within same diocese', () => {
    const pos = {
      name: 'Unknown Name',
      diocese: 'Virginia',
      website_url: '',
      contact_email: '',
      contact_phone: '(703) 555-0100',
    };
    const result = matchPositionToParish(pos, db);
    expect(result).not.toBeNull();
    expect(result.parish.id).toBe(1);
    expect(result.confidence).toBe('exact');
    expect(result.method).toBe('phone');
  });
});

// ---------------------------------------------------------------------------
// matchPositionToParishes (multi-parish)
// ---------------------------------------------------------------------------

describe('matchPositionToParishes', () => {
  it('splits name on " and " and matches multiple parishes', () => {
    const pos = {
      name: 'Trinity and Christ, Diocese of Connecticut',
      diocese: 'Connecticut',
      website_url: '',
      contact_email: '',
      contact_phone: '',
    };
    const results = matchPositionToParishes(pos, db);
    expect(results.length).toBe(2);
    const ids = results.map(r => r.parish.id).sort();
    expect(ids).toEqual([3, 4]);
  });

  it('does not split "Saints X and Y" names', () => {
    // Add a parish with a saints name
    db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source) VALUES (5, '1005', 'Saints Peter and Paul', 'Diocese of Virginia', 'Arlington', 'VA', 'both')`).run();
    db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source) VALUES (5, 'Saints Peter and Paul', 'st peter paul', 'asset-map')`).run();

    const pos = {
      name: 'Saints Peter and Paul',
      diocese: 'Virginia',
      website_url: '',
      contact_email: '',
      contact_phone: '',
    };
    const results = matchPositionToParishes(pos, db);
    // Should match as a single parish, not split
    expect(results.length).toBe(1);
    expect(results[0].parish.id).toBe(5);
  });

  it('returns empty array for unmatched position', () => {
    const pos = {
      name: 'Nonexistent Church',
      diocese: 'Unknown Diocese',
      website_url: '',
      contact_email: '',
      contact_phone: '',
    };
    const results = matchPositionToParishes(pos, db);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// matchParishes (stage entry point)
// ---------------------------------------------------------------------------

describe('matchParishes stage', () => {
  it('enriches positions with church_infos, confidence, method, and _parish_ids', () => {
    const positions = [
      {
        name: "St. Paul's",
        diocese: 'Virginia',
        website_url: '',
        contact_email: '',
        contact_phone: '',
      },
    ];
    const result = matchParishes(positions, db);
    expect(result).toHaveLength(1);
    expect(result[0].church_infos).toHaveLength(1);
    expect(result[0].church_infos[0].name).toBe("St. Paul's");
    expect(result[0].church_infos[0].city).toBe('Alexandria');
    expect(result[0].match_confidence).toBe('high');
    expect(result[0].match_method).toBe('name_diocese');
    expect(result[0]._parish_ids).toEqual([1]);
  });

  it('sets empty arrays for unmatched positions', () => {
    const positions = [
      {
        name: 'Nonexistent',
        diocese: 'Unknown',
        website_url: '',
        contact_email: '',
        contact_phone: '',
      },
    ];
    const result = matchParishes(positions, db);
    expect(result[0].church_infos).toEqual([]);
    expect(result[0].match_confidence).toBeNull();
    expect(result[0].match_method).toBeNull();
    expect(result[0]._parish_ids).toEqual([]);
  });

  it('handles multi-parish positions', () => {
    const positions = [
      {
        name: 'Trinity and Christ, Diocese of Connecticut',
        diocese: 'Connecticut',
        website_url: '',
        contact_email: '',
        contact_phone: '',
      },
    ];
    const result = matchParishes(positions, db);
    expect(result[0].church_infos).toHaveLength(2);
    expect(result[0]._parish_ids.sort()).toEqual([3, 4]);
  });
});

// ---------------------------------------------------------------------------
// Helper unit tests
// ---------------------------------------------------------------------------

describe('normalizeDioceseName', () => {
  it('strips "Diocese of" prefix', () => {
    expect(normalizeDioceseName('Diocese of Virginia')).toBe('virginia');
  });

  it('strips "Episcopal Diocese of" prefix', () => {
    expect(normalizeDioceseName('Episcopal Diocese of North Carolina')).toBe('north carolina');
  });

  it('handles short form', () => {
    expect(normalizeDioceseName('Virginia')).toBe('virginia');
  });
});

describe('isGenericDomain', () => {
  it('returns true for gmail', () => {
    expect(isGenericDomain('gmail.com')).toBe(true);
  });

  it('returns true for diocesan domains', () => {
    expect(isGenericDomain('diova.org')).toBe(true);
  });

  it('returns false for parish-specific domains', () => {
    expect(isGenericDomain('stpauls-alexandria.org')).toBe(false);
  });

  it('returns true for null/empty', () => {
    expect(isGenericDomain('')).toBe(true);
    expect(isGenericDomain(null)).toBe(true);
  });
});

describe('extractCity', () => {
  it('extracts parenthesized city', () => {
    expect(extractCity('St. Paul (Alexandria)')).toBe('Alexandria');
  });

  it('returns empty string when no parens', () => {
    expect(extractCity('Grace Church')).toBe('');
  });
});

describe('buildChurchInfo', () => {
  it('builds church info from parish row', () => {
    const info = buildChurchInfo({
      nid: '1001', name: "St. Paul's", address: '123 Main St',
      city: 'Alexandria', state: 'VA', zip: '22314',
      phone: '703-555-0100', email: 'office@stpauls.org',
      website: 'http://stpauls.org', type: 'Parish',
      lat: 38.8, lng: -77.04,
    });
    expect(info.nid).toBe('1001');
    expect(info.street).toBe('123 Main St');
    expect(info.city).toBe('Alexandria');
  });

  it('returns null for null input', () => {
    expect(buildChurchInfo(null)).toBeNull();
  });
});
