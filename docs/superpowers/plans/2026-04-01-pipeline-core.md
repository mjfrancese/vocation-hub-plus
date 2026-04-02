# Pipeline Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the data pipeline so SQLite is the single source of truth, workflows don't conflict, enrichment is decomposed into testable stages, and generated JSON never touches git.

**Architecture:** Two data-collection workflows write to a single SQLite DB (stored as a GitHub Release asset). A single build-and-deploy workflow downloads the DB, runs a staged enrichment pipeline, generates frontend JSON (including per-token clergy files), and deploys to GitHub Pages. No workflow commits to git.

**Tech Stack:** Node.js, better-sqlite3, Vitest, GitHub Actions, Next.js static export, Playwright (scraper)

**Spec:** `docs/superpowers/specs/2026-04-01-data-pipeline-redesign-design.md`

---

## File Structure

### New Files
- `web/scripts/stages/match-parishes.js` -- parish matching stage
- `web/scripts/stages/backfill-coordinates.js` -- coordinate backfill stage
- `web/scripts/stages/attach-parochial.js` -- parochial data attachment stage
- `web/scripts/stages/attach-census.js` -- census data attachment stage
- `web/scripts/stages/compute-compensation.js` -- compensation estimation stage
- `web/scripts/stages/compute-percentiles.js` -- percentile computation stage
- `web/scripts/stages/find-similar.js` -- similar positions stage
- `web/scripts/stages/clergy-context.js` -- clergy context stage
- `web/scripts/stages/quality-scores.js` -- quality scoring stage
- `web/scripts/run-enrichment.js` -- pipeline runner
- `web/scripts/generate-clergy-data.js` -- per-token clergy file generation (replaces generate-clergy-tokens.js)
- `web/scripts/__tests__/stages/match-parishes.test.js` -- stage tests
- `web/scripts/__tests__/stages/backfill-coordinates.test.js`
- `web/scripts/__tests__/stages/attach-parochial.test.js`
- `web/scripts/__tests__/stages/attach-census.test.js`
- `web/scripts/__tests__/stages/compute-compensation.test.js`
- `web/scripts/__tests__/stages/compute-percentiles.test.js`
- `web/scripts/__tests__/stages/find-similar.test.js`
- `web/scripts/__tests__/stages/clergy-context.test.js`
- `web/scripts/__tests__/stages/quality-scores.test.js`
- `web/scripts/__tests__/run-enrichment.test.js`
- `web/scripts/__tests__/generate-clergy-data.test.js`
- `.github/workflows/scrape-positions.yml` -- new scraper workflow
- `.github/workflows/data-refresh-v2.yml` -- new data refresh workflow
- `.github/workflows/build-and-deploy.yml` -- new unified build+deploy workflow

### Modified Files
- `web/scripts/db.js` -- add new tables (scraped_positions, scraper_meta, parish_identity, census_data)
- `scraper/src/export-json.ts` -- add DB export alongside JSON export
- `scraper/src/index.ts` -- pass DB path for position writing
- `web/src/app/me/page.tsx` -- fetch per-token file instead of full clergy-tokens.json
- `web/src/app/claim/page.tsx` -- no changes needed (still uses clergy-search-index.json)
- `web/src/components/PositionTable.tsx` -- remove clergy-tokens.json fetch, use per-token files

### Deleted (Phase 4 cutover)
- `.github/workflows/scrape.yml`
- `.github/workflows/church-directory.yml`
- `.github/workflows/data-refresh.yml`
- `web/scripts/enrich-positions-v2.js`
- `web/scripts/generate-clergy-tokens.js`
- `web/scripts/build-position-map.js`
- `web/scripts/build-registry.js`
- `web/scripts/enrich-positions.js`
- `web/public/data/enriched-positions.json` (removed from git tracking)
- `web/public/data/enriched-extended.json` (removed from git tracking)
- `web/public/data/clergy-tokens.json` (removed from git tracking)
- `web/public/data/clergy-search-index.json` (removed from git tracking)
- All other generated JSON files in `web/public/data/`

---

## Task 1: Add New Database Tables

**Files:**
- Modify: `web/scripts/db.js`
- Modify: `web/scripts/__tests__/db.test.js`

- [ ] **Step 1: Write failing test for new tables**

Add to `web/scripts/__tests__/db.test.js`:

```javascript
it('should create scraped_positions table', () => {
  const db = getDb();
  const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scraped_positions'").get();
  expect(info).toBeTruthy();

  // Verify columns
  const cols = db.prepare("PRAGMA table_info(scraped_positions)").all();
  const colNames = cols.map(c => c.name);
  expect(colNames).toContain('vh_id');
  expect(colNames).toContain('name');
  expect(colNames).toContain('diocese');
  expect(colNames).toContain('state');
  expect(colNames).toContain('organization');
  expect(colNames).toContain('position_type');
  expect(colNames).toContain('receiving_from');
  expect(colNames).toContain('receiving_to');
  expect(colNames).toContain('updated_on_hub');
  expect(colNames).toContain('status');
  expect(colNames).toContain('scraped_at');
});

it('should create scraper_meta table', () => {
  const db = getDb();
  const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scraper_meta'").get();
  expect(info).toBeTruthy();

  const cols = db.prepare("PRAGMA table_info(scraper_meta)").all();
  const colNames = cols.map(c => c.name);
  expect(colNames).toContain('key');
  expect(colNames).toContain('value');
  expect(colNames).toContain('updated_at');
});

it('should create parish_identity table', () => {
  const db = getDb();
  const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='parish_identity'").get();
  expect(info).toBeTruthy();

  const cols = db.prepare("PRAGMA table_info(parish_identity)").all();
  const colNames = cols.map(c => c.name);
  expect(colNames).toContain('nid');
  expect(colNames).toContain('ecdplus_id');
  expect(colNames).toContain('confidence');
  expect(colNames).toContain('match_method');
  expect(colNames).toContain('confirmed_at');
  expect(colNames).toContain('created_at');
});

it('should create census_data table', () => {
  const db = getDb();
  const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='census_data'").get();
  expect(info).toBeTruthy();

  const cols = db.prepare("PRAGMA table_info(census_data)").all();
  const colNames = cols.map(c => c.name);
  expect(colNames).toContain('zip');
  expect(colNames).toContain('median_income');
  expect(colNames).toContain('population');
  expect(colNames).toContain('fetched_at');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/scripts/__tests__/db.test.js`
Expected: FAIL -- tables do not exist

- [ ] **Step 3: Add table creation SQL to db.js**

Add after the existing `CREATE TABLE IF NOT EXISTS clergy_tokens` block in `web/scripts/db.js`:

```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS scraped_positions (
    vh_id TEXT PRIMARY KEY,
    name TEXT,
    diocese TEXT,
    state TEXT,
    organization TEXT,
    position_type TEXT,
    receiving_from TEXT,
    receiving_to TEXT,
    updated_on_hub TEXT,
    status TEXT,
    scraped_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scraper_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS parish_identity (
    nid TEXT NOT NULL,
    ecdplus_id TEXT NOT NULL,
    confidence TEXT NOT NULL DEFAULT 'auto',
    match_method TEXT NOT NULL,
    confirmed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (nid, ecdplus_id)
  );
  CREATE INDEX IF NOT EXISTS idx_parish_identity_nid ON parish_identity(nid);
  CREATE INDEX IF NOT EXISTS idx_parish_identity_ecdplus ON parish_identity(ecdplus_id);

  CREATE TABLE IF NOT EXISTS census_data (
    zip TEXT PRIMARY KEY,
    median_income INTEGER,
    population INTEGER,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/scripts/__tests__/db.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/db.js web/scripts/__tests__/db.test.js
git commit -m "feat: add scraped_positions, scraper_meta, parish_identity, census_data tables"
```

---

## Task 2: Scraper DB Export

Modify the scraper to write positions and metadata into the main vocationhub.db alongside its existing JSON export. This is additive -- the existing JSON export continues working so the old pipeline isn't broken.

**Files:**
- Create: `scraper/src/export-db.ts`
- Modify: `scraper/src/index.ts`

- [ ] **Step 1: Create export-db.ts**

```typescript
import Database from 'better-sqlite3';
import { Position, ChangeRecord, ScraperMeta } from './types';

export function exportToDb(
  dbPath: string,
  positions: Position[],
  changes: ChangeRecord[],
  meta: ScraperMeta,
  profileFields: Record<string, unknown[]>,
  allProfiles: unknown[]
): void {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const upsertPosition = db.prepare(`
    INSERT INTO scraped_positions (vh_id, name, diocese, state, organization, position_type,
      receiving_from, receiving_to, updated_on_hub, status, scraped_at)
    VALUES (@vh_id, @name, @diocese, @state, @organization, @position_type,
      @receiving_from, @receiving_to, @updated_on_hub, @status, datetime('now'))
    ON CONFLICT(vh_id) DO UPDATE SET
      name=excluded.name, diocese=excluded.diocese, state=excluded.state,
      organization=excluded.organization, position_type=excluded.position_type,
      receiving_from=excluded.receiving_from, receiving_to=excluded.receiving_to,
      updated_on_hub=excluded.updated_on_hub, status=excluded.status,
      scraped_at=excluded.scraped_at
  `);

  const upsertMeta = db.prepare(`
    INSERT INTO scraper_meta (key, value, updated_at)
    VALUES (@key, @value, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `);

  const insertPositions = db.transaction((positions: Position[]) => {
    for (const p of positions) {
      upsertPosition.run({
        vh_id: p.vh_id || p.id,
        name: p.name,
        diocese: p.diocese,
        state: p.state,
        organization: p.organization_type || p.organization || null,
        position_type: p.position_type,
        receiving_from: p.receiving_names_from || null,
        receiving_to: p.receiving_names_to || null,
        updated_on_hub: p.updated_on_hub || null,
        status: p.status || null,
      });
    }
  });

  insertPositions(positions);

  upsertMeta.run({ key: 'changes', value: JSON.stringify(changes) });
  upsertMeta.run({ key: 'meta', value: JSON.stringify(meta) });
  upsertMeta.run({ key: 'profile_fields', value: JSON.stringify(profileFields) });
  upsertMeta.run({ key: 'all_profiles', value: JSON.stringify(allProfiles) });

  db.close();
}
```

- [ ] **Step 2: Wire export-db into scraper index.ts**

Add at the end of the scraper's main function in `scraper/src/index.ts`, after the existing `exportJson()` call:

```typescript
import { exportToDb } from './export-db';

// After exportJson() call:
const mainDbPath = process.env.VOCATIONHUB_DB_PATH || path.join(__dirname, '../../data/vocationhub.db');
if (fs.existsSync(mainDbPath)) {
  console.log(`Exporting to main DB: ${mainDbPath}`);
  exportToDb(mainDbPath, positions, changes, meta, profileFields, allProfiles);
  console.log(`Exported ${positions.length} positions to DB`);
} else {
  console.log(`Main DB not found at ${mainDbPath}, skipping DB export`);
}
```

- [ ] **Step 3: Run existing scraper tests to verify nothing broke**

Run: `npm run test --workspace=scraper`
Expected: PASS -- existing behavior unchanged

- [ ] **Step 4: Commit**

```bash
git add scraper/src/export-db.ts scraper/src/index.ts
git commit -m "feat: add DB export to scraper alongside JSON export"
```

---

## Task 3: Enrichment Stage -- match-parishes

Extract parish matching logic from `enrich-positions-v2.js` (lines 122-405) into a standalone stage module.

**Files:**
- Create: `web/scripts/stages/match-parishes.js`
- Create: `web/scripts/__tests__/stages/match-parishes.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// web/scripts/__tests__/stages/match-parishes.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, closeDb } from '../../db.js';
import matchParishes from '../../stages/match-parishes.js';

let db;

beforeEach(() => {
  process.env.VOCATIONHUB_DB_PATH = ':memory:';
  db = getDb();

  // Seed a parish with website
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, zip, website, lat, lng, source)
    VALUES (1, '100', 'St. Paul''s Episcopal Church', 'Massachusetts', 'Boston', 'MA', '02101', 'https://stpaulsboston.org', 42.35, -71.06, 'asset_map')`).run();
  db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
    VALUES (1, 'St. Paul''s Episcopal Church', 'st pauls', 'asset_map')`).run();
});

afterEach(() => {
  closeDb();
  delete process.env.VOCATIONHUB_DB_PATH;
});

describe('match-parishes stage', () => {
  it('should match position to parish by website', () => {
    const positions = [{
      id: 'pos1',
      name: 'Rector - St. Paul\'s Boston',
      diocese: 'Massachusetts',
      website_url: 'https://stpaulsboston.org',
    }];

    const result = matchParishes(positions, db);

    expect(result[0].church_infos).toHaveLength(1);
    expect(result[0].church_infos[0].name).toBe("St. Paul's Episcopal Church");
    expect(result[0].match_confidence).toBe('exact');
  });

  it('should match position to parish by name + diocese', () => {
    const positions = [{
      id: 'pos2',
      name: "St. Paul's (Boston)",
      diocese: 'Massachusetts',
    }];

    const result = matchParishes(positions, db);

    expect(result[0].church_infos).toHaveLength(1);
    expect(result[0].match_confidence).toBeTruthy();
  });

  it('should return empty church_infos for unmatched position', () => {
    const positions = [{
      id: 'pos3',
      name: 'Unknown Church',
      diocese: 'Unknown',
    }];

    const result = matchParishes(positions, db);

    expect(result[0].church_infos).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/stages/match-parishes.test.js`
Expected: FAIL -- module does not exist

- [ ] **Step 3: Create the stage module**

Create `web/scripts/stages/match-parishes.js`. Extract `matchPositionToParish()` (lines 122-343), `matchPositionToParishes()` (lines 353-405), and helper functions `normalizeDioceseName()`, `isGenericDomain()`, `extractCity()`, `extractCityHint()`, `buildChurchInfo()` from `enrich-positions-v2.js`. Wrap in the stage interface:

```javascript
const { normalizeDomain, normalizePhone, normalizeChurchName } = require('../lib/normalization');

function normalizeDioceseName(d) {
  if (!d) return '';
  return d.replace(/^(episcopal\s+)?diocese\s+(of\s+)?/i, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function isGenericDomain(domain) {
  const generic = ['gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com',
    'icloud.com','comcast.net','att.net','verizon.net','me.com','msn.com',
    'live.com','sbcglobal.net','cox.net','charter.net','earthlink.net'];
  return generic.includes(domain?.toLowerCase());
}

function extractCity(name) {
  const m = name?.match(/\(([^)]+)\)/);
  return m ? m[1].trim() : null;
}

function buildChurchInfo(row) {
  return {
    nid: row.nid || null,
    name: row.name,
    street: row.address || null,
    city: row.city || null,
    state: row.state || null,
    zip: row.zip || null,
    phone: row.phone || null,
    email: row.email || null,
    website: row.website || null,
    type: row.type || null,
    lat: row.lat || null,
    lng: row.lng || null,
  };
}

function matchPositionToParish(position, db) {
  const diocese = normalizeDioceseName(position.diocese);

  // Strategy 1: Website match
  if (position.website_url) {
    const domain = normalizeDomain(position.website_url);
    if (domain) {
      const row = db.prepare(
        `SELECT * FROM parishes WHERE LOWER(website) LIKE ? AND LOWER(diocese) = ?`
      ).get(`%${domain}%`, diocese);
      if (row) return { parish: row, confidence: 'exact', method: 'website' };
    }
  }

  // Strategy 2: Email domain match
  if (position.contact_email) {
    const emailDomain = position.contact_email.split('@')[1];
    if (emailDomain && !isGenericDomain(emailDomain)) {
      const row = db.prepare(
        `SELECT * FROM parishes WHERE LOWER(email) LIKE ? AND LOWER(diocese) = ?`
      ).get(`%${emailDomain}%`, diocese);
      if (row) return { parish: row, confidence: 'high', method: 'email' };
    }
  }

  // Strategy 3: Phone match (diocese-scoped)
  if (position.contact_phone) {
    const phone = normalizePhone(position.contact_phone);
    if (phone && phone.length >= 10) {
      const row = db.prepare(
        `SELECT * FROM parishes WHERE phone = ? AND LOWER(diocese) = ?`
      ).get(phone, diocese);
      if (row) return { parish: row, confidence: 'high', method: 'phone' };
    }
  }

  // Strategy 4: Name + diocese via aliases
  const cityHint = extractCity(position.name);
  const posName = normalizeChurchName(position.name);
  if (posName) {
    const aliasRows = db.prepare(`
      SELECT p.* FROM parish_aliases a
      JOIN parishes p ON p.id = a.parish_id
      WHERE a.alias_normalized = ? AND LOWER(p.diocese) = ?
    `).all(posName, diocese);

    if (aliasRows.length === 1) {
      return { parish: aliasRows[0], confidence: 'medium', method: 'name_diocese' };
    }
    if (aliasRows.length > 1 && cityHint) {
      const cityMatch = aliasRows.find(r =>
        r.city?.toLowerCase() === cityHint.toLowerCase()
      );
      if (cityMatch) {
        return { parish: cityMatch, confidence: 'medium', method: 'name_diocese_city' };
      }
    }
  }

  return null;
}

function matchPositionToParishes(position, db) {
  // Handle multi-congregation names like "Rector, St. Paul's & St. Andrew's"
  const parts = position.name?.split(/\s*[&+]\s*/) || [];

  if (parts.length <= 1) {
    const match = matchPositionToParish(position, db);
    if (match) {
      return {
        church_infos: [buildChurchInfo(match.parish)],
        match_confidence: match.confidence,
        match_method: match.method,
        parish_ids: [match.parish.id],
      };
    }
    return { church_infos: [], match_confidence: null, match_method: null, parish_ids: [] };
  }

  // Multi-parish: try matching each part
  const matches = [];
  for (const part of parts) {
    const subPosition = { ...position, name: part.trim() };
    const match = matchPositionToParish(subPosition, db);
    if (match) matches.push(match);
  }

  if (matches.length > 0) {
    return {
      church_infos: matches.map(m => buildChurchInfo(m.parish)),
      match_confidence: matches[0].confidence,
      match_method: matches[0].method,
      parish_ids: matches.map(m => m.parish.id),
    };
  }

  return { church_infos: [], match_confidence: null, match_method: null, parish_ids: [] };
}

module.exports = function matchParishesStage(positions, db) {
  return positions.map(position => {
    const result = matchPositionToParishes(position, db);
    return {
      ...position,
      church_infos: result.church_infos,
      match_confidence: result.match_confidence,
      match_method: result.match_method,
      _parish_ids: result.parish_ids, // internal, used by later stages
    };
  });
};
```

**Note:** This is extracted from `enrich-positions-v2.js` lines 122-405. The exact matching strategies should be verified against the original during implementation. The original has additional nuance (manual overrides via `manual-mappings.json`, VH ID-based lookups) that should be ported over by reading the original code.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/stages/match-parishes.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/stages/match-parishes.js web/scripts/__tests__/stages/match-parishes.test.js
git commit -m "feat: extract match-parishes enrichment stage"
```

---

## Task 4: Enrichment Stage -- backfill-coordinates

Extract coordinate backfill from `enrich-positions-v2.js` (lines 1129-1184).

**Files:**
- Create: `web/scripts/stages/backfill-coordinates.js`
- Create: `web/scripts/__tests__/stages/backfill-coordinates.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, closeDb } from '../../db.js';
import backfillCoordinates from '../../stages/backfill-coordinates.js';

let db;

beforeEach(() => {
  process.env.VOCATIONHUB_DB_PATH = ':memory:';
  db = getDb();
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, lat, lng, source)
    VALUES (1, '100', 'St. Paul''s', 'Massachusetts', 'Boston', 'MA', 42.35, -71.06, 'asset_map')`).run();
});

afterEach(() => { closeDb(); delete process.env.VOCATIONHUB_DB_PATH; });

describe('backfill-coordinates stage', () => {
  it('should copy lat/lng from matched parish to position', () => {
    const positions = [{
      id: 'pos1',
      church_infos: [{ nid: '100', name: "St. Paul's", lat: null, lng: null }],
      _parish_ids: [1],
    }];

    const result = backfillCoordinates(positions, db);

    expect(result[0].church_infos[0].lat).toBe(42.35);
    expect(result[0].church_infos[0].lng).toBe(-71.06);
  });

  it('should leave positions without matches unchanged', () => {
    const positions = [{ id: 'pos2', church_infos: [], _parish_ids: [] }];
    const result = backfillCoordinates(positions, db);
    expect(result[0].church_infos).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/stages/backfill-coordinates.test.js`
Expected: FAIL

- [ ] **Step 3: Create the stage module**

```javascript
// web/scripts/stages/backfill-coordinates.js
module.exports = function backfillCoordinates(positions, db) {
  const getParish = db.prepare('SELECT lat, lng FROM parishes WHERE id = ?');

  return positions.map(position => {
    if (!position._parish_ids || position._parish_ids.length === 0) return position;

    const updatedInfos = position.church_infos.map((info, i) => {
      if (info.lat && info.lng) return info;

      const parishId = position._parish_ids[i];
      if (!parishId) return info;

      const row = getParish.get(parishId);
      if (row && row.lat && row.lng) {
        return { ...info, lat: row.lat, lng: row.lng };
      }
      return info;
    });

    return { ...position, church_infos: updatedInfos };
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/stages/backfill-coordinates.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/stages/backfill-coordinates.js web/scripts/__tests__/stages/backfill-coordinates.test.js
git commit -m "feat: extract backfill-coordinates enrichment stage"
```

---

## Task 5: Enrichment Stage -- attach-parochial

Extract parochial data attachment from `enrich-positions-v2.js` (lines 944-1010, 1293-1309).

**Files:**
- Create: `web/scripts/stages/attach-parochial.js`
- Create: `web/scripts/__tests__/stages/attach-parochial.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../../db.js';
import attachParochial from '../../stages/attach-parochial.js';

let db;

beforeEach(() => {
  process.env.VOCATIONHUB_DB_PATH = ':memory:';
  db = getDb();
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, source) VALUES (1, '100', 'St. Paul''s', 'Massachusetts', 'asset_map')`).run();
  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership, operating_revenue)
    VALUES ('100', 2023, 150, 250000, 400, 300000)`).run();
  db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership, operating_revenue)
    VALUES ('100', 2022, 140, 240000, 390, 290000)`).run();
});

afterEach(() => { closeDb(); delete process.env.VOCATIONHUB_DB_PATH; });

describe('attach-parochial stage', () => {
  it('should attach parochial data by parish NID', () => {
    const positions = [{
      id: 'pos1',
      church_infos: [{ nid: '100', name: "St. Paul's" }],
      _parish_ids: [1],
    }];

    const result = attachParochial(positions, db);

    expect(result[0].parochials).toHaveLength(1);
    expect(result[0].parochials[0].years['2023'].averageAttendance).toBe(150);
    expect(result[0].parochials[0].years['2022'].averageAttendance).toBe(140);
  });

  it('should return empty parochials for unmatched position', () => {
    const positions = [{ id: 'pos2', church_infos: [], _parish_ids: [] }];
    const result = attachParochial(positions, db);
    expect(result[0].parochials).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/stages/attach-parochial.test.js`
Expected: FAIL

- [ ] **Step 3: Create the stage module**

```javascript
// web/scripts/stages/attach-parochial.js
module.exports = function attachParochial(positions, db) {
  const getParochial = db.prepare(
    'SELECT year, average_attendance, plate_and_pledge, membership, operating_revenue FROM parochial_data WHERE parish_nid = ? ORDER BY year'
  );
  const getParishNid = db.prepare('SELECT nid FROM parishes WHERE id = ?');

  return positions.map(position => {
    if (!position._parish_ids || position._parish_ids.length === 0) {
      return { ...position, parochials: [] };
    }

    const parochials = position.church_infos.map((info, i) => {
      const nid = info.nid || getParishNid.get(position._parish_ids[i])?.nid;
      if (!nid) return { years: {} };

      const rows = getParochial.all(nid);
      const years = {};
      for (const row of rows) {
        years[String(row.year)] = {
          averageAttendance: row.average_attendance,
          plateAndPledge: row.plate_and_pledge,
          membership: row.membership,
          operatingRevenue: row.operating_revenue,
        };
      }
      return { years };
    });

    return { ...position, parochials };
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/stages/attach-parochial.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/stages/attach-parochial.js web/scripts/__tests__/stages/attach-parochial.test.js
git commit -m "feat: extract attach-parochial enrichment stage"
```

---

## Task 6: Enrichment Stage -- attach-census

Extract census data attachment from `enrich-positions-v2.js` (lines 805-826).

**Files:**
- Create: `web/scripts/stages/attach-census.js`
- Create: `web/scripts/__tests__/stages/attach-census.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../../db.js';
import attachCensus from '../../stages/attach-census.js';

let db;

beforeEach(() => {
  process.env.VOCATIONHUB_DB_PATH = ':memory:';
  db = getDb();
  db.prepare(`INSERT INTO census_data (zip, median_income, population) VALUES ('02101', 85000, 45000)`).run();
});

afterEach(() => { closeDb(); delete process.env.VOCATIONHUB_DB_PATH; });

describe('attach-census stage', () => {
  it('should attach census data by parish zip', () => {
    const positions = [{
      id: 'pos1',
      church_infos: [{ zip: '02101' }],
    }];

    const result = attachCensus(positions, db);

    expect(result[0].census).toEqual({
      median_household_income: 85000,
      population: 45000,
    });
  });

  it('should return null census for missing zip', () => {
    const positions = [{ id: 'pos2', church_infos: [{ zip: '99999' }] }];
    const result = attachCensus(positions, db);
    expect(result[0].census).toBeNull();
  });

  it('should return null census for no church_infos', () => {
    const positions = [{ id: 'pos3', church_infos: [] }];
    const result = attachCensus(positions, db);
    expect(result[0].census).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/stages/attach-census.test.js`
Expected: FAIL

- [ ] **Step 3: Create the stage module**

```javascript
// web/scripts/stages/attach-census.js
module.exports = function attachCensus(positions, db) {
  const getCensus = db.prepare('SELECT median_income, population FROM census_data WHERE zip = ?');

  return positions.map(position => {
    const zip = position.church_infos?.[0]?.zip;
    if (!zip) return { ...position, census: null };

    const row = getCensus.get(zip);
    if (!row) return { ...position, census: null };

    return {
      ...position,
      census: {
        median_household_income: row.median_income,
        population: row.population,
      },
    };
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/stages/attach-census.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/stages/attach-census.js web/scripts/__tests__/stages/attach-census.test.js
git commit -m "feat: extract attach-census enrichment stage"
```

---

## Task 7: Enrichment Stage -- compute-compensation

Extract compensation estimation from `enrich-positions-v2.js` (lines 411-431, 600-715).

**Files:**
- Create: `web/scripts/stages/compute-compensation.js`
- Create: `web/scripts/__tests__/stages/compute-compensation.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../../db.js';
import computeCompensation from '../../stages/compute-compensation.js';

let db;

beforeEach(() => {
  process.env.VOCATIONHUB_DB_PATH = ':memory:';
  db = getDb();
  db.prepare(`INSERT INTO compensation_diocesan (year, diocese, female_median, male_median, all_median, all_count)
    VALUES (2023, 'massachusetts', 72000, 78000, 75000, 45)`).run();
});

afterEach(() => { closeDb(); delete process.env.VOCATIONHUB_DB_PATH; });

describe('compute-compensation stage', () => {
  it('should attach diocese compensation benchmarks', () => {
    const positions = [{
      id: 'pos1',
      diocese: 'Massachusetts',
      church_infos: [{ name: "St. Paul's" }],
    }];

    const result = computeCompensation(positions, db);

    expect(result[0].compensation).toBeTruthy();
    expect(result[0].compensation.diocese_median).toBe(75000);
    expect(result[0].compensation.year).toBe(2023);
  });

  it('should estimate total comp from salary range', () => {
    const positions = [{
      id: 'pos2',
      diocese: 'Massachusetts',
      salary_range: '$70,000 - $80,000',
      housing_type: 'Housing Allowance',
      church_infos: [{ name: "St. Paul's" }],
    }];

    const result = computeCompensation(positions, db);

    expect(result[0].estimated_total_comp).toBeGreaterThan(0);
    expect(result[0].comp_breakdown).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/stages/compute-compensation.test.js`
Expected: FAIL

- [ ] **Step 3: Create the stage module**

Extract `attachCompensation()` (lines 411-431), `computeEstimatedTotalComp()` (lines 600-715), and `parseStipend()` (lines 107-116) from the original. The key logic:

```javascript
// web/scripts/stages/compute-compensation.js
function parseStipend(salaryRange) {
  if (!salaryRange) return null;
  const numbers = salaryRange.match(/[\d,]+/g);
  if (!numbers || numbers.length === 0) return null;
  const values = numbers.map(n => parseInt(n.replace(/,/g, ''), 10)).filter(n => n > 1000);
  if (values.length === 0) return null;
  return values.length >= 2 ? Math.round((values[0] + values[1]) / 2) : values[0];
}

function normalizeDioceseName(d) {
  if (!d) return '';
  return d.replace(/^(episcopal\s+)?diocese\s+(of\s+)?/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

module.exports = function computeCompensation(positions, db) {
  const getComp = db.prepare(
    `SELECT year, female_median, male_median, all_median, all_count
     FROM compensation_diocesan WHERE diocese = ? ORDER BY year DESC LIMIT 1`
  );

  return positions.map(position => {
    const diocese = normalizeDioceseName(position.diocese);
    const comp = getComp.get(diocese);

    const compensation = comp ? {
      diocese_median: comp.all_median,
      diocese_female_median: comp.female_median,
      diocese_male_median: comp.male_median,
      diocese_clergy_count: comp.all_count,
      year: comp.year,
    } : null;

    // Estimate total comp from salary range
    const stipend = parseStipend(position.salary_range);
    let estimated_total_comp = null;
    let comp_breakdown = null;

    if (stipend) {
      const housing = position.housing_type?.toLowerCase().includes('allowance') ? 20000 :
                       position.housing_type?.toLowerCase().includes('rectory') ? 20000 : 0;
      estimated_total_comp = stipend + housing;
      comp_breakdown = { stipend, ...(housing ? { housing } : {}) };
    }

    return { ...position, compensation, estimated_total_comp, comp_breakdown };
  });
};
```

**Note:** The $20k housing value is from the original script. During implementation, verify this against `enrich-positions-v2.js` lines 600-715 for the exact logic (it may vary by region or have more nuance).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/stages/compute-compensation.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/stages/compute-compensation.js web/scripts/__tests__/stages/compute-compensation.test.js
git commit -m "feat: extract compute-compensation enrichment stage"
```

---

## Task 8: Enrichment Stage -- compute-percentiles

Extract percentile computation from `enrich-positions-v2.js` (lines 516-594).

**Files:**
- Create: `web/scripts/stages/compute-percentiles.js`
- Create: `web/scripts/__tests__/stages/compute-percentiles.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../../db.js';
import computePercentiles from '../../stages/compute-percentiles.js';

let db;

beforeEach(() => {
  process.env.VOCATIONHUB_DB_PATH = ':memory:';
  db = getDb();
  // Seed 5 parishes in same diocese with parochial data
  for (let i = 1; i <= 5; i++) {
    db.prepare(`INSERT INTO parishes (id, nid, name, diocese, source) VALUES (?, ?, ?, 'Massachusetts', 'asset_map')`)
      .run(i, String(100 + i), `Church ${i}`);
    db.prepare(`INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership)
      VALUES (?, 2023, ?, ?, ?)`)
      .run(String(100 + i), i * 50, i * 50000, i * 100);
  }
});

afterEach(() => { closeDb(); delete process.env.VOCATIONHUB_DB_PATH; });

describe('compute-percentiles stage', () => {
  it('should compute diocese percentiles for matched parish', () => {
    const positions = [{
      id: 'pos1',
      diocese: 'Massachusetts',
      church_infos: [{ nid: '103' }],
      _parish_ids: [3],
      parochials: [{ years: { '2023': { averageAttendance: 150, plateAndPledge: 150000, membership: 300 } } }],
    }];

    const result = computePercentiles(positions, db);

    expect(result[0].diocese_percentiles).toBeTruthy();
    expect(result[0].diocese_percentiles.asa).toBeGreaterThan(0);
    expect(result[0].diocese_percentiles.asa).toBeLessThanOrEqual(100);
    expect(result[0].diocese_percentiles.asa_value).toBe(150);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/stages/compute-percentiles.test.js`
Expected: FAIL

- [ ] **Step 3: Create the stage module**

Extract `computeDiocesePercentiles()` from lines 516-594. The key logic ranks a parish's ASA/plate+pledge/membership against all parishes in the same diocese:

```javascript
// web/scripts/stages/compute-percentiles.js
function normalizeDioceseName(d) {
  if (!d) return '';
  return d.replace(/^(episcopal\s+)?diocese\s+(of\s+)?/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

module.exports = function computePercentiles(positions, db) {
  // Cache diocese data to avoid repeated queries
  const dioceseCache = {};

  function getDioceseValues(diocese) {
    if (dioceseCache[diocese]) return dioceseCache[diocese];

    const rows = db.prepare(`
      SELECT pd.average_attendance, pd.plate_and_pledge, pd.membership
      FROM parochial_data pd
      JOIN parishes p ON p.nid = pd.parish_nid
      WHERE LOWER(p.diocese) = ? AND pd.year = (
        SELECT MAX(year) FROM parochial_data pd2 WHERE pd2.parish_nid = pd.parish_nid
      )
    `).all(diocese);

    dioceseCache[diocese] = {
      asa: rows.map(r => r.average_attendance).filter(Boolean).sort((a, b) => a - b),
      platePledge: rows.map(r => r.plate_and_pledge).filter(Boolean).sort((a, b) => a - b),
      membership: rows.map(r => r.membership).filter(Boolean).sort((a, b) => a - b),
    };
    return dioceseCache[diocese];
  }

  function percentile(sortedArr, value) {
    if (!sortedArr.length || value == null) return null;
    const idx = sortedArr.findIndex(v => v >= value);
    if (idx === -1) return 100;
    return Math.round((idx / sortedArr.length) * 100);
  }

  return positions.map(position => {
    const latestParochial = position.parochials?.[0]?.years;
    if (!latestParochial) return { ...position, diocese_percentiles: null };

    const years = Object.keys(latestParochial).sort().reverse();
    const latest = latestParochial[years[0]];
    if (!latest) return { ...position, diocese_percentiles: null };

    const diocese = normalizeDioceseName(position.diocese);
    const vals = getDioceseValues(diocese);

    return {
      ...position,
      diocese_percentiles: {
        asa: percentile(vals.asa, latest.averageAttendance),
        asa_value: latest.averageAttendance,
        plate_pledge: percentile(vals.platePledge, latest.plateAndPledge),
        plate_pledge_value: latest.plateAndPledge,
        membership: percentile(vals.membership, latest.membership),
        membership_value: latest.membership,
      },
    };
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/stages/compute-percentiles.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/stages/compute-percentiles.js web/scripts/__tests__/stages/compute-percentiles.test.js
git commit -m "feat: extract compute-percentiles enrichment stage"
```

---

## Task 9: Enrichment Stage -- find-similar

Extract similar positions logic from `enrich-positions-v2.js` (lines 721-799).

**Files:**
- Create: `web/scripts/stages/find-similar.js`
- Create: `web/scripts/__tests__/stages/find-similar.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { describe, it, expect } from 'vitest';
import findSimilar from '../../stages/find-similar.js';

describe('find-similar stage', () => {
  it('should find similar positions in same diocese and position type', () => {
    const positions = [
      { id: 'pos1', diocese: 'Massachusetts', position_type: 'Rector', parochials: [{ years: { '2023': { averageAttendance: 100 } } }], estimated_total_comp: 70000, state: 'MA' },
      { id: 'pos2', diocese: 'Massachusetts', position_type: 'Rector', parochials: [{ years: { '2023': { averageAttendance: 110 } } }], estimated_total_comp: 72000, state: 'MA' },
      { id: 'pos3', diocese: 'Massachusetts', position_type: 'Deacon', parochials: [{ years: { '2023': { averageAttendance: 100 } } }], estimated_total_comp: 50000, state: 'MA' },
      { id: 'pos4', diocese: 'Connecticut', position_type: 'Rector', parochials: [{ years: { '2023': { averageAttendance: 100 } } }], estimated_total_comp: 70000, state: 'CT' },
    ];

    const result = findSimilar(positions);

    // pos1 should find pos2 as most similar (same diocese, type, similar ASA/comp)
    expect(result[0].similar_positions).toBeTruthy();
    expect(result[0].similar_positions.length).toBeGreaterThan(0);
    expect(result[0].similar_positions[0].id).toBe('pos2');
  });

  it('should return empty similar_positions when no matches', () => {
    const positions = [{ id: 'pos1', diocese: 'Unique', position_type: 'Unique', parochials: [], estimated_total_comp: null, state: 'XX' }];
    const result = findSimilar(positions);
    expect(result[0].similar_positions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/stages/find-similar.test.js`
Expected: FAIL

- [ ] **Step 3: Create the stage module**

Extract `computeSimilarPositions()` from lines 721-799. This stage operates on the positions array itself (no DB needed):

```javascript
// web/scripts/stages/find-similar.js
function getLatestASA(position) {
  const years = position.parochials?.[0]?.years;
  if (!years) return null;
  const latest = Object.keys(years).sort().reverse()[0];
  return years[latest]?.averageAttendance || null;
}

function scoreSimilarity(a, b) {
  let score = 0;

  const asaA = getLatestASA(a), asaB = getLatestASA(b);
  if (asaA && asaB) {
    const ratio = Math.min(asaA, asaB) / Math.max(asaA, asaB);
    if (ratio >= 0.75) score += 3; // ASA within 25%
  }

  if (a.estimated_total_comp && b.estimated_total_comp) {
    const ratio = Math.min(a.estimated_total_comp, b.estimated_total_comp) / Math.max(a.estimated_total_comp, b.estimated_total_comp);
    if (ratio >= 0.8) score += 2; // Comp within 20%
  }

  if (a.state === b.state) score += 1;
  if (a.position_type === b.position_type) score += 2;
  if (a.housing_type && b.housing_type && a.housing_type === b.housing_type) score += 1;

  return score;
}

module.exports = function findSimilar(positions, _db) {
  return positions.map(position => {
    const candidates = positions.filter(p =>
      p.id !== position.id && p.diocese === position.diocese
    );

    const scored = candidates
      .map(c => ({ ...c, _score: scoreSimilarity(position, c) }))
      .filter(c => c._score >= 2)
      .sort((a, b) => b._score - a._score)
      .slice(0, 5);

    const similar_positions = scored.map(s => ({
      id: s.id,
      vh_id: s.vh_id || null,
      name: s.name,
      city: s.church_infos?.[0]?.city || null,
      state: s.state,
      position_type: s.position_type,
      asa: getLatestASA(s),
      estimated_total_comp: s.estimated_total_comp,
      score: s._score,
    }));

    return { ...position, similar_positions };
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/stages/find-similar.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/stages/find-similar.js web/scripts/__tests__/stages/find-similar.test.js
git commit -m "feat: extract find-similar enrichment stage"
```

---

## Task 10: Enrichment Stage -- clergy-context

Extract clergy context from `enrich-positions-v2.js` (lines 437-510, 1020-1122).

**Files:**
- Create: `web/scripts/stages/clergy-context.js`
- Create: `web/scripts/__tests__/stages/clergy-context.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../../db.js';
import clergyContext from '../../stages/clergy-context.js';

let db;

beforeEach(() => {
  process.env.VOCATIONHUB_DB_PATH = ':memory:';
  db = getDb();
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, source) VALUES (1, '100', 'St. Paul''s', 'Massachusetts', 'asset_map')`).run();
  db.prepare(`INSERT INTO clergy (guid, first_name, last_name) VALUES ('g1', 'John', 'Smith')`).run();
  db.prepare(`INSERT INTO clergy_positions (clergy_guid, parish_id, position_title, start_date, is_current)
    VALUES ('g1', 1, 'Rector', '2020-01-01', 1)`).run();
});

afterEach(() => { closeDb(); delete process.env.VOCATIONHUB_DB_PATH; });

describe('clergy-context stage', () => {
  it('should attach current clergy and parish context', () => {
    const positions = [{
      id: 'pos1',
      church_infos: [{ nid: '100', name: "St. Paul's" }],
      _parish_ids: [1],
    }];

    const result = clergyContext(positions, db);

    expect(result[0].clergy).toBeTruthy();
    expect(result[0].clergy.current_clergy.name).toBe('John Smith');
    expect(result[0].parish_contexts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/stages/clergy-context.test.js`
Expected: FAIL

- [ ] **Step 3: Create the stage module**

Extract `attachClergyInfo()` (lines 437-510) and `computeParishContext()` (lines 1020-1122):

```javascript
// web/scripts/stages/clergy-context.js
module.exports = function clergyContext(positions, db) {
  const getCurrentClergy = db.prepare(`
    SELECT c.first_name, c.last_name, cp.position_title, cp.start_date
    FROM clergy_positions cp
    JOIN clergy c ON c.guid = cp.clergy_guid
    WHERE cp.parish_id = ? AND cp.is_current = 1
    ORDER BY cp.start_date DESC
  `);

  const getClergyHistory = db.prepare(`
    SELECT cp.start_date, cp.end_date, cp.position_title
    FROM clergy_positions cp
    WHERE cp.parish_id = ?
    ORDER BY cp.start_date DESC
  `);

  return positions.map(position => {
    if (!position._parish_ids || position._parish_ids.length === 0) {
      return { ...position, clergy: null, parish_contexts: [] };
    }

    const parishId = position._parish_ids[0];

    // Current clergy
    const current = getCurrentClergy.all(parishId);
    const currentClergy = current.length > 0 ? {
      name: `${current[0].first_name} ${current[0].last_name}`,
      position_title: current[0].position_title,
      start_date: current[0].start_date,
      years_tenure: current[0].start_date
        ? Math.round((Date.now() - new Date(current[0].start_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000) * 10) / 10
        : null,
    } : null;

    // Parish clergy history
    const history = getClergyHistory.all(parishId);
    const recentCount = history.filter(h => {
      const start = h.start_date ? new Date(h.start_date).getFullYear() : 0;
      return start >= new Date().getFullYear() - 10;
    }).length;

    const tenures = history.filter(h => h.start_date && h.end_date).map(h => {
      const start = new Date(h.start_date);
      const end = new Date(h.end_date);
      return (end - start) / (365.25 * 24 * 60 * 60 * 1000);
    });
    const avgTenure = tenures.length > 0 ? Math.round(tenures.reduce((a, b) => a + b, 0) / tenures.length * 10) / 10 : null;

    const clergy = {
      current_clergy: currentClergy,
      parish_clergy_history: { recent_count: recentCount, avg_tenure_years: avgTenure },
    };

    // Parish context (neutral stats for public display)
    const parish_contexts = position._parish_ids.map(pid => {
      const hist = getClergyHistory.all(pid);
      return {
        clergy_count_10yr: hist.filter(h => {
          const start = h.start_date ? new Date(h.start_date).getFullYear() : 0;
          return start >= new Date().getFullYear() - 10;
        }).length,
        avg_tenure_years: (() => {
          const t = hist.filter(h => h.start_date && h.end_date).map(h => {
            return (new Date(h.end_date) - new Date(h.start_date)) / (365.25 * 24 * 60 * 60 * 1000);
          });
          return t.length > 0 ? Math.round(t.reduce((a, b) => a + b, 0) / t.length * 10) / 10 : null;
        })(),
      };
    });

    return { ...position, clergy, parish_contexts };
  });
};
```

**Note:** The original `computeParishContext()` also computes attendance/giving/membership trends (growing/declining/stable). During implementation, verify against lines 1020-1122 and port that logic too.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/stages/clergy-context.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/stages/clergy-context.js web/scripts/__tests__/stages/clergy-context.test.js
git commit -m "feat: extract clergy-context enrichment stage"
```

---

## Task 11: Enrichment Stage -- quality-scores

Extract quality scoring from `enrich-positions-v2.js` (lines 832-933).

**Files:**
- Create: `web/scripts/stages/quality-scores.js`
- Create: `web/scripts/__tests__/stages/quality-scores.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { describe, it, expect } from 'vitest';
import qualityScores from '../../stages/quality-scores.js';

describe('quality-scores stage', () => {
  it('should score public position with full data as 100', () => {
    const positions = [{
      id: 'pos1',
      visibility: 'public',
      status: 'Open',
      church_infos: [{ name: "St. Paul's" }],
      parochials: [{ years: { '2023': { averageAttendance: 100 } } }],
    }];

    const result = qualityScores(positions);
    expect(result[0].quality_score).toBe(100);
  });

  it('should score extended position lower', () => {
    const positions = [{
      id: 'pos2',
      visibility: 'extended',
      status: 'Open',
      name: 'Some Position',
      church_infos: [{ name: 'A Church' }],
      parochials: [{ years: { '2023': { averageAttendance: 50 } } }],
      updated_on_hub: '2026-03-15',
    }];

    const result = qualityScores(positions);
    expect(result[0].quality_score).toBeGreaterThan(0);
    expect(result[0].quality_score).toBeLessThan(100);
    expect(result[0].quality_components).toBeTruthy();
  });

  it('should cap extended position without congregation at 45', () => {
    const positions = [{
      id: 'pos3',
      visibility: 'extended',
      status: 'Open',
      name: 'Unknown Position',
      church_infos: [],
      parochials: [],
    }];

    const result = qualityScores(positions);
    expect(result[0].quality_score).toBeLessThanOrEqual(45);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/stages/quality-scores.test.js`
Expected: FAIL

- [ ] **Step 3: Create the stage module**

```javascript
// web/scripts/stages/quality-scores.js
module.exports = function qualityScores(positions, _db) {
  return positions.map(position => {
    // Public positions always score 100
    if (position.visibility === 'public') {
      return { ...position, quality_score: 100, quality_components: ['public_listing'] };
    }

    const components = [];
    let score = 0;

    // Status component (25 points)
    if (position.status === 'Open' || position.status === 'Receiving Names') {
      score += 25;
      components.push('active_status');
    }

    // Recency component (20 points)
    if (position.updated_on_hub) {
      const updated = new Date(position.updated_on_hub);
      const daysSince = (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince <= 30) { score += 20; components.push('recent_update'); }
      else if (daysSince <= 90) { score += 10; components.push('moderately_recent'); }
    }

    // Name clarity (10 points)
    if (position.name && position.name.length > 10 && !position.name.match(/^(position|opening|job)/i)) {
      score += 10;
      components.push('clear_name');
    }

    // Data richness (40 points)
    let dataScore = 0;
    if (position.church_infos?.length > 0) { dataScore += 10; components.push('church_match'); }
    if (position.parochials?.[0]?.years && Object.keys(position.parochials[0].years).length > 0) {
      dataScore += 10;
      components.push('parochial_data');
    }
    if (position.compensation) { dataScore += 10; components.push('compensation_data'); }
    if (position.clergy) { dataScore += 10; components.push('clergy_data'); }
    score += dataScore;

    // Cap at 45 if no congregation name (extended without match)
    if (!position.church_infos?.length) {
      score = Math.min(score, 45);
    }

    return { ...position, quality_score: score, quality_components: components };
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/stages/quality-scores.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/stages/quality-scores.js web/scripts/__tests__/stages/quality-scores.test.js
git commit -m "feat: extract quality-scores enrichment stage"
```

---

## Task 12: Pipeline Runner

Create the orchestrator that loads positions from DB and runs all stages in order.

**Files:**
- Create: `web/scripts/run-enrichment.js`
- Create: `web/scripts/__tests__/run-enrichment.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../db.js';

let db;

beforeEach(() => {
  process.env.VOCATIONHUB_DB_PATH = ':memory:';
  db = getDb();
  // Seed a position
  db.prepare(`INSERT INTO scraped_positions (vh_id, name, diocese, state, position_type, status)
    VALUES ('vh1', 'Rector - St. Paul''s', 'Massachusetts', 'MA', 'Rector', 'Open')`).run();
  // Seed a parish
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, website, lat, lng, source)
    VALUES (1, '100', 'St. Paul''s Episcopal Church', 'Massachusetts', 'Boston', 'MA', 'https://stpaulsboston.org', 42.35, -71.06, 'asset_map')`).run();
  db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
    VALUES (1, 'St. Paul''s Episcopal Church', 'st pauls', 'asset_map')`).run();
});

afterEach(() => { closeDb(); delete process.env.VOCATIONHUB_DB_PATH; });

describe('run-enrichment', () => {
  it('should load positions from DB and run all stages', async () => {
    const { runPipeline } = require('../run-enrichment.js');
    const result = await runPipeline({ db });

    expect(result.positions).toBeTruthy();
    expect(result.positions.length).toBe(1);
    // After match-parishes, should have church_infos
    expect(result.positions[0]).toHaveProperty('church_infos');
    // After quality-scores, should have quality_score
    expect(result.positions[0]).toHaveProperty('quality_score');
  });

  it('should support --skip flag', async () => {
    const { runPipeline } = require('../run-enrichment.js');
    const result = await runPipeline({ db, skip: ['find-similar', 'clergy-context'] });

    expect(result.positions[0]).not.toHaveProperty('similar_positions');
    expect(result.positions[0]).not.toHaveProperty('clergy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/run-enrichment.test.js`
Expected: FAIL

- [ ] **Step 3: Create the runner**

```javascript
// web/scripts/run-enrichment.js
const path = require('path');
const fs = require('fs');
const { getDb, closeDb } = require('./db.js');

const STAGES = [
  { name: 'match-parishes', module: require('./stages/match-parishes.js') },
  { name: 'backfill-coordinates', module: require('./stages/backfill-coordinates.js') },
  { name: 'attach-parochial', module: require('./stages/attach-parochial.js') },
  { name: 'attach-census', module: require('./stages/attach-census.js') },
  { name: 'compute-compensation', module: require('./stages/compute-compensation.js') },
  { name: 'compute-percentiles', module: require('./stages/compute-percentiles.js') },
  { name: 'find-similar', module: require('./stages/find-similar.js') },
  { name: 'clergy-context', module: require('./stages/clergy-context.js') },
  { name: 'quality-scores', module: require('./stages/quality-scores.js') },
];

function loadPositions(db) {
  return db.prepare('SELECT * FROM scraped_positions').all().map(row => ({
    ...row,
    id: row.vh_id,
    visibility: 'public',
  }));
}

function runPipeline({ db: providedDb, skip = [] } = {}) {
  const db = providedDb || getDb();
  let positions = loadPositions(db);

  console.log(`Loaded ${positions.length} positions from DB`);

  for (const stage of STAGES) {
    if (skip.includes(stage.name)) {
      console.log(`  Skipping: ${stage.name}`);
      continue;
    }
    console.log(`  Running: ${stage.name}`);
    positions = stage.module(positions, db);
  }

  console.log(`Enrichment complete. ${positions.length} positions processed.`);
  return { positions };
}

function writeOutput(positions, outputDir) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const publicPositions = positions.filter(p => p.visibility === 'public');
  const extendedPositions = positions.filter(p => p.visibility !== 'public');

  // Strip internal fields
  const clean = (p) => {
    const { _parish_ids, ...rest } = p;
    return rest;
  };

  fs.writeFileSync(path.join(outputDir, 'enriched-positions.json'), JSON.stringify(publicPositions.map(clean)));
  fs.writeFileSync(path.join(outputDir, 'enriched-extended.json'), JSON.stringify(extendedPositions.map(clean)));

  // Position-church map
  const positionChurchMap = {};
  for (const p of positions) {
    if (p.church_infos?.length > 0 && p._parish_ids?.length > 0) {
      positionChurchMap[p.id] = {
        parish_id: p._parish_ids[0],
        confidence: p.match_confidence,
      };
    }
  }
  fs.writeFileSync(path.join(outputDir, 'position-church-map.json'), JSON.stringify(positionChurchMap));

  // Scraper meta (changes.json, meta.json, etc.)
  const db = getDb();
  for (const key of ['changes', 'meta', 'all_profiles', 'profile_fields']) {
    const row = db.prepare('SELECT value FROM scraper_meta WHERE key = ?').get(key);
    if (row) {
      const filename = key.replace(/_/g, '-') + '.json';
      // all_profiles -> all-profiles.json, profile_fields -> profile-fields.json
      fs.writeFileSync(path.join(outputDir, filename), row.value);
    }
  }

  console.log(`Output written to ${outputDir}`);
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const skipIdx = args.indexOf('--skip');
  const skip = skipIdx >= 0 ? args[skipIdx + 1].split(',') : [];
  const outputDir = args.find(a => !a.startsWith('--')) || path.join(__dirname, '../public/data');

  const result = runPipeline({ skip });
  writeOutput(result.positions, outputDir);
  closeDb();
}

module.exports = { runPipeline, writeOutput, loadPositions };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/run-enrichment.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/run-enrichment.js web/scripts/__tests__/run-enrichment.test.js
git commit -m "feat: create enrichment pipeline runner with staged modules"
```

---

## Task 13: Per-Token Clergy File Generation

Replace `generate-clergy-tokens.js` (which writes a single 21MB file) with `generate-clergy-data.js` that writes individual per-token files.

**Files:**
- Create: `web/scripts/generate-clergy-data.js`
- Create: `web/scripts/__tests__/generate-clergy-data.test.js`

- [ ] **Step 1: Write failing test**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb, closeDb } from '../db.js';

let db;
let tmpDir;

beforeEach(() => {
  process.env.VOCATIONHUB_DB_PATH = ':memory:';
  process.env.CLERGY_TOKEN_SECRET = 'test-secret-key';
  db = getDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clergy-test-'));

  db.prepare(`INSERT INTO clergy (guid, first_name, last_name) VALUES ('g1', 'Jane', 'Doe')`).run();
  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, lat, lng, source)
    VALUES (1, '100', 'St. Paul''s', 'Massachusetts', 'Boston', 'MA', 42.35, -71.06, 'asset_map')`).run();
  db.prepare(`INSERT INTO clergy_positions (clergy_guid, parish_id, position_title, start_date, is_current)
    VALUES ('g1', 1, 'Rector', '2020-01-01', 1)`).run();
});

afterEach(() => {
  closeDb();
  delete process.env.VOCATIONHUB_DB_PATH;
  delete process.env.CLERGY_TOKEN_SECRET;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('generate-clergy-data', () => {
  it('should generate per-token JSON files', () => {
    const { generateClergyData } = require('../generate-clergy-data.js');
    const result = generateClergyData({ db, outputDir: tmpDir });

    // Should create clergy subdirectory
    const clergyDir = path.join(tmpDir, 'clergy');
    expect(fs.existsSync(clergyDir)).toBe(true);

    // Should have one token file
    const files = fs.readdirSync(clergyDir).filter(f => f.endsWith('.json'));
    expect(files).toHaveLength(1);

    // Token file should contain PersonalData
    const data = JSON.parse(fs.readFileSync(path.join(clergyDir, files[0])));
    expect(data.name).toBe('Jane Doe');
    expect(data.current_position.title).toBe('Rector');
  });

  it('should generate clergy-search-index.json', () => {
    const { generateClergyData } = require('../generate-clergy-data.js');
    generateClergyData({ db, outputDir: tmpDir });

    const indexPath = path.join(tmpDir, 'clergy-search-index.json');
    expect(fs.existsSync(indexPath)).toBe(true);

    const index = JSON.parse(fs.readFileSync(indexPath));
    expect(index).toHaveLength(1);
    expect(index[0].name).toBe('Jane Doe');
    expect(index[0].token).toBeTruthy();
    expect(index[0].token).toHaveLength(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/generate-clergy-data.test.js`
Expected: FAIL

- [ ] **Step 3: Create the script**

Port logic from `generate-clergy-tokens.js` (354 lines) but write per-token files instead of one large map:

```javascript
// web/scripts/generate-clergy-data.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb, closeDb } = require('./db.js');

function generateToken(guid, secret) {
  return crypto.createHmac('sha256', secret)
    .update(guid)
    .digest('base64url')
    .slice(0, 12);
}

function buildPersonalData(guid, db) {
  const clergy = db.prepare('SELECT * FROM clergy WHERE guid = ?').get(guid);
  if (!clergy) return null;

  const name = [clergy.first_name, clergy.middle_name, clergy.last_name, clergy.suffix]
    .filter(Boolean).join(' ');

  const positions = db.prepare(`
    SELECT cp.*, p.name as parish_name, p.diocese, p.city, p.state, p.nid
    FROM clergy_positions cp
    LEFT JOIN parishes p ON p.id = cp.parish_id
    WHERE cp.clergy_guid = ?
    ORDER BY cp.start_date DESC
  `).all(guid);

  const current = positions.find(p => p.is_current);
  const currentPosition = current ? {
    title: current.position_title,
    parish: current.parish_name,
    parish_id: current.parish_id,
    start_date: current.start_date,
    diocese: current.diocese,
    city: current.city,
    state: current.state,
  } : null;

  const ordinationYear = clergy.priesting_date
    ? new Date(clergy.priesting_date).getFullYear()
    : clergy.diaconate_date
      ? new Date(clergy.diaconate_date).getFullYear()
      : null;

  const experienceYears = ordinationYear
    ? new Date().getFullYear() - ordinationYear
    : null;

  // Compensation benchmarks
  let compensation_benchmarks = null;
  if (current?.diocese) {
    const diocese = current.diocese.replace(/^(episcopal\s+)?diocese\s+(of\s+)?/i, '').trim().toLowerCase();
    const diocComp = db.prepare(
      'SELECT all_median, female_median, male_median FROM compensation_diocesan WHERE diocese = ? ORDER BY year DESC LIMIT 1'
    ).get(diocese);

    compensation_benchmarks = {
      diocese_median: diocComp?.all_median || null,
      asa_bucket_median: null,
      position_type_median: null,
      experience_bracket_median: null,
    };
  }

  // Current parish context
  let current_parish = null;
  if (current?.nid) {
    const parochial = db.prepare(
      'SELECT * FROM parochial_data WHERE parish_nid = ? ORDER BY year DESC LIMIT 1'
    ).get(current.nid);

    const parish = db.prepare('SELECT lat, lng, zip FROM parishes WHERE id = ?').get(current.parish_id);
    const census = parish?.zip ? db.prepare('SELECT median_income, population FROM census_data WHERE zip = ?').get(parish.zip) : null;

    current_parish = {
      asa: parochial?.average_attendance || null,
      plate_pledge: parochial?.plate_and_pledge || null,
      membership: parochial?.membership || null,
      operating_revenue: parochial?.operating_revenue || null,
      lat: parish?.lat || null,
      lng: parish?.lng || null,
      census_median_income: census?.median_income || null,
      census_population: census?.population || null,
    };
  }

  return {
    name,
    clergy_guid: guid,
    current_position: currentPosition,
    ordination_year: ordinationYear,
    experience_years: experienceYears,
    positions: positions.map(p => ({
      title: p.position_title,
      parish: p.parish_name,
      parish_id: p.parish_id,
      diocese: p.diocese,
      city: p.city,
      state: p.state,
      start_year: p.start_date ? new Date(p.start_date).getFullYear() : null,
      end_year: p.end_date ? new Date(p.end_date).getFullYear() : null,
      is_current: !!p.is_current,
    })),
    compensation_benchmarks,
    current_parish,
  };
}

function generateClergyData({ db: providedDb, outputDir } = {}) {
  const db = providedDb || getDb();
  const secret = process.env.CLERGY_TOKEN_SECRET;
  if (!secret) throw new Error('CLERGY_TOKEN_SECRET environment variable is required');

  const clergyDir = path.join(outputDir, 'clergy');
  if (!fs.existsSync(clergyDir)) fs.mkdirSync(clergyDir, { recursive: true });

  const allClergy = db.prepare('SELECT guid FROM clergy').all();
  const searchIndex = [];
  const tokens = new Set();
  let written = 0;

  for (const { guid } of allClergy) {
    const token = generateToken(guid, secret);

    if (tokens.has(token)) {
      console.error(`Token collision for ${guid}! Aborting.`);
      process.exit(1);
    }
    tokens.add(token);

    const data = buildPersonalData(guid, db);
    if (!data) continue;

    // Write individual token file
    fs.writeFileSync(path.join(clergyDir, `${token}.json`), JSON.stringify(data));
    written++;

    // Build search index entry
    searchIndex.push({
      token,
      name: data.name,
      diocese: data.current_position?.diocese || null,
      current_position: data.current_position?.title || null,
      current_parish: data.current_position?.parish || null,
      city: data.current_position?.city || null,
      state: data.current_position?.state || null,
      ordination_year: data.ordination_year,
    });

    // Audit trail
    db.prepare(
      'INSERT OR REPLACE INTO clergy_tokens (token, clergy_guid) VALUES (?, ?)'
    ).run(token, guid);
  }

  fs.writeFileSync(path.join(outputDir, 'clergy-search-index.json'), JSON.stringify(searchIndex));

  console.log(`Generated ${written} clergy token files and search index (${searchIndex.length} entries)`);
  return { count: written, searchIndexCount: searchIndex.length };
}

if (require.main === module) {
  const outputDir = process.argv[2] || path.join(__dirname, '../public/data');
  generateClergyData({ outputDir });
  closeDb();
}

module.exports = { generateClergyData, generateToken, buildPersonalData };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/generate-clergy-data.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/generate-clergy-data.js web/scripts/__tests__/generate-clergy-data.test.js
git commit -m "feat: per-token clergy file generation replacing monolithic clergy-tokens.json"
```

---

## Task 14: Frontend -- Per-Token Clergy Fetch

Update the `/me` page and `PositionTable` to fetch individual clergy files instead of the full 21MB blob.

**Files:**
- Modify: `web/src/app/me/page.tsx`
- Modify: `web/src/components/PositionTable.tsx`

- [ ] **Step 1: Update me/page.tsx**

Replace the bulk fetch of `clergy-tokens.json` with a per-token fetch. In `web/src/app/me/page.tsx`, find the effect that fetches clergy data (around line 35):

Replace:
```typescript
fetch(`${base}/data/clergy-tokens.json`).then(r => r.json())
```

With:
```typescript
fetch(`${base}/data/clergy/${token}.json`).then(r => {
  if (!r.ok) return null;
  return r.json();
})
```

And update the code that previously did `tokenMap[token]` to use the fetched data directly. The effect should look like:

```typescript
useEffect(() => {
  if (!token) return;
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';

  Promise.all([
    fetch(`${base}/data/clergy/${token}.json`).then(r => r.ok ? r.json() : null),
    fetch(`${base}/data/enriched-positions.json`).then(r => r.json()),
  ]).then(([personalData, positions]) => {
    setPersonalData(personalData);
    setPositions(positions);
  });
}, [token]);
```

Remove the `tokenMap` state variable and any code that indexes into it.

- [ ] **Step 2: Update PositionTable.tsx**

Find where `PositionTable.tsx` loads `clergy-tokens.json` (around line 130) and replace with per-token fetches on demand, or remove the dependency entirely if the component only needs it for display purposes that can be handled by the enriched position data.

The exact change depends on what PositionTable uses the token map for. Read the component to determine the minimal change. If it's using the token map to show "current clergy" info on positions, that data is now available in the enriched position's `clergy` field from the clergy-context stage.

- [ ] **Step 3: Verify the build works**

Run: `cd web && npx next build`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add web/src/app/me/page.tsx web/src/components/PositionTable.tsx
git commit -m "feat: fetch per-token clergy files instead of bulk clergy-tokens.json"
```

---

## Task 15: Validate Enrichment Output Parity

Before switching workflows, verify that the new pipeline produces equivalent output to the old monolith.

**Files:**
- No new files -- this is a validation task

- [ ] **Step 1: Run old enrichment and save output**

```bash
cd web
node scripts/enrich-positions-v2.js
cp public/data/enriched-positions.json /tmp/old-enriched-positions.json
cp public/data/enriched-extended.json /tmp/old-enriched-extended.json
```

- [ ] **Step 2: Run new pipeline and save output**

```bash
node scripts/run-enrichment.js /tmp/new-output/
```

- [ ] **Step 3: Diff the outputs**

```bash
# Use jq to sort keys for stable comparison
cat /tmp/old-enriched-positions.json | python -m json.tool --sort-keys > /tmp/old-sorted.json
cat /tmp/new-output/enriched-positions.json | python -m json.tool --sort-keys > /tmp/new-sorted.json
diff /tmp/old-sorted.json /tmp/new-sorted.json | head -50
```

Expected: Outputs should be structurally equivalent. Minor differences are acceptable (field ordering, null vs missing). Major differences (missing positions, wrong match results, different scores) indicate bugs to fix.

- [ ] **Step 4: Fix any discrepancies**

If the diff reveals differences, read the relevant stage module and the corresponding section of `enrich-positions-v2.js` to identify the logic gap. Fix and re-run until outputs match.

- [ ] **Step 5: Commit any fixes**

```bash
git add -u
git commit -m "fix: align new enrichment pipeline output with original"
```

---

## Task 16: Build & Deploy Workflow

Create the unified build-and-deploy workflow.

**Files:**
- Create: `.github/workflows/build-and-deploy.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
# .github/workflows/build-and-deploy.yml
name: Build and Deploy

on:
  repository_dispatch:
    types: [build]
  schedule:
    - cron: '0 12 * * *'  # Daily fallback at 12pm UTC
  push:
    branches: [main]
    paths:
      - 'web/src/**'
      - 'web/scripts/**'
      - 'web/public/**'
      - 'web/next.config.*'
      - 'web/package.json'
  workflow_dispatch:

concurrency:
  group: build-deploy
  cancel-in-progress: false

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Download database
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release download db-latest \
            --pattern 'vocationhub.db' \
            --dir data/ \
            --clobber || echo "No DB release found, using empty DB"

      - name: Run enrichment pipeline
        env:
          VOCATIONHUB_DB_PATH: data/vocationhub.db
        run: node web/scripts/run-enrichment.js web/public/data/

      - name: Generate clergy data
        env:
          VOCATIONHUB_DB_PATH: data/vocationhub.db
          CLERGY_TOKEN_SECRET: ${{ secrets.CLERGY_TOKEN_SECRET }}
        run: node web/scripts/generate-clergy-data.js web/public/data/

      - name: Run tests
        run: npm run test --workspace=scraper

      - name: Lint
        run: npm run lint --workspace=web

      - name: Build static site
        run: npx next build
        working-directory: web

      - name: Upload pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: web/out

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build-and-deploy.yml
git commit -m "feat: create unified build-and-deploy workflow"
```

---

## Task 17: Update Scraper Workflow

Replace `scrape.yml` with `scrape-positions.yml` that writes to DB and fires a build dispatch instead of committing JSON.

**Files:**
- Create: `.github/workflows/scrape-positions.yml`

- [ ] **Step 1: Create the new workflow**

```yaml
# .github/workflows/scrape-positions.yml
name: Scrape Positions

on:
  schedule:
    - cron: '0 6,18 * * *'  # Twice daily
  workflow_dispatch:

concurrency:
  group: scrape-positions
  cancel-in-progress: true

permissions:
  contents: write

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install chromium
        working-directory: scraper

      - name: Download database
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          mkdir -p data
          gh release download db-latest \
            --pattern 'vocationhub.db' \
            --dir data/ \
            --clobber || echo "No DB release found, initializing new DB"

      - name: Run scraper
        env:
          VOCATIONHUB_DB_PATH: ${{ github.workspace }}/data/vocationhub.db
        run: npm run scrape --workspace=scraper
        timeout-minutes: 30

      - name: Upload database
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release upload db-latest \
            data/vocationhub.db \
            --clobber

      - name: Trigger build
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh api repos/${{ github.repository }}/dispatches \
            -f event_type=build
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/scrape-positions.yml
git commit -m "feat: create scrape-positions workflow (DB-only, no git commits)"
```

---

## Task 18: Update Data Refresh Workflow

Replace `church-directory.yml` and `data-refresh.yml` with a single `data-refresh-v2.yml`.

**Files:**
- Create: `.github/workflows/data-refresh-v2.yml`

- [ ] **Step 1: Create the new workflow**

```yaml
# .github/workflows/data-refresh-v2.yml
name: Monthly Data Refresh

on:
  schedule:
    - cron: '0 5 1 * *'  # 1st of month at 5am UTC
  workflow_dispatch:

concurrency:
  group: data-refresh
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install chromium
        working-directory: scraper

      - name: Download database
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          mkdir -p data
          gh release download db-latest \
            --pattern 'vocationhub.db' \
            --dir data/ \
            --clobber || echo "No DB release found"

      - name: Scrape Asset Map churches
        env:
          VOCATIONHUB_DB_PATH: ${{ github.workspace }}/data/vocationhub.db
        run: npm run scrape:churches --workspace=scraper
        timeout-minutes: 60

      - name: Import Asset Map to DB
        env:
          VOCATIONHUB_DB_PATH: ${{ github.workspace }}/data/vocationhub.db
        run: node web/scripts/import-asset-map.js

      - name: Fetch ECDPlus parishes
        env:
          VOCATIONHUB_DB_PATH: ${{ github.workspace }}/data/vocationhub.db
        run: node web/scripts/fetch-ecdplus-parishes.js
        timeout-minutes: 30

      - name: Fetch ECDPlus clergy
        env:
          VOCATIONHUB_DB_PATH: ${{ github.workspace }}/data/vocationhub.db
        run: node web/scripts/fetch-ecdplus-clergy.js
        timeout-minutes: 30

      - name: Merge parishes
        env:
          VOCATIONHUB_DB_PATH: ${{ github.workspace }}/data/vocationhub.db
        run: node web/scripts/merge-parishes.js

      - name: Scrape parochial reports
        env:
          VOCATIONHUB_DB_PATH: ${{ github.workspace }}/data/vocationhub.db
        run: npm run scrape:parochial --workspace=scraper
        timeout-minutes: 30

      - name: Import parochial data
        env:
          VOCATIONHUB_DB_PATH: ${{ github.workspace }}/data/vocationhub.db
        run: node web/scripts/import-parochial-data.js

      - name: Upload database
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release upload db-latest \
            data/vocationhub.db \
            --clobber

      - name: Trigger build
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh api repos/${{ github.repository }}/dispatches \
            -f event_type=build
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/data-refresh-v2.yml
git commit -m "feat: create unified data-refresh-v2 workflow (DB-only, no git commits)"
```

---

## Task 19: Cut Over -- Remove Old Workflows and Git-Tracked JSON

This is the final switchover. Only do this after validating Tasks 15-18 work correctly.

**Files:**
- Delete: `.github/workflows/scrape.yml`
- Delete: `.github/workflows/church-directory.yml`
- Delete: `.github/workflows/data-refresh.yml`
- Delete: `.github/workflows/deploy.yml` (replaced by build-and-deploy.yml)
- Modify: `.gitignore`
- Delete from git tracking: `web/public/data/*.json` (generated files only)

- [ ] **Step 1: Remove old workflows**

```bash
git rm .github/workflows/scrape.yml
git rm .github/workflows/church-directory.yml
git rm .github/workflows/data-refresh.yml
git rm .github/workflows/deploy.yml
```

- [ ] **Step 2: Remove generated JSON from git tracking**

Add to `.gitignore`:
```
# Generated data files (produced by build workflow)
web/public/data/enriched-positions.json
web/public/data/enriched-extended.json
web/public/data/clergy-tokens.json
web/public/data/clergy-search-index.json
web/public/data/position-church-map.json
web/public/data/churches.json
web/public/data/parochial-data.json
web/public/data/church-registry.json
web/public/data/all-profiles.json
web/public/data/profile-fields.json
web/public/data/positions.json
web/public/data/changes.json
web/public/data/meta.json
web/public/data/detail-history.json
web/public/data/needs-backfill.json
web/public/data/clergy/
```

Then remove from git index (keeps local files):
```bash
git rm --cached web/public/data/enriched-positions.json
git rm --cached web/public/data/enriched-extended.json
git rm --cached web/public/data/clergy-tokens.json
git rm --cached web/public/data/clergy-search-index.json
git rm --cached web/public/data/position-church-map.json
git rm --cached web/public/data/churches.json
git rm --cached web/public/data/parochial-data.json
git rm --cached web/public/data/church-registry.json
git rm --cached web/public/data/all-profiles.json
git rm --cached web/public/data/profile-fields.json
git rm --cached web/public/data/positions.json
git rm --cached web/public/data/changes.json
git rm --cached web/public/data/meta.json
git rm --cached web/public/data/detail-history.json
git rm --cached web/public/data/needs-backfill.json
```

Note: some of these files may not exist. The `--cached` flag is safe -- it only removes from git index, not from disk.

- [ ] **Step 3: Remove deprecated scripts**

```bash
git rm web/scripts/enrich-positions-v2.js
git rm web/scripts/generate-clergy-tokens.js
git rm web/scripts/build-position-map.js
git rm web/scripts/build-registry.js
git rm web/scripts/enrich-positions.js
```

Note: verify each file exists before removing. Some may already be deleted.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: remove old workflows, untrack generated JSON, delete deprecated scripts"
```

---

## Task Summary

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1 | Add new DB tables | None |
| 2 | Scraper DB export | Task 1 |
| 3 | Stage: match-parishes | Task 1 |
| 4 | Stage: backfill-coordinates | Task 1 |
| 5 | Stage: attach-parochial | Task 1 |
| 6 | Stage: attach-census | Task 1 |
| 7 | Stage: compute-compensation | Task 1 |
| 8 | Stage: compute-percentiles | Task 1 |
| 9 | Stage: find-similar | Task 1 |
| 10 | Stage: clergy-context | Task 1 |
| 11 | Stage: quality-scores | None |
| 12 | Pipeline runner | Tasks 3-11 |
| 13 | Per-token clergy generation | Task 1 |
| 14 | Frontend per-token fetch | Task 13 |
| 15 | Validate output parity | Tasks 12, 13 |
| 16 | Build & deploy workflow | Tasks 12, 13 |
| 17 | Scraper workflow | Task 2 |
| 18 | Data refresh workflow | Task 1 |
| 19 | Cut over | Tasks 15-18 |

**Parallelizable:** Tasks 3-11 can all be built in parallel (they share no code dependencies). Task 2 is independent of 3-11. Tasks 16-18 can be built in parallel.
