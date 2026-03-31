import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// DATA_DIR mirrors what enrich-positions-v2.js computes from its own __dirname
const DATA_DIR = path.resolve(__dirname, '../../public/data');

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

  // ---------------------------------------------------------------------------
  // Helpers used by the file-backed tests below
  // ---------------------------------------------------------------------------

  function withTempDataFile(filename, content, fn) {
    const filePath = path.join(DATA_DIR, filename);
    const existed = fs.existsSync(filePath);
    const original = existed ? fs.readFileSync(filePath) : null;
    fs.writeFileSync(filePath, JSON.stringify(content));
    try {
      return fn(filePath);
    } finally {
      if (existed) {
        fs.writeFileSync(filePath, original);
      } else {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // computeDiocesePercentiles
  // ---------------------------------------------------------------------------

  describe('computeDiocesePercentiles', () => {
    it('is a no-op when parochial-data.json is absent', () => {
      const filePath = path.join(DATA_DIR, 'parochial-data.json');
      const existed = fs.existsSync(filePath);
      const original = existed ? fs.readFileSync(filePath) : null;
      if (existed) fs.unlinkSync(filePath);
      try {
        const positions = [{ diocese: 'Virginia', parochial: { years: { '2023': { averageAttendance: 100 } } } }];
        expect(() => computeDiocesePercentiles(positions)).not.toThrow();
        expect(positions[0].diocese_percentiles).toBeUndefined();
      } finally {
        if (existed && original !== null) fs.writeFileSync(filePath, original);
      }
    });

    it('computes percentile rankings within a diocese', () => {
      const parochialData = {
        congregations: [
          { diocese: 'Virginia', years: { '2023': { averageAttendance: 50, plateAndPledge: 100000, membership: 200 } } },
          { diocese: 'Virginia', years: { '2023': { averageAttendance: 100, plateAndPledge: 200000, membership: 400 } } },
          { diocese: 'Virginia', years: { '2023': { averageAttendance: 200, plateAndPledge: 400000, membership: 800 } } },
          { diocese: 'Virginia', years: { '2023': { averageAttendance: 300, plateAndPledge: 600000, membership: 1200 } } },
        ],
      };

      withTempDataFile('parochial-data.json', parochialData, () => {
        const positions = [
          {
            diocese: 'Virginia',
            parochial: { years: { '2023': { averageAttendance: 200, plateAndPledge: 400000, membership: 800 } } },
          },
          {
            diocese: 'Virginia',
            parochial: { years: { '2023': { averageAttendance: 50, plateAndPledge: 100000, membership: 200 } } },
          },
          // Position with no diocese -- should be skipped
          { parochial: { years: { '2023': { averageAttendance: 150 } } } },
        ];

        computeDiocesePercentiles(positions);

        // ASA=200 is the 3rd of 4 values [50,100,200,300] => 2 values below => 50th percentile
        expect(positions[0].diocese_percentiles).toBeDefined();
        expect(positions[0].diocese_percentiles.asa).toBe(50);
        expect(positions[0].diocese_percentiles.asa_value).toBe(200);

        // ASA=50 is the 1st of 4 => 0 values below => 0th percentile
        expect(positions[1].diocese_percentiles).toBeDefined();
        expect(positions[1].diocese_percentiles.asa).toBe(0);

        // Position with no diocese gets no percentiles
        expect(positions[2].diocese_percentiles).toBeUndefined();
      });
    });

    it('skips positions with no parochial data', () => {
      const parochialData = {
        congregations: [
          { diocese: 'Virginia', years: { '2023': { averageAttendance: 100 } } },
        ],
      };

      withTempDataFile('parochial-data.json', parochialData, () => {
        const positions = [
          { diocese: 'Virginia' }, // no parochial field
          { diocese: 'Virginia', parochial: { years: {} } }, // empty years
        ];
        computeDiocesePercentiles(positions);
        expect(positions[0].diocese_percentiles).toBeUndefined();
        expect(positions[1].diocese_percentiles).toBeUndefined();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // attachCensusData
  // ---------------------------------------------------------------------------

  describe('attachCensusData', () => {
    it('is a no-op when census-data.json is absent', () => {
      const filePath = path.join(DATA_DIR, 'census-data.json');
      const existed = fs.existsSync(filePath);
      const original = existed ? fs.readFileSync(filePath) : null;
      if (existed) fs.unlinkSync(filePath);
      try {
        const positions = [{ church_info: { zip: '22314' } }];
        expect(() => attachCensusData(positions)).not.toThrow();
        expect(positions[0].census).toBeUndefined();
      } finally {
        if (existed && original !== null) fs.writeFileSync(filePath, original);
      }
    });

    it('attaches census data by zip from church_info', () => {
      const censusData = {
        '22314': { population: 50000, median_income: 85000, median_age: 38 },
        '23220': { population: 30000, median_income: 62000, median_age: 35 },
      };

      withTempDataFile('census-data.json', censusData, () => {
        const positions = [
          { church_info: { zip: '22314' } },
          { postal_code: '23220' },
          { church_info: { zip: '99999' } }, // no match
          { church_info: {} }, // no zip
        ];

        attachCensusData(positions);

        expect(positions[0].census).toEqual({ population: 50000, median_income: 85000, median_age: 38 });
        expect(positions[1].census).toEqual({ population: 30000, median_income: 62000, median_age: 35 });
        expect(positions[2].census).toBeUndefined();
        expect(positions[3].census).toBeUndefined();
      });
    });

    it('normalises zip codes by stripping non-digits and truncating to 5', () => {
      const censusData = { '22314': { population: 50000 } };

      withTempDataFile('census-data.json', censusData, () => {
        const positions = [
          { church_info: { zip: '22314-1234' } }, // zip+4 format
        ];

        attachCensusData(positions);

        expect(positions[0].census).toEqual({ population: 50000 });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // enrichPositions pipeline
  // ---------------------------------------------------------------------------

  describe('enrichPositions', () => {
    const OUTPUT_FILES = ['enriched-positions.json', 'enriched-extended.json', 'needs-backfill.json'];

    // Save and restore all data files touched by the pipeline
    let savedFiles;

    beforeEach(() => {
      savedFiles = {};
      const filesToSave = [
        'positions.json', 'all-profiles.json', 'profile-fields.json',
        'manual-diocese-overrides.json', 'manual-vh-ids.json',
        ...OUTPUT_FILES,
      ];
      for (const name of filesToSave) {
        const p = path.join(DATA_DIR, name);
        savedFiles[name] = fs.existsSync(p) ? fs.readFileSync(p) : null;
      }
    });

    afterEach(() => {
      for (const [name, content] of Object.entries(savedFiles)) {
        const p = path.join(DATA_DIR, name);
        if (content !== null) {
          fs.writeFileSync(p, content);
        } else {
          try { fs.unlinkSync(p); } catch { /* ignore */ }
        }
      }
    });

    it('runs without error on empty positions.json and writes output files', () => {
      seedDB();

      // Write minimal input files
      fs.writeFileSync(path.join(DATA_DIR, 'positions.json'), JSON.stringify([]));
      fs.writeFileSync(path.join(DATA_DIR, 'all-profiles.json'), JSON.stringify([]));

      const { enrichPositions } = require('../enrich-positions-v2.js');
      expect(() => enrichPositions()).not.toThrow();

      // All three output files should have been written
      for (const name of OUTPUT_FILES) {
        expect(fs.existsSync(path.join(DATA_DIR, name))).toBe(true);
      }

      const enrichedPositions = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'enriched-positions.json'), 'utf-8'));
      expect(Array.isArray(enrichedPositions)).toBe(true);
      expect(enrichedPositions).toHaveLength(0);
    });

    it('enriches a single public position and produces gap report', () => {
      seedDB();

      const positions = [
        {
          id: 'p1',
          vh_id: 1001,
          name: "St. Paul's (Alexandria)",
          diocese: 'Virginia',
          state: 'VA',
          website_url: 'http://stpauls.org',
          contact_email: '',
          contact_phone: '',
          receiving_names_from: '01/01/2025',
          receiving_names_to: '12/31/2026',
          minimum_stipend: '$60,000',
          maximum_stipend: '$80,000',
          housing_type: '',
        },
      ];
      fs.writeFileSync(path.join(DATA_DIR, 'positions.json'), JSON.stringify(positions));
      fs.writeFileSync(path.join(DATA_DIR, 'all-profiles.json'), JSON.stringify([]));

      const { enrichPositions } = require('../enrich-positions-v2.js');
      expect(() => enrichPositions()).not.toThrow();

      const enriched = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'enriched-positions.json'), 'utf-8'));
      expect(enriched).toHaveLength(1);
      expect(enriched[0].name).toBe("St. Paul's (Alexandria)");
      // Should have been matched to the seeded parish
      expect(enriched[0].church_info).toBeDefined();
      expect(enriched[0].estimated_total_comp).toBe(70000);

      // Gap report should exist and have a summary
      const gapReport = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'needs-backfill.json'), 'utf-8'));
      expect(gapReport.summary).toBeDefined();
      expect(typeof gapReport.summary.total).toBe('number');
      expect(gapReport.gaps).toBeInstanceOf(Array);
    });

    it('generates gap entries for positions missing a VH ID', () => {
      seedDB();

      const positions = [
        {
          id: 'p-no-vh',
          name: 'Unknown Church',
          diocese: 'Virginia',
          state: 'VA',
          // no vh_id, no profile_url
        },
      ];
      fs.writeFileSync(path.join(DATA_DIR, 'positions.json'), JSON.stringify(positions));
      fs.writeFileSync(path.join(DATA_DIR, 'all-profiles.json'), JSON.stringify([]));

      const { enrichPositions } = require('../enrich-positions-v2.js');
      enrichPositions();

      const gapReport = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'needs-backfill.json'), 'utf-8'));
      expect(gapReport.summary.missing_vh_id).toBe(1);
      const missingEntry = gapReport.gaps.find(g => g.type === 'missing_vh_id');
      expect(missingEntry).toBeDefined();
      expect(missingEntry.id).toBe('p-no-vh');
    });
  });
});
