import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

// Use createRequire so db.js and enrich-positions-v2.js share the same
// CJS module cache (and thus the same DB singleton).
const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../db.js');
const {
  attachCompensation,
  attachClergyInfo,
  matchPositionToParish,
  parseStipend,
  fixBogusYear,
  parseMMDDYYYY,
  computeEstimatedTotalComp,
  computeQualityScores,
  computeSimilarPositions,
  attachCensusData,
  computeDiocesePercentiles,
  isGenericDomain,
} = require('../enrich-positions-v2.js');

let testDbPath;

function seedDB() {
  const db = getDb();

  db.prepare(`INSERT INTO parishes (id, nid, ecdplus_id, name, diocese, city, state, zip, phone, email, website, lat, lng, source)
    VALUES (1, '1001', 'E001', 'St. Paul''s', 'Virginia', 'Alexandria', 'VA', '22314', '703-555-0100', 'office@stpauls.org', 'http://stpauls.org', 38.8, -77.04, 'both')`).run();

  db.prepare(`INSERT INTO parishes (id, nid, ecdplus_id, name, diocese, city, state, zip, phone, email, website, lat, lng, source)
    VALUES (2, '1002', 'E002', 'Grace Church', 'Virginia', 'Richmond', 'VA', '23220', '804-555-0200', 'info@gracechurchrva.org', 'http://gracechurchrva.org', 37.5, -77.4, 'both')`).run();

  db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
    VALUES (1, 'St. Paul''s', 'st paul', 'asset-map')`).run();

  db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
    VALUES (2, 'Grace Church', 'grace', 'asset-map')`).run();

  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership)
    VALUES ('St. Paul''s (Alexandria)', 2023, 150, 400000, 500)`).run();

  db.prepare(`INSERT INTO compensation_diocesan (year, diocese, province, female_median, female_count, male_median, male_count, all_median, all_count)
    VALUES (2023, 'Virginia', 'III', 85000, 60, 95000, 70, 90000, 130)`).run();

  db.prepare(`INSERT INTO clergy (guid, first_name, last_name, canonical_residence)
    VALUES ('clergy-001', 'Jane', 'Smith', 'Virginia')`).run();

  db.prepare(`INSERT INTO clergy_positions (clergy_guid, parish_id, position_title, employer_name, start_date, end_date, is_current)
    VALUES ('clergy-001', 1, 'Rector', 'St. Paul''s', '01/01/2018', NULL, 1)`).run();

  db.prepare(`INSERT INTO clergy (guid, first_name, last_name, canonical_residence)
    VALUES ('clergy-002', 'John', 'Doe', 'Virginia')`).run();

  db.prepare(`INSERT INTO clergy_positions (clergy_guid, parish_id, position_title, employer_name, start_date, end_date, is_current)
    VALUES ('clergy-002', 1, 'Rector', 'St. Paul''s', '01/01/2006', '12/31/2017', 0)`).run();

  return db;
}

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `vocationhub-enrich-v2-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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

describe('enrich-positions-v2', () => {
  describe('attachCompensation', () => {
    it('adds diocese median for matching diocese', () => {
      seedDB();
      const position = { diocese: 'Virginia' };
      const result = attachCompensation(position);
      expect(result.compensation.diocese_median).toBe(90000);
      expect(result.compensation.diocese_female_median).toBe(85000);
      expect(result.compensation.diocese_male_median).toBe(95000);
      expect(result.compensation.diocese_clergy_count).toBe(130);
      expect(result.compensation.year).toBe(2023);
    });

    it('returns position unchanged for unknown diocese', () => {
      seedDB();
      const position = { diocese: 'Narnia' };
      const result = attachCompensation(position);
      expect(result.compensation).toBeUndefined();
    });

    it('is case-insensitive on diocese name', () => {
      seedDB();
      const position = { diocese: 'virginia' };
      const result = attachCompensation(position);
      expect(result.compensation).toBeDefined();
      expect(result.compensation.diocese_median).toBe(90000);
    });
  });

  describe('attachClergyInfo', () => {
    it('returns current clergy and history', () => {
      seedDB();
      const result = attachClergyInfo(1);
      expect(result.current_clergy).toBeTruthy();
      expect(result.current_clergy.name).toBe('Jane Smith');
      expect(result.current_clergy.position_title).toBe('Rector');
      expect(result.parish_clergy_history.recent_count).toBe(2);
      expect(result.parish_clergy_history.avg_tenure_years).toBeGreaterThan(0);
    });

    it('returns null current_clergy for vacant parish', () => {
      const db = seedDB();
      db.prepare("UPDATE clergy_positions SET is_current = 0, end_date = '12/31/2025' WHERE clergy_guid = 'clergy-001'").run();
      const result = attachClergyInfo(1);
      expect(result.current_clergy).toBeNull();
      expect(result.parish_clergy_history.recent_count).toBe(2);
    });

    it('returns zeroed history for parish with no clergy', () => {
      seedDB();
      const result = attachClergyInfo(999);
      expect(result.current_clergy).toBeNull();
      expect(result.parish_clergy_history.recent_count).toBe(0);
      expect(result.parish_clergy_history.avg_tenure_years).toBe(0);
    });
  });

  describe('matchPositionToParish', () => {
    it('finds parish by website', () => {
      seedDB();
      const position = {
        name: "St. Paul's (Alexandria)",
        diocese: 'Virginia',
        website_url: 'http://stpauls.org',
      };
      const match = matchPositionToParish(position);
      expect(match).toBeTruthy();
      expect(match.parish.id).toBe(1);
      expect(match.confidence).toBe('exact');
      expect(match.method).toBe('website');
    });

    it('finds parish by email domain', () => {
      seedDB();
      const position = {
        name: "St. Paul's",
        diocese: 'Virginia',
        contact_email: 'rector@stpauls.org',
      };
      const match = matchPositionToParish(position);
      expect(match).toBeTruthy();
      expect(match.parish.id).toBe(1);
      expect(match.confidence).toBe('exact');
      expect(match.method).toBe('email');
    });

    it('skips generic email domains', () => {
      seedDB();
      const position = {
        name: "St. Paul's",
        diocese: 'Virginia',
        contact_email: 'rector@gmail.com',
      };
      // Should not match on gmail -- will fall through to name matching
      const match = matchPositionToParish(position);
      // May or may not match by name; the key is it should NOT match by email
      if (match) {
        expect(match.method).not.toBe('email');
      }
    });

    it('finds parish by phone within diocese', () => {
      seedDB();
      const position = {
        name: "St. Paul's",
        diocese: 'Virginia',
        contact_phone: '(703) 555-0100',
      };
      const match = matchPositionToParish(position);
      expect(match).toBeTruthy();
      expect(match.parish.id).toBe(1);
      expect(match.confidence).toBe('exact');
      expect(match.method).toBe('phone');
    });

    it('finds parish by name + diocese via aliases', () => {
      seedDB();
      const position = {
        name: "St. Paul's Episcopal Church",
        diocese: 'Virginia',
      };
      const match = matchPositionToParish(position);
      expect(match).toBeTruthy();
      expect(match.parish.id).toBe(1);
      expect(match.method).toBe('name_diocese');
    });

    it('returns null for unmatched position', () => {
      seedDB();
      const position = {
        name: 'Nonexistent Church',
        diocese: 'Montana',
      };
      const match = matchPositionToParish(position);
      expect(match).toBeNull();
    });

    it('disambiguates by city when multiple name matches', () => {
      const db = seedDB();
      // Add another St. Paul's in a different city, same diocese
      db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
        VALUES (3, '1003', 'St. Paul''s', 'Virginia', 'Fairfax', 'VA', 'asset-map')`).run();
      db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
        VALUES (3, 'St. Paul''s', 'st paul', 'asset-map')`).run();

      const position = {
        name: "St. Paul's (Alexandria)",
        diocese: 'Virginia',
      };
      const match = matchPositionToParish(position);
      expect(match).toBeTruthy();
      expect(match.parish.id).toBe(1);
      expect(match.method).toBe('name_diocese_city');
    });
  });

  describe('parseStipend', () => {
    it('parses dollar amounts', () => {
      expect(parseStipend('$50,000')).toBe(50000);
      expect(parseStipend('75000')).toBe(75000);
      expect(parseStipend('$120,500.50')).toBe(120500.5);
    });

    it('returns null for non-numeric values', () => {
      expect(parseStipend('DOE')).toBeNull();
      expect(parseStipend('TBD')).toBeNull();
      expect(parseStipend('Negotiable')).toBeNull();
      expect(parseStipend(null)).toBeNull();
      expect(parseStipend('')).toBeNull();
    });
  });

  describe('fixBogusYear', () => {
    it('clears 01/01/1900 entirely', () => {
      expect(fixBogusYear('01/01/1900')).toBe('');
    });

    it('clears range of 01/01/1900 to 01/01/1900', () => {
      expect(fixBogusYear('01/01/1900 to 01/01/1900')).toBe('');
    });

    it('fixes other /1900 dates to current year', () => {
      const currentYear = new Date().getFullYear();
      expect(fixBogusYear('06/15/1900')).toBe(`06/15/${currentYear}`);
    });

    it('leaves normal dates unchanged', () => {
      expect(fixBogusYear('03/15/2025')).toBe('03/15/2025');
    });

    it('returns empty input unchanged', () => {
      expect(fixBogusYear('')).toBe('');
      expect(fixBogusYear(null)).toBeNull();
    });
  });

  describe('parseMMDDYYYY', () => {
    it('parses valid dates', () => {
      const d = parseMMDDYYYY('03/15/2025');
      expect(d).toBeInstanceOf(Date);
      expect(d.getFullYear()).toBe(2025);
      expect(d.getMonth()).toBe(2); // 0-indexed
      expect(d.getDate()).toBe(15);
    });

    it('returns null for invalid input', () => {
      expect(parseMMDDYYYY(null)).toBeNull();
      expect(parseMMDDYYYY('')).toBeNull();
      expect(parseMMDDYYYY('not-a-date')).toBeNull();
    });
  });

  describe('isGenericDomain', () => {
    it('detects generic email domains', () => {
      expect(isGenericDomain('gmail.com')).toBe(true);
      expect(isGenericDomain('yahoo.com')).toBe(true);
      expect(isGenericDomain('outlook.com')).toBe(true);
    });

    it('detects diocesan domains', () => {
      expect(isGenericDomain('diomass.org')).toBe(true);
      expect(isGenericDomain('episcopalchurch.org')).toBe(true);
    });

    it('allows church-specific domains', () => {
      expect(isGenericDomain('stpauls.org')).toBe(false);
      expect(isGenericDomain('gracechurchrva.org')).toBe(false);
    });
  });

  describe('computeEstimatedTotalComp', () => {
    it('computes comp from min/max stipend', () => {
      const positions = [{
        vh_id: 1,
        minimum_stipend: '$50,000',
        maximum_stipend: '$70,000',
        housing_type: '',
      }];
      computeEstimatedTotalComp(positions, {});
      expect(positions[0].estimated_total_comp).toBe(60000);
      expect(positions[0].comp_breakdown.stipend).toBe(60000);
    });

    it('adds housing value when rectory provided', () => {
      const positions = [{
        vh_id: 1,
        minimum_stipend: '$50,000',
        maximum_stipend: '$70,000',
        housing_type: 'Rectory provided',
      }];
      computeEstimatedTotalComp(positions, {});
      expect(positions[0].estimated_total_comp).toBe(80000);
      expect(positions[0].comp_breakdown.housing).toBe(20000);
    });

    it('parses salary_range as fallback', () => {
      const positions = [{
        vh_id: 1,
        salary_range: '$60,000 - $80,000',
        housing_type: '',
      }];
      computeEstimatedTotalComp(positions, {});
      expect(positions[0].estimated_total_comp).toBe(70000);
    });
  });

  describe('computeQualityScores', () => {
    it('gives public positions score 100', () => {
      const positions = [{ name: 'Test', diocese: 'Virginia' }];
      computeQualityScores(positions, true);
      expect(positions[0].quality_score).toBe(100);
      expect(positions[0].visibility).toBe('public');
    });

    it('scores extended positions based on rubric', () => {
      const positions = [{
        name: "St. Paul's",
        diocese: 'Virginia',
        vh_status: 'Receiving names',
        receiving_names_from: new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
        church_info: { name: "St. Paul's" },
        parochial: { years: { '2023': { averageAttendance: 100 } } },
        position_type: 'Rector',
        state: 'VA',
        match_confidence: 'exact',
        receiving_names_to: '12/31/2026',
      }];
      computeQualityScores(positions, false);
      expect(positions[0].quality_score).toBeGreaterThanOrEqual(50);
      expect(positions[0].visibility).toBe('extended');
    });

    it('hides low-quality extended positions', () => {
      const positions = [{
        name: 'Position in Unknown',
        diocese: '',
        vh_status: 'Developing profile',
      }];
      computeQualityScores(positions, false);
      expect(positions[0].quality_score).toBeLessThan(50);
      expect(positions[0].visibility).toBe('extended_hidden');
    });
  });

  describe('computeSimilarPositions', () => {
    it('finds similar positions by ASA and state', () => {
      const positions = [
        {
          id: 'a', vh_id: 1, parochial: { years: { '2023': { averageAttendance: 100 } } },
          estimated_total_comp: 70000, church_info: { state: 'VA', name: 'Church A', city: 'City A' },
          state: 'VA', position_type: 'Rector', housing_type: 'Rectory',
        },
        {
          id: 'b', vh_id: 2, parochial: { years: { '2023': { averageAttendance: 110 } } },
          estimated_total_comp: 72000, church_info: { state: 'VA', name: 'Church B', city: 'City B' },
          state: 'VA', position_type: 'Rector', housing_type: 'Rectory',
        },
        {
          id: 'c', vh_id: 3, parochial: { years: { '2023': { averageAttendance: 500 } } },
          estimated_total_comp: 150000, church_info: { state: 'CA', name: 'Church C', city: 'City C' },
          state: 'CA', position_type: 'Dean', housing_type: '',
        },
      ];
      computeSimilarPositions(positions);
      expect(positions[0].similar_positions).toBeDefined();
      expect(positions[0].similar_positions.length).toBeGreaterThanOrEqual(1);
      expect(positions[0].similar_positions[0].id).toBe('b');
    });
  });
});
