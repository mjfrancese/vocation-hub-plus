import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../../db.js');
const computeCompensation = require('../../stages/compute-compensation.js');
const { parseStipend, lookupDioceseComp } = computeCompensation;

let testDbPath;
let db;

function seedDB() {
  db = getDb();

  db.prepare(`
    INSERT INTO compensation_diocesan
      (year, diocese, province, female_median, female_count, male_median, male_count, all_median, all_count)
    VALUES
      (2022, 'Diocese of Virginia', 'III', 72000, 40, 78000, 60, 75000, 100)
  `).run();

  db.prepare(`
    INSERT INTO compensation_diocesan
      (year, diocese, province, female_median, female_count, male_median, male_count, all_median, all_count)
    VALUES
      (2023, 'Diocese of Virginia', 'III', 76000, 42, 81000, 62, 79000, 104)
  `).run();

  db.prepare(`
    INSERT INTO compensation_diocesan
      (year, diocese, province, female_median, female_count, male_median, male_count, all_median, all_count)
    VALUES
      (2023, 'Diocese of Connecticut', 'I', 82000, 30, 88000, 50, 85000, 80)
  `).run();

  return db;
}

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `vocationhub-compute-comp-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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
// parseStipend
// ---------------------------------------------------------------------------

describe('parseStipend', () => {
  it('returns null for null or non-string input', () => {
    expect(parseStipend(null)).toBeNull();
    expect(parseStipend(undefined)).toBeNull();
    expect(parseStipend(50000)).toBeNull();
  });

  it('returns null for sentinel strings', () => {
    expect(parseStipend('DOE')).toBeNull();
    expect(parseStipend('TBD')).toBeNull();
    expect(parseStipend('NEGOTIABLE')).toBeNull();
    expect(parseStipend('N/A')).toBeNull();
    expect(parseStipend('See position description')).toBeNull();
    expect(parseStipend('Contact the rector')).toBeNull();
    expect(parseStipend('VARIES')).toBeNull();
  });

  it('parses a plain integer string', () => {
    expect(parseStipend('55000')).toBe(55000);
  });

  it('parses a dollar-sign prefixed value', () => {
    expect(parseStipend('$65,000')).toBe(65000);
  });

  it('parses a value with commas', () => {
    expect(parseStipend('72,500')).toBe(72500);
  });

  it('parses a decimal value', () => {
    expect(parseStipend('48000.50')).toBe(48000.50);
  });

  it('returns null for zero', () => {
    expect(parseStipend('0')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseStipend('')).toBeNull();
  });

  it('returns null for a string with no leading digits', () => {
    expect(parseStipend('Competitive salary')).toBeNull();
  });

  it('extracts the leading number and ignores trailing text', () => {
    // "$50000 plus housing" -- after stripping $, comma, space -> "50000plushousing"
    // The regex matches the leading digits
    expect(parseStipend('$50,000 plus housing')).toBe(50000);
  });
});

// ---------------------------------------------------------------------------
// lookupDioceseComp
// ---------------------------------------------------------------------------

describe('lookupDioceseComp', () => {
  it('returns null for an empty string diocese', () => {
    expect(lookupDioceseComp(db, '')).toBeNull();
  });

  it('returns null for null diocese', () => {
    expect(lookupDioceseComp(db, null)).toBeNull();
  });

  it('returns null for an unknown diocese', () => {
    expect(lookupDioceseComp(db, 'Diocese of Narnia')).toBeNull();
  });

  it('returns the most recent row for a diocese with multiple years', () => {
    const row = lookupDioceseComp(db, 'Diocese of Virginia');
    expect(row).not.toBeNull();
    expect(row.year).toBe(2023);
  });

  it('maps DB columns correctly', () => {
    const row = lookupDioceseComp(db, 'Diocese of Virginia');
    expect(row.all_median).toBe(79000);
    expect(row.female_median).toBe(76000);
    expect(row.male_median).toBe(81000);
    expect(row.all_count).toBe(104);
  });

  it('performs a case-insensitive lookup', () => {
    const row = lookupDioceseComp(db, 'diocese of virginia');
    expect(row).not.toBeNull();
    expect(row.year).toBe(2023);
  });

  it('returns data for a diocese with only one year', () => {
    const row = lookupDioceseComp(db, 'Diocese of Connecticut');
    expect(row).not.toBeNull();
    expect(row.year).toBe(2023);
    expect(row.all_median).toBe(85000);
  });
});

// ---------------------------------------------------------------------------
// computeCompensation -- diocese benchmark attachment
// ---------------------------------------------------------------------------

describe('computeCompensation -- diocese benchmarks', () => {
  it('attaches compensation benchmarks for a known diocese', () => {
    const positions = [{ diocese: 'Diocese of Virginia' }];
    const result = computeCompensation(positions, db);
    expect(result[0].compensation).toEqual({
      diocese_median: 79000,
      diocese_female_median: 76000,
      diocese_male_median: 81000,
      diocese_clergy_count: 104,
      year: 2023,
    });
  });

  it('does not attach compensation for an unknown diocese', () => {
    const positions = [{ diocese: 'Diocese of Narnia' }];
    const result = computeCompensation(positions, db);
    expect(result[0].compensation).toBeUndefined();
  });

  it('does not attach compensation when diocese is absent', () => {
    const positions = [{}];
    const result = computeCompensation(positions, db);
    expect(result[0].compensation).toBeUndefined();
  });

  it('attaches compensation to multiple positions independently', () => {
    const positions = [
      { diocese: 'Diocese of Virginia' },
      { diocese: 'Diocese of Connecticut' },
      { diocese: 'Unknown' },
    ];
    const result = computeCompensation(positions, db);
    expect(result[0].compensation.diocese_median).toBe(79000);
    expect(result[1].compensation.diocese_median).toBe(85000);
    expect(result[2].compensation).toBeUndefined();
  });

  it('returns the positions array (mutates in place)', () => {
    const positions = [{ diocese: 'Diocese of Virginia' }];
    const result = computeCompensation(positions, db);
    expect(result).toBe(positions);
  });
});

// ---------------------------------------------------------------------------
// computeCompensation -- estimated total comp from minimum/maximum stipend
// ---------------------------------------------------------------------------

describe('computeCompensation -- stipend from minimum_stipend/maximum_stipend', () => {
  it('uses the average of min and max when both are present', () => {
    const positions = [{ minimum_stipend: '60000', maximum_stipend: '80000' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(70000);
    expect(positions[0].comp_breakdown.stipend).toBe(70000);
  });

  it('uses minimum_stipend alone when max is absent', () => {
    const positions = [{ minimum_stipend: '55000' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(55000);
  });

  it('uses maximum_stipend alone when min is absent', () => {
    const positions = [{ maximum_stipend: '90000' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(90000);
  });

  it('skips positions with no parseable stipend data', () => {
    const positions = [{ minimum_stipend: 'DOE', maximum_stipend: 'TBD' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBeUndefined();
    expect(positions[0].comp_breakdown).toBeUndefined();
  });

  it('skips positions with no stipend fields at all', () => {
    const positions = [{ diocese: 'Diocese of Virginia' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computeCompensation -- salary_range fallback
// ---------------------------------------------------------------------------

describe('computeCompensation -- salary_range fallback', () => {
  it('parses a hyphenated salary range', () => {
    const positions = [{ salary_range: '$60,000 - $80,000' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(70000);
  });

  it('parses a salary range with an en-dash', () => {
    const positions = [{ salary_range: '$65,000\u2013$85,000' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(75000);
  });

  it('does not use salary_range when min/max stipend already parse successfully', () => {
    const positions = [{
      minimum_stipend: '50000',
      maximum_stipend: '70000',
      salary_range: '$90,000 - $100,000',
    }];
    computeCompensation(positions, db);
    // Should use min/max average (60000), not salary_range average (95000)
    expect(positions[0].estimated_total_comp).toBe(60000);
  });
});

// ---------------------------------------------------------------------------
// computeCompensation -- all_fields Range fallback
// ---------------------------------------------------------------------------

describe('computeCompensation -- all_fields Range fallback', () => {
  it('parses a range from all_fields when no other stipend is present', () => {
    const positions = [{
      all_fields: [
        { label: 'Range', value: '$55,000 - $75,000' },
      ],
    }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(65000);
  });

  it('parses a single dollar value from all_fields Range', () => {
    const positions = [{
      all_fields: [
        { label: 'Range', value: '$62,000' },
      ],
    }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(62000);
  });

  it('ignores all_fields entries with non-Range labels', () => {
    const positions = [{
      all_fields: [
        { label: 'Housing', value: 'Rectory provided' },
        { label: 'Benefits', value: '$50,000' },
      ],
    }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computeCompensation -- profileFields fallback
// ---------------------------------------------------------------------------

describe('computeCompensation -- profileFields fallback', () => {
  it('reads minimum and maximum stipend from profileFields', () => {
    const positions = [{ vh_id: '42' }];
    const profileFields = {
      '42': [
        { label: 'Minimum Stipend', value: '58000' },
        { label: 'Maximum Stipend', value: '72000' },
      ],
    };
    computeCompensation(positions, db, profileFields);
    expect(positions[0].estimated_total_comp).toBe(65000);
  });

  it('reads a Range field from profileFields', () => {
    const positions = [{ vh_id: '99' }];
    const profileFields = {
      '99': [
        { label: 'Range', value: '$50,000 - $70,000' },
      ],
    };
    computeCompensation(positions, db, profileFields);
    expect(positions[0].estimated_total_comp).toBe(60000);
  });

  it('reads housing type from profileFields when housing_type is absent', () => {
    const positions = [{ vh_id: '77', minimum_stipend: '60000' }];
    const profileFields = {
      '77': [
        { label: 'Housing', value: 'Rectory provided' },
      ],
    };
    computeCompensation(positions, db, profileFields);
    expect(positions[0].comp_breakdown.housing).toBe(20000);
    expect(positions[0].estimated_total_comp).toBe(80000);
  });

  it('does not use profileFields when minimum_stipend already parses', () => {
    const positions = [{ vh_id: '55', minimum_stipend: '50000' }];
    const profileFields = {
      '55': [
        { label: 'Minimum Stipend', value: '99999' },
      ],
    };
    computeCompensation(positions, db, profileFields);
    // position.minimum_stipend takes priority
    expect(positions[0].estimated_total_comp).toBe(50000);
  });
});

// ---------------------------------------------------------------------------
// computeCompensation -- housing
// ---------------------------------------------------------------------------

describe('computeCompensation -- housing value', () => {
  it('adds $20,000 for a rectory housing type', () => {
    const positions = [{ minimum_stipend: '60000', housing_type: 'Rectory provided' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(80000);
    expect(positions[0].comp_breakdown).toEqual({ stipend: 60000, housing: 20000 });
  });

  it('adds $20,000 for "housing provided" type', () => {
    const positions = [{ minimum_stipend: '60000', housing_type: 'housing provided' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(80000);
  });

  it('adds $20,000 for housing type mentioning bed/bath', () => {
    const positions = [{ minimum_stipend: '60000', housing_type: '3 bed 2 bath rectory' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(80000);
  });

  it('adds $20,000 for housing type with "required"', () => {
    const positions = [{ minimum_stipend: '60000', housing_type: 'residence required' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(80000);
  });

  it('does not add housing for "no housing" type', () => {
    const positions = [{ minimum_stipend: '60000', housing_type: 'no housing provided' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(60000);
    expect(positions[0].comp_breakdown.housing).toBeUndefined();
  });

  it('does not add housing when housing_type is empty', () => {
    const positions = [{ minimum_stipend: '60000', housing_type: '' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(60000);
    expect(positions[0].comp_breakdown.housing).toBeUndefined();
  });

  it('does not add housing when housing_type is absent', () => {
    const positions = [{ minimum_stipend: '60000' }];
    computeCompensation(positions, db);
    expect(positions[0].estimated_total_comp).toBe(60000);
    expect(positions[0].comp_breakdown.housing).toBeUndefined();
  });

  it('does not include housing key in comp_breakdown when no housing', () => {
    const positions = [{ minimum_stipend: '60000' }];
    computeCompensation(positions, db);
    expect(Object.keys(positions[0].comp_breakdown)).toEqual(['stipend']);
  });
});

// ---------------------------------------------------------------------------
// computeCompensation -- combined benchmark + estimated comp
// ---------------------------------------------------------------------------

describe('computeCompensation -- benchmark and estimated comp together', () => {
  it('attaches both compensation and estimated_total_comp on the same position', () => {
    const positions = [{
      diocese: 'Diocese of Virginia',
      minimum_stipend: '70000',
      maximum_stipend: '90000',
      housing_type: 'Rectory provided',
    }];
    computeCompensation(positions, db);
    expect(positions[0].compensation.diocese_median).toBe(79000);
    expect(positions[0].estimated_total_comp).toBe(100000); // (70+90)/2=80000 + 20000
    expect(positions[0].comp_breakdown).toEqual({ stipend: 80000, housing: 20000 });
  });
});
