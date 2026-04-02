# Parish Identity System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent parish identity table that maps Asset Map parishes (NID) to ECDPlus parishes (ecdplus_id), so matching improves over time and cross-source merges are deterministic.

**Architecture:** Enhance `merge-parishes.js` to write matched pairs to the `parish_identity` table (already created in Plan A). Enhance `match-parishes.js` to consult the identity table before running heuristics. Add a CLI tool for manual review/confirmation of low-confidence matches.

**Tech Stack:** Node.js, better-sqlite3, Vitest

**Spec:** `docs/superpowers/specs/2026-04-01-data-pipeline-redesign-design.md` (Section: Parish Identity System)

---

## File Structure

### New Files
- `web/scripts/populate-parish-identity.js` -- extracts identity population from merge-parishes into a focused script
- `web/scripts/confirm-parish-matches.js` -- CLI tool for reviewing/confirming auto-matched parishes
- `web/scripts/__tests__/populate-parish-identity.test.js`
- `web/scripts/__tests__/confirm-parish-matches.test.js`

### Modified Files
- `web/scripts/merge-parishes.js` -- call populate-parish-identity after merge, use identity table to skip re-matching
- `web/scripts/stages/match-parishes.js` -- consult parish_identity before heuristic matching
- `web/scripts/__tests__/stages/match-parishes.test.js` -- add identity table tests

---

## Task 1: Populate Parish Identity from Existing Merges

Seed the identity table from parishes that have already been merged (source='both' with both nid and ecdplus_id).

**Files:**
- Create: `web/scripts/populate-parish-identity.js`
- Create: `web/scripts/__tests__/populate-parish-identity.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// web/scripts/__tests__/populate-parish-identity.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../db.js';

let db;

beforeEach(() => {
  process.env.VOCATIONHUB_DB_PATH = ':memory:';
  db = getDb();
});

afterEach(() => { closeDb(); delete process.env.VOCATIONHUB_DB_PATH; });

describe('seedFromExistingMerges', () => {
  it('should populate identity table from source=both parishes', () => {
    db.prepare(`INSERT INTO parishes (id, nid, ecdplus_id, name, diocese, source)
      VALUES (1, '100', 'ECD-1', 'St. Paul''s', 'Massachusetts', 'both')`).run();

    const { seedFromExistingMerges } = require('../populate-parish-identity.js');
    const result = seedFromExistingMerges(db);

    expect(result.seeded).toBe(1);
    const row = db.prepare('SELECT * FROM parish_identity WHERE nid = ? AND ecdplus_id = ?').get('100', 'ECD-1');
    expect(row).toBeTruthy();
    expect(row.confidence).toBe('confirmed');
    expect(row.match_method).toBe('existing_merge');
  });

  it('should skip parishes already in identity table', () => {
    db.prepare(`INSERT INTO parishes (id, nid, ecdplus_id, name, diocese, source)
      VALUES (1, '100', 'ECD-1', 'St. Paul''s', 'Massachusetts', 'both')`).run();
    db.prepare(`INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method)
      VALUES ('100', 'ECD-1', 'confirmed', 'phone')`).run();

    const { seedFromExistingMerges } = require('../populate-parish-identity.js');
    const result = seedFromExistingMerges(db);

    expect(result.seeded).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should skip parishes missing nid or ecdplus_id', () => {
    db.prepare(`INSERT INTO parishes (id, nid, name, diocese, source)
      VALUES (1, '100', 'St. Paul''s', 'Massachusetts', 'asset_map')`).run();

    const { seedFromExistingMerges } = require('../populate-parish-identity.js');
    const result = seedFromExistingMerges(db);

    expect(result.seeded).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/populate-parish-identity.test.js`
Expected: FAIL -- module does not exist

- [ ] **Step 3: Implement seedFromExistingMerges**

```javascript
// web/scripts/populate-parish-identity.js
const { getDb, closeDb } = require('./db.js');

function seedFromExistingMerges(db) {
  const bothParishes = db.prepare(
    `SELECT nid, ecdplus_id FROM parishes
     WHERE source = 'both' AND nid IS NOT NULL AND ecdplus_id IS NOT NULL`
  ).all();

  const checkExisting = db.prepare(
    'SELECT 1 FROM parish_identity WHERE nid = ? AND ecdplus_id = ?'
  );
  const insertIdentity = db.prepare(
    `INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method, confirmed_at)
     VALUES (?, ?, 'confirmed', 'existing_merge', datetime('now'))`
  );

  let seeded = 0;
  let skipped = 0;

  const run = db.transaction(() => {
    for (const { nid, ecdplus_id } of bothParishes) {
      if (checkExisting.get(nid, ecdplus_id)) {
        skipped++;
        continue;
      }
      insertIdentity.run(nid, ecdplus_id);
      seeded++;
    }
  });

  run();
  console.log(`Seeded ${seeded} identity records from existing merges (${skipped} already existed)`);
  return { seeded, skipped };
}

module.exports = { seedFromExistingMerges };

if (require.main === module) {
  const db = getDb();
  seedFromExistingMerges(db);
  closeDb();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/populate-parish-identity.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/populate-parish-identity.js web/scripts/__tests__/populate-parish-identity.test.js
git commit -m "feat: seed parish_identity table from existing merged parishes"
```

---

## Task 2: Record Identity During Merge

Enhance `merge-parishes.js` to write to `parish_identity` when it matches an ECDPlus parish to an Asset Map parish. Also skip re-matching for pairs already in the identity table.

**Files:**
- Modify: `web/scripts/merge-parishes.js`

- [ ] **Step 1: Write failing tests for identity integration**

Add a new test file for merge-parishes identity behavior:

```javascript
// web/scripts/__tests__/merge-parishes-identity.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../db.js';

let db;

beforeEach(() => {
  process.env.VOCATIONHUB_DB_PATH = ':memory:';
  db = getDb();
});

afterEach(() => { closeDb(); delete process.env.VOCATIONHUB_DB_PATH; });

describe('merge-parishes identity table integration', () => {
  it('should write to parish_identity after successful heuristic merge', () => {
    // Asset Map parish
    db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, phone, source)
      VALUES (1, '100', 'St. Paul''s', 'Massachusetts', 'Boston', 'MA', '617-555-1234', 'asset_map')`).run();
    db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
      VALUES (1, 'St. Paul''s', 'st pauls', 'asset_map')`).run();
    // ECDPlus parish with same phone
    db.prepare(`INSERT INTO parishes (id, ecdplus_id, name, diocese, city, state, phone, source)
      VALUES (2, 'ECD-1', 'Saint Paul''s Episcopal', 'Massachusetts', 'Boston', 'MA', '617-555-1234', 'ecdplus')`).run();

    const { mergeParishes } = require('../merge-parishes.js');
    mergeParishes(db);

    const row = db.prepare('SELECT * FROM parish_identity WHERE nid = ? AND ecdplus_id = ?').get('100', 'ECD-1');
    expect(row).toBeTruthy();
    expect(row.confidence).toBe('confirmed'); // phone match = confirmed
    expect(row.match_method).toBe('phone');
  });

  it('should use identity table instead of heuristics when match exists', () => {
    // Asset Map parish
    db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
      VALUES (1, '100', 'St. Paul''s', 'Massachusetts', 'Boston', 'MA', 'asset_map')`).run();
    // ECDPlus parish with DIFFERENT name (would not match heuristically)
    db.prepare(`INSERT INTO parishes (id, ecdplus_id, name, diocese, city, state, source)
      VALUES (2, 'ECD-1', 'Completely Different Name', 'Massachusetts', 'Boston', 'MA', 'ecdplus')`).run();
    // Pre-existing identity link
    db.prepare(`INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method)
      VALUES ('100', 'ECD-1', 'confirmed', 'phone')`).run();

    const { mergeParishes } = require('../merge-parishes.js');
    const result = mergeParishes(db);

    expect(result.merged).toBe(1);
    // Parish should now be source='both'
    const parish = db.prepare('SELECT * FROM parishes WHERE nid = ?').get('100');
    expect(parish.source).toBe('both');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/merge-parishes-identity.test.js`
Expected: FAIL (identity behavior not implemented yet)

- [ ] **Step 3: Add identity table check at start of merge loop**

In `merge-parishes.js`, at the top of the merge loop (where it iterates ECDPlus parishes), add a check: if this ECDPlus parish's `ecdplus_id` is already in `parish_identity`, look up the Asset Map parish by the linked `nid` and use that as the match (skip heuristic matching).

Add before the `findMatch` call inside the loop:

```javascript
// Check identity table first
const identityCheckStmt = db.prepare(
  `SELECT pi.nid, p.id as parish_id FROM parish_identity pi
   JOIN parishes p ON p.nid = pi.nid
   WHERE pi.ecdplus_id = ?`
);

// Inside the loop, before findMatch:
const identityMatch = identityCheckStmt.get(ecdParish.ecdplus_id);
if (identityMatch) {
  const assetMapParish = db.prepare('SELECT * FROM parishes WHERE id = ?').get(identityMatch.parish_id);
  if (assetMapParish) {
    match = { parish: assetMapParish, method: 'identity_table', confidence: 'confirmed' };
  }
}

if (!match) {
  match = findMatch(db, ecdParish);
}
```

- [ ] **Step 3: Write to identity table after successful merge**

After the merge succeeds (ECDPlus row merged into Asset Map row), record the identity if not already present:

```javascript
const insertIdentity = db.prepare(
  `INSERT OR IGNORE INTO parish_identity (nid, ecdplus_id, confidence, match_method)
   VALUES (?, ?, ?, ?)`
);

// After successful merge:
if (assetMapParish.nid && ecdParish.ecdplus_id) {
  const confidence = match.method === 'identity_table' ? 'confirmed' :
    (match.method === 'phone' || match.method === 'website') ? 'confirmed' : 'auto';
  insertIdentity.run(assetMapParish.nid, ecdParish.ecdplus_id, confidence, match.method);
}
```

- [ ] **Step 4: Log low-confidence matches**

Add logging via `logFetch` for auto-confidence matches so they can be reviewed:

```javascript
if (confidence === 'auto') {
  console.log(`  Low-confidence match: ${ecdParish.name} (${ecdParish.ecdplus_id}) -> ${assetMapParish.name} (nid=${assetMapParish.nid}) via ${match.method}`);
}
```

- [ ] **Step 5: Run all tests (existing + new)**

Run: `npx vitest run web/scripts/__tests__/merge-parishes-identity.test.js web/scripts/__tests__/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/scripts/merge-parishes.js web/scripts/__tests__/merge-parishes-identity.test.js
git commit -m "feat: record parish identity during merge, check identity table before heuristics"
```

---

## Task 3: Use Identity Table in Position Matching

Enhance `match-parishes.js` to consult the `parish_identity` table as a first-pass strategy before running heuristic matching. When a position's matched parish has an identity link, use it to find the complementary parish (e.g., if matched to an ECDPlus parish, find the Asset Map parish with coordinates).

**Files:**
- Modify: `web/scripts/stages/match-parishes.js`
- Modify: `web/scripts/__tests__/stages/match-parishes.test.js`

- [ ] **Step 1: Write failing test**

Add to `web/scripts/__tests__/stages/match-parishes.test.js`:

```javascript
describe('parish_identity integration', () => {
  it('should enrich ECDPlus match with coords from linked Asset Map parish', () => {
    // Asset Map parish (has coords, but NO alias -- position won't match to it directly)
    db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, lat, lng, source)
      VALUES (1, '100', 'St. Paul''s Church', 'Massachusetts', 'Boston', 'MA', 42.35, -71.06, 'asset_map')`).run();

    // ECDPlus parish (no coords, HAS an alias the position will match)
    db.prepare(`INSERT INTO parishes (id, ecdplus_id, name, diocese, city, state, source)
      VALUES (2, 'ECD-1', 'Saint Paul''s Episcopal', 'Massachusetts', 'Boston', 'MA', 'ecdplus')`).run();
    db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
      VALUES (2, 'Saint Paul''s Episcopal', 'saint pauls episcopal', 'ecdplus')`).run();

    // Identity link: the ECDPlus parish is the same as the Asset Map parish
    db.prepare(`INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method)
      VALUES ('100', 'ECD-1', 'confirmed', 'phone')`).run();

    const positions = [{
      id: 'pos1',
      name: "Saint Paul's Episcopal",
      diocese: 'Massachusetts',
    }];

    const matchParishes = require('../../stages/match-parishes.js');
    const result = matchParishes(positions, db);

    // Should match to ECDPlus parish via alias, then enrich with Asset Map coords
    expect(result[0].church_infos).toHaveLength(1);
    expect(result[0].church_infos[0].lat).toBe(42.35);
    expect(result[0].church_infos[0].lng).toBe(-71.06);
  });

  it('should not overwrite existing coords on matched parish', () => {
    // Asset Map parish with coords AND alias
    db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, lat, lng, source)
      VALUES (1, '100', 'St. Paul''s', 'Massachusetts', 'Boston', 'MA', 42.35, -71.06, 'asset_map')`).run();
    db.prepare(`INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
      VALUES (1, 'St. Paul''s', 'st pauls', 'asset_map')`).run();

    // Identity link exists but matched parish already has coords -- no enrichment needed
    db.prepare(`INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method)
      VALUES ('100', 'ECD-1', 'confirmed', 'phone')`).run();

    const positions = [{
      id: 'pos1',
      name: "St. Paul's",
      diocese: 'Massachusetts',
    }];

    const matchParishes = require('../../stages/match-parishes.js');
    const result = matchParishes(positions, db);

    expect(result[0].church_infos).toHaveLength(1);
    expect(result[0].church_infos[0].lat).toBe(42.35);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/stages/match-parishes.test.js`
Expected: FAIL (identity table not consulted yet)

- [ ] **Step 3: Add identity-aware enrichment to matchPositionToParish**

In `web/scripts/stages/match-parishes.js`, after a match is found by any strategy, check if the matched parish has a linked parish via `parish_identity`. If so, prefer the linked parish that has coordinates (Asset Map parish).

Add a helper function and modify the match result:

```javascript
function enrichMatchWithIdentity(match, db) {
  if (!match || !match.parish) return match;
  const parish = match.parish;

  // If this parish has an nid, check if there's a linked ecdplus parish
  // If this parish has an ecdplus_id, check if there's a linked asset_map parish with coords
  if (parish.ecdplus_id && (!parish.lat || !parish.lng)) {
    const linked = db.prepare(
      `SELECT p.* FROM parish_identity pi
       JOIN parishes p ON p.nid = pi.nid
       WHERE pi.ecdplus_id = ? AND p.lat IS NOT NULL`
    ).get(parish.ecdplus_id);
    if (linked) {
      // Merge: use linked parish's coords but keep original's data
      return {
        ...match,
        parish: { ...parish, lat: linked.lat, lng: linked.lng },
      };
    }
  }

  if (parish.nid && (!parish.ecdplus_id)) {
    const linked = db.prepare(
      `SELECT p.* FROM parish_identity pi
       JOIN parishes p ON p.ecdplus_id = pi.ecdplus_id
       WHERE pi.nid = ?`
    ).get(parish.nid);
    if (linked) {
      // Merge ecdplus data onto asset_map match
      return {
        ...match,
        parish: { ...parish, ecdplus_id: linked.ecdplus_id },
      };
    }
  }

  return match;
}
```

Then in `matchPositionToParish`, before returning any match result, call `enrichMatchWithIdentity(result, db)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/stages/match-parishes.test.js`
Expected: PASS (all existing tests + new identity test)

- [ ] **Step 5: Commit**

```bash
git add web/scripts/stages/match-parishes.js web/scripts/__tests__/stages/match-parishes.test.js
git commit -m "feat: consult parish_identity table during position matching for coord enrichment"
```

---

## Task 4: Confirmation CLI Tool

Create a CLI script that lists unconfirmed (`confidence='auto'`) parish identity matches for manual review.

**Files:**
- Create: `web/scripts/confirm-parish-matches.js`
- Create: `web/scripts/__tests__/confirm-parish-matches.test.js`

- [ ] **Step 1: Write failing test for core functions**

```javascript
// web/scripts/__tests__/confirm-parish-matches.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../db.js';

let db;

beforeEach(() => {
  process.env.VOCATIONHUB_DB_PATH = ':memory:';
  db = getDb();

  db.prepare(`INSERT INTO parishes (id, nid, name, diocese, city, state, source)
    VALUES (1, '100', 'St. Paul''s', 'Massachusetts', 'Boston', 'MA', 'asset_map')`).run();
  db.prepare(`INSERT INTO parishes (id, ecdplus_id, name, diocese, city, state, source)
    VALUES (2, 'ECD-1', 'Saint Paul''s Episcopal', 'Massachusetts', 'Boston', 'MA', 'ecdplus')`).run();
  db.prepare(`INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method)
    VALUES ('100', 'ECD-1', 'auto', 'name_diocese')`).run();
});

afterEach(() => { closeDb(); delete process.env.VOCATIONHUB_DB_PATH; });

describe('confirm-parish-matches', () => {
  it('getUnconfirmedMatches should return auto-confidence matches', () => {
    const { getUnconfirmedMatches } = require('../confirm-parish-matches.js');
    const matches = getUnconfirmedMatches(db);

    expect(matches).toHaveLength(1);
    expect(matches[0].nid).toBe('100');
    expect(matches[0].ecdplus_id).toBe('ECD-1');
    expect(matches[0].asset_map_name).toBe("St. Paul's");
    expect(matches[0].ecdplus_name).toBe("Saint Paul's Episcopal");
    expect(matches[0].match_method).toBe('name_diocese');
  });

  it('confirmMatch should update confidence and confirmed_at', () => {
    const { confirmMatch } = require('../confirm-parish-matches.js');
    confirmMatch(db, '100', 'ECD-1');

    const row = db.prepare('SELECT * FROM parish_identity WHERE nid = ? AND ecdplus_id = ?').get('100', 'ECD-1');
    expect(row.confidence).toBe('confirmed');
    expect(row.confirmed_at).toBeTruthy();
  });

  it('rejectMatch should delete the identity row', () => {
    const { rejectMatch } = require('../confirm-parish-matches.js');
    rejectMatch(db, '100', 'ECD-1');

    const row = db.prepare('SELECT * FROM parish_identity WHERE nid = ? AND ecdplus_id = ?').get('100', 'ECD-1');
    expect(row).toBeUndefined();
  });

  it('getStats should return counts by confidence', () => {
    const { getStats } = require('../confirm-parish-matches.js');
    db.prepare(`INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method, confirmed_at)
      VALUES ('200', 'ECD-2', 'confirmed', 'phone', datetime('now'))`).run();

    const stats = getStats(db);
    expect(stats.auto).toBe(1);
    expect(stats.confirmed).toBe(1);
    expect(stats.total).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/scripts/__tests__/confirm-parish-matches.test.js`
Expected: FAIL

- [ ] **Step 3: Implement the confirmation functions**

```javascript
// web/scripts/confirm-parish-matches.js
const { getDb, closeDb } = require('./db.js');

function getUnconfirmedMatches(db, limit = 50) {
  return db.prepare(`
    SELECT pi.nid, pi.ecdplus_id, pi.match_method, pi.created_at,
      am.name as asset_map_name, am.city as am_city, am.state as am_state,
      am.phone as am_phone, am.website as am_website,
      ec.name as ecdplus_name, ec.city as ec_city, ec.state as ec_state,
      ec.phone as ec_phone, ec.website as ec_website
    FROM parish_identity pi
    LEFT JOIN parishes am ON am.nid = pi.nid
    LEFT JOIN parishes ec ON ec.ecdplus_id = pi.ecdplus_id
    WHERE pi.confidence = 'auto'
    ORDER BY pi.created_at DESC
    LIMIT ?
  `).all(limit);
}

function confirmMatch(db, nid, ecdplusId) {
  db.prepare(
    `UPDATE parish_identity SET confidence = 'confirmed', confirmed_at = datetime('now')
     WHERE nid = ? AND ecdplus_id = ?`
  ).run(nid, ecdplusId);
}

function rejectMatch(db, nid, ecdplusId) {
  db.prepare(
    'DELETE FROM parish_identity WHERE nid = ? AND ecdplus_id = ?'
  ).run(nid, ecdplusId);
}

function getStats(db) {
  const rows = db.prepare(
    'SELECT confidence, COUNT(*) as count FROM parish_identity GROUP BY confidence'
  ).all();
  const stats = { auto: 0, confirmed: 0, total: 0 };
  for (const row of rows) {
    stats[row.confidence] = row.count;
    stats.total += row.count;
  }
  return stats;
}

module.exports = { getUnconfirmedMatches, confirmMatch, rejectMatch, getStats };

if (require.main === module) {
  const db = getDb();
  const args = process.argv.slice(2);
  const command = args[0] || 'list';

  if (command === 'stats') {
    const stats = getStats(db);
    console.log(`Parish identity stats:`);
    console.log(`  Confirmed: ${stats.confirmed}`);
    console.log(`  Auto (unconfirmed): ${stats.auto}`);
    console.log(`  Total: ${stats.total}`);
  } else if (command === 'list') {
    const matches = getUnconfirmedMatches(db);
    if (matches.length === 0) {
      console.log('No unconfirmed matches to review.');
    } else {
      console.log(`${matches.length} unconfirmed matches:\n`);
      for (const m of matches) {
        console.log(`  NID ${m.nid}: ${m.asset_map_name} (${m.am_city}, ${m.am_state})`);
        console.log(`    phone: ${m.am_phone || 'N/A'}  website: ${m.am_website || 'N/A'}`);
        console.log(`  ECD ${m.ecdplus_id}: ${m.ecdplus_name} (${m.ec_city}, ${m.ec_state})`);
        console.log(`    phone: ${m.ec_phone || 'N/A'}  website: ${m.ec_website || 'N/A'}`);
        console.log(`  Matched by: ${m.match_method}  on: ${m.created_at}`);
        console.log();
      }
    }
  } else if (command === 'confirm' && args[1] && args[2]) {
    confirmMatch(db, args[1], args[2]);
    console.log(`Confirmed: NID ${args[1]} = ECDPlus ${args[2]}`);
  } else if (command === 'reject' && args[1] && args[2]) {
    rejectMatch(db, args[1], args[2]);
    console.log(`Rejected: NID ${args[1]} / ECDPlus ${args[2]}`);
  } else if (command === 'confirm-all') {
    const matches = getUnconfirmedMatches(db, 10000);
    const run = db.transaction(() => {
      for (const m of matches) confirmMatch(db, m.nid, m.ecdplus_id);
    });
    run();
    console.log(`Confirmed ${matches.length} matches.`);
  } else {
    console.log('Usage:');
    console.log('  node confirm-parish-matches.js list         # Show unconfirmed matches');
    console.log('  node confirm-parish-matches.js stats        # Show counts');
    console.log('  node confirm-parish-matches.js confirm <nid> <ecdplus_id>');
    console.log('  node confirm-parish-matches.js reject <nid> <ecdplus_id>');
    console.log('  node confirm-parish-matches.js confirm-all  # Confirm all auto matches');
  }

  closeDb();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/scripts/__tests__/confirm-parish-matches.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/scripts/confirm-parish-matches.js web/scripts/__tests__/confirm-parish-matches.test.js
git commit -m "feat: CLI tool for reviewing and confirming parish identity matches"
```

---

## Task 5: Wire Identity Population into Data Refresh Workflow

Add `populate-parish-identity.js` to the data refresh workflow so the identity table is seeded after merge-parishes runs.

**Files:**
- Modify: `.github/workflows/data-refresh-v2.yml`

- [ ] **Step 1: Add identity population step**

In `.github/workflows/data-refresh-v2.yml`, add a step after "Merge parishes" and before "Scrape parochial reports":

```yaml
      - name: Populate parish identity table
        env:
          VOCATIONHUB_DB_PATH: ${{ github.workspace }}/data/vocationhub.db
        run: node web/scripts/populate-parish-identity.js
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/data-refresh-v2.yml
git commit -m "feat: add parish identity population step to data refresh workflow"
```

---

## Task Summary

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1 | Seed identity table from existing merges | None |
| 2 | Record identity during merge, check before re-matching | Task 1 |
| 3 | Use identity table in position matching | Task 1 |
| 4 | Confirmation CLI tool | Task 1 |
| 5 | Wire into data refresh workflow | Tasks 1-2 |

Tasks 3 and 4 are independent of each other (both depend only on Task 1).
