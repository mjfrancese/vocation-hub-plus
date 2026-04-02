import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getDb, closeDb } = require('../db.js');
const {
  runPipeline,
  writeOutput,
  loadPositions,
  buildExtendedPositions,
  readMeta,
  STAGES,
} = require('../run-enrichment.js');

let testDbPath;
let db;

function seedDB() {
  db = getDb();

  // Add parishes
  db.prepare(`INSERT INTO parishes (id, nid, ecdplus_id, name, diocese, city, state, zip, phone, email, website, lat, lng, source)
    VALUES (1, '1001', 'E001', 'St. Paul''s', 'Diocese of Virginia', 'Alexandria', 'VA', '22314', '703-555-0100', 'office@stpauls-alexandria.org', 'http://stpauls-alexandria.org', 38.8, -77.04, 'both')`).run();

  db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
    VALUES (1, 'St. Paul''s', 'st paul', 'asset-map')`).run();

  // Add scraped positions
  db.prepare(`INSERT INTO scraped_positions (vh_id, name, diocese, state, position_type, receiving_from, status)
    VALUES ('100', 'St. Paul''s (Alexandria)', 'Virginia', 'VA', 'Rector', '01/15/2026', 'Open')`).run();

  db.prepare(`INSERT INTO scraped_positions (vh_id, name, diocese, state, position_type, receiving_from, status)
    VALUES ('200', 'Grace Church (Richmond)', 'Virginia', 'VA', 'Vicar', '03/01/2026', 'Open')`).run();

  // Add scraper_meta entries
  db.prepare(`INSERT INTO scraper_meta (key, value) VALUES ('all_profiles', ?)`).run(
    JSON.stringify([
      {
        vh_id: 100,
        congregation: "St. Paul's Alexandria",
        diocese: 'Virginia',
        receiving_names_from: '01/15/2026',
        position_type: 'Rector',
      },
      {
        vh_id: 300,
        congregation: 'Trinity Church',
        diocese: 'Connecticut',
        receiving_names_from: '02/01/2026',
        order_of_ministry: 'Priest',
      },
      {
        vh_id: 400,
        congregation: '',
        diocese: '',
        receiving_names_from: '01/01/1900',
      },
    ])
  );

  db.prepare(`INSERT INTO scraper_meta (key, value) VALUES ('profile_fields', ?)`).run(
    JSON.stringify({ '100': [{ label: 'Stipend', value: '$75,000' }] })
  );

  db.prepare(`INSERT INTO scraper_meta (key, value) VALUES ('changes', ?)`).run(
    JSON.stringify({ added: [], removed: [], changed: [] })
  );

  db.prepare(`INSERT INTO scraper_meta (key, value) VALUES ('meta', ?)`).run(
    JSON.stringify({ scraped_at: '2026-04-01T00:00:00Z', count: 2 })
  );

  return db;
}

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `vocationhub-runner-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  process.env.VOCATIONHUB_DB_PATH = testDbPath;
  seedDB();
});

afterEach(() => {
  try { closeDb(); } catch { /* ignore */ }
  try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// loadPositions
// ---------------------------------------------------------------------------

describe('loadPositions', () => {
  it('reads positions from scraped_positions table', () => {
    const { positions } = loadPositions(db);
    expect(positions).toHaveLength(2);
    expect(positions[0].name).toContain("St. Paul's");
    expect(positions[0].diocese).toBe('Virginia');
    expect(positions[0].state).toBe('VA');
  });

  it('reads allProfiles from scraper_meta', () => {
    const { allProfiles } = loadPositions(db);
    expect(allProfiles).toHaveLength(3);
    expect(allProfiles[0].vh_id).toBe(100);
  });

  it('reads profileFields from scraper_meta', () => {
    const { profileFields } = loadPositions(db);
    expect(profileFields).toHaveProperty('100');
    expect(profileFields['100'][0].label).toBe('Stipend');
  });

  it('returns empty arrays when scraper_meta has no entries', () => {
    db.prepare('DELETE FROM scraper_meta').run();
    const { allProfiles, profileFields } = loadPositions(db);
    expect(allProfiles).toEqual([]);
    expect(profileFields).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// readMeta
// ---------------------------------------------------------------------------

describe('readMeta', () => {
  it('returns parsed JSON for a known key', () => {
    const result = readMeta(db, 'changes');
    expect(result).toEqual({ added: [], removed: [], changed: [] });
  });

  it('returns null for an unknown key', () => {
    expect(readMeta(db, 'nonexistent')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildExtendedPositions
// ---------------------------------------------------------------------------

describe('buildExtendedPositions', () => {
  it('excludes profiles that are in the public set', () => {
    const publicPositions = [{ vh_id: 100, name: "St. Paul's" }];
    const allProfiles = [
      { vh_id: 100, congregation: "St. Paul's", diocese: 'Virginia' },
      { vh_id: 300, congregation: 'Trinity Church', diocese: 'Connecticut' },
    ];
    const extended = buildExtendedPositions(publicPositions, allProfiles);
    expect(extended).toHaveLength(1);
    expect(extended[0].vh_id).toBe(300);
  });

  it('infers status as Search complete for bogus 1900 dates', () => {
    const extended = buildExtendedPositions([], [
      { vh_id: 999, congregation: 'Test', receiving_names_from: '01/01/1900' },
    ]);
    expect(extended[0].vh_status).toBe('Search complete');
  });

  it('builds display name from diocese when congregation is empty', () => {
    const extended = buildExtendedPositions([], [
      { vh_id: 999, congregation: '', diocese: 'Connecticut' },
    ]);
    expect(extended[0].name).toBe('Position in Connecticut');
  });

  it('falls back to Unknown Position when both are empty', () => {
    const extended = buildExtendedPositions([], [
      { vh_id: 999, congregation: '', diocese: '' },
    ]);
    expect(extended[0].name).toBe('Unknown Position');
  });

  it('infers position_type from order_of_ministry', () => {
    const extended = buildExtendedPositions([], [
      { vh_id: 999, congregation: 'Test', order_of_ministry: 'Priest' },
    ]);
    expect(extended[0].position_type).toBe('Rector / Vicar / Priest-in-Charge');
  });

  it('returns empty array when allProfiles is empty', () => {
    expect(buildExtendedPositions([], [])).toEqual([]);
    expect(buildExtendedPositions([], null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// STAGES registry
// ---------------------------------------------------------------------------

describe('STAGES', () => {
  it('has 9 stages in the correct order', () => {
    expect(STAGES).toHaveLength(9);
    expect(STAGES.map(s => s.name)).toEqual([
      'match-parishes',
      'backfill-coordinates',
      'attach-parochial',
      'attach-census',
      'compute-compensation',
      'compute-percentiles',
      'find-similar',
      'clergy-context',
      'quality-scores',
    ]);
  });
});

// ---------------------------------------------------------------------------
// runPipeline
// ---------------------------------------------------------------------------

describe('runPipeline', () => {
  it('loads positions from DB and runs all stages', () => {
    const result = runPipeline({ db });
    expect(result.positions).toHaveLength(2);
    // After quality-scores, public positions should have visibility='public'
    for (const pos of result.positions) {
      expect(pos.visibility).toBe('public');
      expect(pos.quality_score).toBeDefined();
    }
  });

  it('builds extended positions from profiles not in search results', () => {
    const result = runPipeline({ db });
    // vh_id 100 is in public set, so extended should have 300 and 400
    expect(result.extended.length).toBeGreaterThan(0);
    const extIds = result.extended.map(p => p.vh_id);
    expect(extIds).not.toContain(100);
  });

  it('skips stages listed in skip array', () => {
    const result = runPipeline({
      db,
      skip: ['match-parishes', 'attach-census', 'clergy-context'],
    });
    expect(result.positions).toHaveLength(2);
    // Without match-parishes, positions should have no church_infos
    for (const pos of result.positions) {
      expect(pos.church_infos).toBeUndefined();
    }
  });

  it('returns profileFields', () => {
    const result = runPipeline({ db });
    expect(result.profileFields).toHaveProperty('100');
  });

  it('strips salary_range and all_fields from extended', () => {
    // Seed a profile with salary_range
    db.prepare(`UPDATE scraper_meta SET value = ? WHERE key = 'all_profiles'`).run(
      JSON.stringify([{
        vh_id: 500,
        congregation: 'Test Parish',
        diocese: 'Virginia',
        salary_range: '$70,000 - $80,000',
        all_fields: [{ label: 'test', value: 'val' }],
      }])
    );

    const result = runPipeline({ db });
    for (const pos of result.extended) {
      expect(pos.salary_range).toBeUndefined();
      expect(pos.all_fields).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// writeOutput
// ---------------------------------------------------------------------------

describe('writeOutput', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrichment-output-'));
  });

  afterEach(() => {
    // Clean up temp dir
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
      fs.rmdirSync(tmpDir);
    } catch { /* ignore */ }
  });

  it('writes enriched-positions.json and enriched-extended.json', () => {
    const data = {
      positions: [{ vh_id: 1, name: 'Test', visibility: 'public' }],
      extended: [{ vh_id: 2, name: 'Ext', visibility: 'extended' }],
    };
    writeOutput(data, tmpDir);

    const pub = JSON.parse(fs.readFileSync(path.join(tmpDir, 'enriched-positions.json'), 'utf-8'));
    const ext = JSON.parse(fs.readFileSync(path.join(tmpDir, 'enriched-extended.json'), 'utf-8'));
    expect(pub).toHaveLength(1);
    expect(pub[0].vh_id).toBe(1);
    expect(ext).toHaveLength(1);
    expect(ext[0].vh_id).toBe(2);
  });

  it('strips _parish_ids from output', () => {
    const data = {
      positions: [{ vh_id: 1, name: 'Test', _parish_ids: [10, 20] }],
      extended: [{ vh_id: 2, name: 'Ext', _parish_ids: [30] }],
    };
    writeOutput(data, tmpDir);

    const pub = JSON.parse(fs.readFileSync(path.join(tmpDir, 'enriched-positions.json'), 'utf-8'));
    const ext = JSON.parse(fs.readFileSync(path.join(tmpDir, 'enriched-extended.json'), 'utf-8'));
    expect(pub[0]._parish_ids).toBeUndefined();
    expect(ext[0]._parish_ids).toBeUndefined();
  });

  it('writes position-church-map.json with confidence', () => {
    const data = {
      positions: [{
        vh_id: 1,
        name: 'Test',
        match_confidence: 'exact',
        church_infos: [{ name: 'Parish', lat: 38.8 }],
      }],
      extended: [],
    };
    writeOutput(data, tmpDir);

    const map = JSON.parse(fs.readFileSync(path.join(tmpDir, 'position-church-map.json'), 'utf-8'));
    expect(map['1']).toBeDefined();
    expect(map['1'].confidence).toBe('exact');
    expect(map['1'].church_infos).toHaveLength(1);
  });

  it('writes scraper_meta files when db is provided', () => {
    const data = { positions: [], extended: [] };
    writeOutput(data, tmpDir, db);

    expect(fs.existsSync(path.join(tmpDir, 'changes.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'all-profiles.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'profile-fields.json'))).toBe(true);

    const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, 'meta.json'), 'utf-8'));
    expect(meta.scraped_at).toBe('2026-04-01T00:00:00Z');
  });

  it('creates output directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'sub', 'dir');
    writeOutput({ positions: [], extended: [] }, nested);
    expect(fs.existsSync(path.join(nested, 'enriched-positions.json'))).toBe(true);
  });

  it('handles empty extended array', () => {
    writeOutput({ positions: [{ vh_id: 1, name: 'Test' }], extended: [] }, tmpDir);
    const ext = JSON.parse(fs.readFileSync(path.join(tmpDir, 'enriched-extended.json'), 'utf-8'));
    expect(ext).toEqual([]);
  });
});
