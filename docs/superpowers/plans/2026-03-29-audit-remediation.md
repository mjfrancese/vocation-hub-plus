# Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate findings from 4 independent audits -- fixing correctness bugs, removing duplication, unifying CI/CD, aligning docs/config, and improving maintainability.

**Architecture:** The project is a monorepo with `scraper/` (Playwright + SQLite) and `web/` (Next.js static export). Build scripts in `web/scripts/` enrich scraped data. CI workflows deploy to GitHub Pages. Changes target shared modules, workflow files, config, docs, and frontend status logic.

**Tech Stack:** TypeScript, Next.js 14 (static export), Playwright, SQLite (better-sqlite3), GitHub Actions, Tailwind CSS

---

## File Structure

### New files
- `web/src/lib/normalization.ts` -- shared normalization functions (church name, diocese, phone, URL)
- `shared/diocese-to-state.json` -- canonical diocese-to-state mapping consumed by scraper + web
- `web/.eslintrc.json` -- committed ESLint config for non-interactive lint

### Modified files
- `scraper/src/dioceses.ts` -- import from shared mapping instead of hardcoding
- `web/src/lib/diocese-lookup.ts` -- import from shared mapping instead of hardcoding
- `web/scripts/build-registry.js` -- import shared normalization
- `web/scripts/build-position-map.js` -- import shared normalization
- `web/scripts/enrich-positions.js` -- import shared normalization
- `web/src/lib/church-directory-lookup.ts` -- import shared normalization
- `web/src/lib/parochial-lookup.ts` -- import shared normalization
- `scraper/src/index.ts` -- remove post-export enrichment scripts
- `scraper/src/config.ts` -- align MAX_RUNTIME_MS default
- `.env.example` -- align MAX_RUNTIME_MS default
- `.github/workflows/scrape.yml` -- keep as data-only (no deploy)
- `.github/workflows/deploy.yml` -- sole deployment authority
- `web/src/app/page.tsx` -- fix unknown-status-defaults-to-Closed, remove dead `showNew()`
- `web/src/lib/status-helpers.ts` -- no changes needed (already explicit)
- `docs/ARCHITECTURE.md` -- rewrite to match current implementation
- `docs/SELECTORS.md` -- update to match current selectors
- `README.md` -- update pipeline description and feature set

---

## Task 1: Fix ESLint config so lint is non-interactive

**Files:**
- Create: `web/.eslintrc.json`
- Modify: `web/package.json` (if needed)

**Why:** `npm run lint --workspace=web` currently prompts for ESLint setup interactively, making it unusable in CI. This is the #1 blocker for adding quality gates.

- [ ] **Step 1: Create ESLint config**

```json
{
  "extends": "next/core-web-vitals"
}
```

Write this to `web/.eslintrc.json`.

- [ ] **Step 2: Run lint to verify it works non-interactively**

Run: `npm run lint --workspace=web`
Expected: Lint completes (may have warnings) without prompting for setup.

- [ ] **Step 3: Fix any lint errors that block CI**

Address only errors (not warnings) that would cause a non-zero exit code.

- [ ] **Step 4: Commit**

```bash
git add web/.eslintrc.json
git commit -m "chore: add committed ESLint config for non-interactive lint"
```

---

## Task 2: Unify deployment -- scrape.yml data-only, deploy.yml sole deployer

**Files:**
- Modify: `.github/workflows/scrape.yml` -- remove build/deploy steps
- Modify: `.github/workflows/deploy.yml` -- add `web/public/data/**` path trigger (already present), add quality gates

**Why:** Both `scrape.yml` and `deploy.yml` build and deploy to GitHub Pages. This causes redundant builds and potential race conditions on the same `pages` concurrency group. Since `scrape.yml` commits data changes to `main`, that push already triggers `deploy.yml` via its `push` trigger on `web/public/data/**`.

- [ ] **Step 1: Remove build/deploy steps from scrape.yml**

In `.github/workflows/scrape.yml`, remove everything after the "Commit and push data changes" step:
- Remove "Install web dependencies" step
- Remove "Build frontend" step
- Remove "Upload pages artifact" step
- Remove the entire `deploy` job

Also remove the `pages: write` and `id-token: write` permissions (no longer needed).
Remove the `concurrency` block (no longer deploying).

- [ ] **Step 2: Add lint + test quality gates to deploy.yml**

In `.github/workflows/deploy.yml`, add steps before the build:

```yaml
      - name: Install all dependencies
        run: npm ci

      - name: Run scraper tests
        run: npm run test --workspace=scraper

      - name: Lint frontend
        run: npm run lint --workspace=web
```

- [ ] **Step 3: Verify deploy.yml path triggers cover scrape.yml's data commits**

Confirm `deploy.yml` triggers on `web/public/data/**` pushes to main. (Already present -- just verify.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/scrape.yml .github/workflows/deploy.yml
git commit -m "ci: make scrape.yml data-only, deploy.yml sole deployer with quality gates"
```

---

## Task 3: Remove duplicate enrichment invocation from scraper runtime

**Files:**
- Modify: `scraper/src/index.ts:145-161` -- remove post-export script execution

**Why:** The scraper calls `build-registry.js`, `build-position-map.js`, and `enrich-positions.js` via `execSync` after export. These same scripts also run in `scrape.yml` (line 82) and `deploy.yml` (line 41). The scraper should not own enrichment orchestration -- that belongs to the workflow/build pipeline.

- [ ] **Step 1: Remove post-export script block**

In `scraper/src/index.ts`, remove lines 145-161 (the `webScriptsDir` / `scripts` loop that runs enrichment via `execSync`). Also remove the `execSync` import from `child_process` if no longer used.

- [ ] **Step 2: Run scraper tests to verify no breakage**

Run: `npm run test --workspace=scraper`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add scraper/src/index.ts
git commit -m "refactor: remove enrichment scripts from scraper runtime, workflows handle enrichment"
```

---

## Task 4: Align MAX_RUNTIME_MS in .env.example with code default

**Files:**
- Modify: `.env.example` -- change from `600000` to `840000`

**Why:** `config.ts` defaults to `840000` (14 min) which is intentional -- the scraper ran out of time at 600000. The `.env.example` is stale. Fix the doc, not the code.

- [ ] **Step 1: Update .env.example**

Change `MAX_RUNTIME_MS=600000` to `MAX_RUNTIME_MS=840000`.

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "fix: align .env.example MAX_RUNTIME_MS=840000 with actual code default"
```

---

## Task 5: Fix unknown status defaulting to "Closed" (hides records)

**Files:**
- Modify: `web/src/app/page.tsx:126,158,163` -- change fallback from `'Closed'` to `'Unknown'`
- Modify: `web/src/app/page.tsx:106-111` -- add `'Unknown': []` to STATUS_GROUPS
- Modify: `web/src/app/page.tsx:210-214` -- remove dead `showNew()` function

**Why:** When a position has an unrecognized status string, `statusGroupMap[s]` returns `undefined`, and the `|| 'Closed'` fallback lumps it into the Closed group. Since `hideClosed` defaults to `true`, these positions are invisible on first load. This is a data-hiding correctness bug.

- [ ] **Step 1: Add "Unknown" status group**

In `web/src/app/page.tsx`, change STATUS_GROUPS to:

```typescript
const STATUS_GROUPS: Record<string, string[]> = {
  'Receiving': ['Receiving names', 'Reopened'],
  'Developing': ['Beginning search', 'Developing profile', 'Profile complete', 'Developing self study'],
  'Interim': ['Seeking interim', 'Interim in place'],
  'Closed': ['Search complete', 'No longer receiving names'],
  'Unknown': [],
};
```

- [ ] **Step 2: Change fallback from 'Closed' to 'Unknown'**

In the same file, change all three occurrences of `|| 'Closed'` to `|| 'Unknown'`:

Line 126: `const group = statusGroupMap[s] || 'Unknown';`
Line 158: `const group = statusGroupMap[p.vh_status || p.status || ''] || 'Unknown';`
Line 163: `const group = statusGroupMap[p.vh_status || ''] || 'Unknown';`

- [ ] **Step 3: Remove dead showNew() function**

Delete lines 210-214 (the `showNew()` function). It is never called -- `showNewOnly` state toggle handles this via the chip on line 244.

- [ ] **Step 4: Build to verify no errors**

Run: `npm run build --workspace=web`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/page.tsx
git commit -m "fix: unknown statuses shown as 'Unknown' instead of hidden as 'Closed'"
```

---

## Task 6: Extract shared diocese-to-state mapping

**Files:**
- Create: `shared/diocese-to-state.json` -- canonical mapping
- Modify: `scraper/src/dioceses.ts` -- import from shared JSON
- Modify: `web/src/lib/diocese-lookup.ts` -- import from shared JSON

**Why:** The diocese-to-state mapping is duplicated between `scraper/src/dioceses.ts` (209 entries) and `web/src/lib/diocese-lookup.ts` (209+ entries with extra Wisconsin/Great Lakes). They have already drifted (web has entries scraper lacks). One canonical source eliminates drift.

- [ ] **Step 1: Create the canonical shared mapping**

Export the union of both maps to `shared/diocese-to-state.json`. Use the web version as the base since it is the superset.

```json
{
  "Alabama": "AL",
  "Alaska": "AK",
  ...
}
```

- [ ] **Step 2: Update scraper/src/dioceses.ts to import from shared**

```typescript
import MAPPING from '../../shared/diocese-to-state.json';

export const DIOCESE_TO_STATE: Record<string, string> = MAPPING;

export function getStateForDiocese(diocese: string): string {
  // exact match
  if (DIOCESE_TO_STATE[diocese]) return DIOCESE_TO_STATE[diocese];
  // case-insensitive
  const lower = diocese.toLowerCase();
  for (const [key, value] of Object.entries(DIOCESE_TO_STATE)) {
    if (key.toLowerCase() === lower) return value;
  }
  // partial match
  for (const [key, value] of Object.entries(DIOCESE_TO_STATE)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) return value;
  }
  return '';
}
```

- [ ] **Step 3: Update web/src/lib/diocese-lookup.ts to import from shared**

Same pattern -- import the JSON, keep the `getStateForDiocese` function.

- [ ] **Step 4: Run scraper tests + web build**

Run: `npm run test --workspace=scraper && npm run build --workspace=web`
Expected: Both pass.

- [ ] **Step 5: Commit**

```bash
git add shared/diocese-to-state.json scraper/src/dioceses.ts web/src/lib/diocese-lookup.ts
git commit -m "refactor: extract shared diocese-to-state mapping, eliminate duplication"
```

---

## Task 7: Extract shared normalization utilities

**Files:**
- Create: `web/src/lib/normalization.ts`
- Modify: `web/scripts/build-registry.js` -- import shared functions
- Modify: `web/scripts/build-position-map.js` -- import shared functions
- Modify: `web/scripts/enrich-positions.js` -- import shared functions
- Modify: `web/src/lib/church-directory-lookup.ts` -- import shared functions
- Modify: `web/src/lib/parochial-lookup.ts` -- import shared functions

**Why:** `normalizeChurchName()` is copy-pasted in 3 JS scripts. `normalizeDiocese()` is copy-pasted in 4 locations (2 JS + 2 TS). Any fix to normalization rules must be applied N times today. One module eliminates this.

- [ ] **Step 1: Create web/src/lib/normalization.ts**

```typescript
/**
 * Shared normalization utilities for church/diocese matching.
 * Used by build scripts (via tsx) and frontend TypeScript code.
 */

export function normalizeChurchName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\bsaints?\b/g, 'st')
    .replace(/\bsts\.?\s/g, 'st ')
    .replace(/\bst\.\s*/g, 'st ')
    .replace(/\bmount\b/g, 'mt')
    .replace(/\bmt\.\s*/g, 'mt ')
    .replace(/\s*\/.*$/, '')
    .replace(/['\u2018\u2019`]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/,.*$/, '')
    .replace(/-/g, ' ')
    .replace(/\b(the|of|and|in|at|for|a|an|be)\b/g, '')
    .replace(/\b(episcopal|church|parish|community|chapel|cathedral|mission|memorial)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/([a-z]{4,})s\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDiocese(diocese: string): string {
  return diocese
    .toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/^episcopal\s+church\s+(in\s+)?/i, '')
    .replace(/^episcopal\s+diocese\s+(of\s+)?/i, '')
    .replace(/^diocese\s+of\s+/i, '')
    .replace(/^diocesis\s+de\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

export function normalizeDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`)
      .hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}
```

- [ ] **Step 2: Update build scripts to import from shared module**

The JS build scripts currently define their own copies. Since they run via `node`, they cannot import `.ts` directly. Two options:

**Option A (recommended):** Change scripts to run via `tsx` (already a dev dependency) so they can import TypeScript directly.
**Option B:** Compile the shared module to JS and import the compiled output.

For Option A, update `web/package.json` prebuild scripts and workflow steps to use `npx tsx scripts/build-registry.js` (or rename to `.ts`).

Then in each script, replace the inline function definitions with:
```javascript
import { normalizeChurchName, normalizeDiocese } from '../src/lib/normalization.js';
```

- [ ] **Step 3: Update TypeScript consumers**

In `web/src/lib/church-directory-lookup.ts` and `web/src/lib/parochial-lookup.ts`, replace inline `normalizeDiocese` with:
```typescript
import { normalizeDiocese } from './normalization';
```

- [ ] **Step 4: Run build + verify scripts produce identical output**

Run: `npm run build --workspace=web`
Spot-check that `church-registry.json` and `position-church-map.json` are unchanged (or diff is empty).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/normalization.ts web/scripts/ web/src/lib/church-directory-lookup.ts web/src/lib/parochial-lookup.ts
git commit -m "refactor: extract shared normalization module, remove 7 duplicate function copies"
```

---

## Task 8: Update ARCHITECTURE.md to match current implementation

**Files:**
- Modify: `docs/ARCHITECTURE.md`

**Why:** The doc describes a "select all 50 states one by one" scraping strategy. The scraper now clears filters and uses a single-space community-name search. The doc also describes a 3-table schema; the actual schema has grown. Enrichment pipeline, deep scrape, church directory, and backfill workflows are not documented.

- [ ] **Step 1: Read current ARCHITECTURE.md**

Read the full file to understand what needs updating.

- [ ] **Step 2: Rewrite to match current implementation**

Key sections to update:
- **Scraping strategy**: Describe current clear-filters + space-search approach
- **Multi-phase scrape**: Phase 1 (search table), Phase 2 (discover + detail scrape), Phase 3 (backfill)
- **Database schema**: Document actual tables (positions, position_details, scrape_history, vh_discovery, etc.)
- **Enrichment pipeline**: build-registry -> build-position-map -> enrich-positions
- **Data artifacts**: List all JSON files and their purpose
- **CI/CD topology**: scrape.yml (data), deep-scrape.yml (weekly profiles), church-directory.yml (monthly), deploy.yml (pages)
- **Extended positions**: How profiles beyond search results are surfaced

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: rewrite ARCHITECTURE.md to match current multi-phase pipeline"
```

---

## Task 9: Update SELECTORS.md to match current selectors

**Files:**
- Modify: `docs/SELECTORS.md`

**Why:** Doc lists a "State" column in the results table, but the scraper derives state from diocese (there is no State column). Doc lists `searchButton` as generic text match, but code uses a stricter selector.

- [ ] **Step 1: Read current SELECTORS.md and compare with actual selectors in code**

Read `docs/SELECTORS.md` and `scraper/src/selectors.ts` (or wherever selectors are defined).

- [ ] **Step 2: Update doc to match code**

Fix column descriptions, selector patterns, and any notes about search behavior.

- [ ] **Step 3: Commit**

```bash
git add docs/SELECTORS.md
git commit -m "docs: update SELECTORS.md to match current scraper selectors"
```

---

## Task 10: Update README.md

**Files:**
- Modify: `README.md`

**Why:** README describes a simpler pipeline and feature set. Current codebase includes admin review tooling, deep scrape, church directory matching, parochial data integration, and enrichment layers not reflected in docs. MAX_RUNTIME_MS documentation should match the aligned default.

- [ ] **Step 1: Read current README.md**

- [ ] **Step 2: Update to reflect current feature set**

Key additions:
- Multi-phase scraping pipeline
- Church directory integration (Episcopal Asset Map + parochial reports)
- Enrichment and matching pipeline
- Admin review tooling
- Data artifacts produced
- Correct MAX_RUNTIME_MS default (840000ms / 14 min)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README to reflect current pipeline and features"
```

---

## Task 11: Rename admin "password" to "review access" (document limitation)

**Files:**
- Modify: `web/src/app/admin/page.tsx` -- rename UI copy from "password" to "access code", add visible disclaimer

**Why:** The admin page uses a client-side hash check (`hash === -1077942682`) with `sessionStorage`. This is trivially bypassable in a static site. The audits correctly flag this as "security theater." Rather than adding real auth (overengineered for a static site), we should be honest in the UI about what it is: a casual access gate, not security.

- [ ] **Step 1: Update admin page UI copy**

Change the password prompt text from implying security to something like:
- Label: "Access Code" instead of "Password"
- Add small disclaimer text: "This is a review tool access gate, not a security boundary."

- [ ] **Step 2: Build to verify**

Run: `npm run build --workspace=web`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/admin/page.tsx
git commit -m "chore: rename admin password gate to access code, document limitation"
```

---

## Task 12: Fix React fragment key warning in PositionTable

**Files:**
- Modify: `web/src/components/PositionTable.tsx:212-213` -- move key from `<tr>` to wrapping fragment

**Why:** In `PositionTable.tsx`, the `.map()` at line 212 returns a bare `<>` fragment with the `key` on the inner `<tr>` (line 215). React requires the key on the outermost element returned from `.map()`. This produces a console warning and can cause reconciliation issues when rows expand/collapse.

- [ ] **Step 1: Move key to fragment**

Change:
```tsx
{sorted.map((pos) => (
  <>
    <tr
      key={pos.id}
```

To:
```tsx
{sorted.map((pos) => (
  <React.Fragment key={pos.id}>
    <tr
```

And change the matching closing `</>` to `</React.Fragment>`. Add `React` import if not already present (or use the `Fragment` named import).

- [ ] **Step 2: Build to verify**

Run: `npm run build --workspace=web`
Expected: Build succeeds, no React key warnings in console.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/PositionTable.tsx
git commit -m "fix: move React key to fragment wrapper in PositionTable to fix reconciliation"
```

---

## Task 13: Add test coverage for normalization, date parsing, and status logic

**Files:**
- Create: `web/src/lib/__tests__/normalization.test.ts` -- tests for shared normalization module
- Create: `web/src/lib/__tests__/status-helpers.test.ts` -- tests for status grouping/classification
- Create: `web/src/lib/__tests__/data.test.ts` -- tests for computeIsNew date logic
- Modify: `web/package.json` -- add vitest config/script if not present

**Why:** Only one test file exists (`scraper/tests/diff.test.ts`). The normalization functions (Task 7) and status helpers are critical matching/display logic with no tests. Adding tests after Task 7 (shared module extraction) means we test the canonical implementations.

**Prerequisite:** Task 7 (shared normalization module) must be complete first.

- [ ] **Step 1: Set up vitest for web workspace**

Check if vitest is already configured for web. If not, add to `web/package.json`:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

Run: `npm install --workspace=web`

- [ ] **Step 2: Write normalization tests**

Create `web/src/lib/__tests__/normalization.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeChurchName, normalizeDiocese, normalizePhone, normalizeDomain } from '../normalization';

describe('normalizeChurchName', () => {
  it('normalizes saint abbreviations', () => {
    expect(normalizeChurchName("Saint Mark's")).toBe('st mark');
    expect(normalizeChurchName("St. Mark's")).toBe('st mark');
    expect(normalizeChurchName("Sts. Peter and Paul")).toBe('st peter paul');
  });

  it('strips church-related stop words', () => {
    expect(normalizeChurchName('Trinity Episcopal Church')).toBe('trinity');
    expect(normalizeChurchName('Grace Cathedral Parish')).toBe('grace');
  });

  it('strips parenthetical and bilingual suffixes', () => {
    expect(normalizeChurchName('San Jose (St. Joseph)')).toBe('san jose');
    expect(normalizeChurchName('Iglesia / Church of Hope')).toBe('iglesia');
  });

  it('normalizes mount abbreviation', () => {
    expect(normalizeChurchName('Mount Calvary')).toBe('mt calvary');
  });

  it('handles empty/null input', () => {
    expect(normalizeChurchName('')).toBe('');
  });
});

describe('normalizeDiocese', () => {
  it('strips common diocese prefixes', () => {
    expect(normalizeDiocese('Diocese of Virginia')).toBe('virginia');
    expect(normalizeDiocese('The Episcopal Church in Connecticut')).toBe('connecticut');
    expect(normalizeDiocese('Episcopal Diocese of Fort Worth')).toBe('fort worth');
    expect(normalizeDiocese('Diocesis de Puerto Rico')).toBe('puerto rico');
  });

  it('preserves diocese name without prefix', () => {
    expect(normalizeDiocese('Virginia')).toBe('virginia');
  });
});

describe('normalizePhone', () => {
  it('strips non-digits and leading country code', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('5551234567');
    expect(normalizePhone('+1-555-123-4567')).toBe('5551234567');
    expect(normalizePhone('1-555-123-4567')).toBe('5551234567');
  });

  it('handles empty input', () => {
    expect(normalizePhone('')).toBe('');
  });
});

describe('normalizeDomain', () => {
  it('extracts domain from URL', () => {
    expect(normalizeDomain('https://www.stmarks.org/about')).toBe('stmarks.org');
    expect(normalizeDomain('http://trinity-church.net')).toBe('trinity-church.net');
  });

  it('handles bare domain', () => {
    expect(normalizeDomain('stmarks.org')).toBe('stmarks.org');
  });

  it('handles invalid URL', () => {
    expect(normalizeDomain('not a url at all')).toBe('');
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm run test --workspace=web`
Expected: All tests pass.

- [ ] **Step 4: Write status helper tests**

Create `web/src/lib/__tests__/status-helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getStatusStyle, getStatusShortLabel, isActiveStatus, isClosedStatus, isDevelopingStatus, isInterimStatus } from '../status-helpers';

describe('status classification', () => {
  it('identifies active statuses', () => {
    expect(isActiveStatus('Receiving names')).toBe(true);
    expect(isActiveStatus('Reopened')).toBe(true);
    expect(isActiveStatus('Search complete')).toBe(false);
  });

  it('identifies closed statuses', () => {
    expect(isClosedStatus('Search complete')).toBe(true);
    expect(isClosedStatus('No longer receiving names')).toBe(true);
    expect(isClosedStatus('Receiving names')).toBe(false);
  });

  it('identifies developing statuses', () => {
    expect(isDevelopingStatus('Beginning search')).toBe(true);
    expect(isDevelopingStatus('Developing profile')).toBe(true);
    expect(isDevelopingStatus('Profile complete')).toBe(true);
    expect(isDevelopingStatus('Developing self study')).toBe(true);
    expect(isDevelopingStatus('Receiving names')).toBe(false);
  });

  it('identifies interim statuses', () => {
    expect(isInterimStatus('Seeking interim')).toBe(true);
    expect(isInterimStatus('Interim in place')).toBe(true);
    expect(isInterimStatus('Receiving names')).toBe(false);
  });
});

describe('getStatusShortLabel', () => {
  it('returns short labels for known statuses', () => {
    expect(getStatusShortLabel('Receiving names')).toBe('Receiving');
    expect(getStatusShortLabel('No longer receiving names')).toBe('Closed');
  });

  it('returns "Unknown" for empty status', () => {
    expect(getStatusShortLabel('')).toBe('Unknown');
  });

  it('returns the status itself for unrecognized values', () => {
    expect(getStatusShortLabel('Some New Status')).toBe('Some New Status');
  });
});

describe('getStatusStyle', () => {
  it('returns green for active statuses', () => {
    expect(getStatusStyle('Receiving names')).toContain('green');
  });

  it('returns gray fallback for unknown statuses', () => {
    expect(getStatusStyle('Unknown Status')).toContain('gray');
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=web`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/__tests__/ web/package.json
git commit -m "test: add tests for normalization, status helpers, and date parsing"
```

---

## Task 14: Add scraper data quality checks and run-health summary

**Files:**
- Create: `scraper/src/quality-check.ts` -- data quality threshold checks
- Modify: `scraper/src/index.ts` -- call quality check after export, write to meta.json
- Modify: `scraper/src/export.ts` (or wherever meta.json is written) -- include quality report

**Why:** Scraper phases 2/3 are intentionally non-fatal, but there is no machine-readable indication of degraded runs. A quality check after export that writes pass/fail + reasons into `meta.json` makes regressions detectable downstream (by CI, admin page, or monitoring).

- [ ] **Step 1: Create quality-check module**

Create `scraper/src/quality-check.ts`:

```typescript
export interface QualityReport {
  pass: boolean;
  checks: Array<{
    name: string;
    pass: boolean;
    actual: number;
    threshold: number;
    message: string;
  }>;
}

interface QualityInput {
  totalPositions: number;
  newCount: number;
  expiredCount: number;
  phase2Success: boolean;
  phase3Success: boolean;
}

const THRESHOLDS = {
  /** Minimum positions expected from a healthy scrape */
  minPositions: 50,
  /** Maximum percentage of positions that can expire in one run */
  maxExpiredPct: 50,
};

export function checkQuality(input: QualityInput): QualityReport {
  const checks: QualityReport['checks'] = [];

  // Check 1: minimum position count
  checks.push({
    name: 'min-positions',
    pass: input.totalPositions >= THRESHOLDS.minPositions,
    actual: input.totalPositions,
    threshold: THRESHOLDS.minPositions,
    message: input.totalPositions >= THRESHOLDS.minPositions
      ? `Found ${input.totalPositions} positions (>= ${THRESHOLDS.minPositions})`
      : `Only ${input.totalPositions} positions found (expected >= ${THRESHOLDS.minPositions})`,
  });

  // Check 2: expired percentage
  const expiredPct = input.totalPositions > 0
    ? (input.expiredCount / input.totalPositions) * 100
    : 0;
  checks.push({
    name: 'max-expired-pct',
    pass: expiredPct <= THRESHOLDS.maxExpiredPct,
    actual: Math.round(expiredPct),
    threshold: THRESHOLDS.maxExpiredPct,
    message: expiredPct <= THRESHOLDS.maxExpiredPct
      ? `${Math.round(expiredPct)}% expired (<= ${THRESHOLDS.maxExpiredPct}%)`
      : `${Math.round(expiredPct)}% expired exceeds ${THRESHOLDS.maxExpiredPct}% threshold`,
  });

  // Check 3: phase health
  checks.push({
    name: 'phase2-health',
    pass: input.phase2Success,
    actual: input.phase2Success ? 1 : 0,
    threshold: 1,
    message: input.phase2Success ? 'Phase 2 (discover+scrape) succeeded' : 'Phase 2 (discover+scrape) failed',
  });

  checks.push({
    name: 'phase3-health',
    pass: input.phase3Success,
    actual: input.phase3Success ? 1 : 0,
    threshold: 1,
    message: input.phase3Success ? 'Phase 3 (backfill) succeeded' : 'Phase 3 (backfill) failed',
  });

  return {
    pass: checks.every(c => c.pass),
    checks,
  };
}
```

- [ ] **Step 2: Write tests for quality check**

Create `scraper/tests/quality-check.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checkQuality } from '../src/quality-check';

describe('checkQuality', () => {
  it('passes for healthy scrape', () => {
    const result = checkQuality({
      totalPositions: 200,
      newCount: 5,
      expiredCount: 3,
      phase2Success: true,
      phase3Success: true,
    });
    expect(result.pass).toBe(true);
    expect(result.checks.every(c => c.pass)).toBe(true);
  });

  it('fails when position count is too low', () => {
    const result = checkQuality({
      totalPositions: 10,
      newCount: 0,
      expiredCount: 0,
      phase2Success: true,
      phase3Success: true,
    });
    expect(result.pass).toBe(false);
    expect(result.checks.find(c => c.name === 'min-positions')?.pass).toBe(false);
  });

  it('fails when too many positions expire', () => {
    const result = checkQuality({
      totalPositions: 100,
      newCount: 0,
      expiredCount: 60,
      phase2Success: true,
      phase3Success: true,
    });
    expect(result.pass).toBe(false);
    expect(result.checks.find(c => c.name === 'max-expired-pct')?.pass).toBe(false);
  });

  it('reports phase failures', () => {
    const result = checkQuality({
      totalPositions: 200,
      newCount: 5,
      expiredCount: 3,
      phase2Success: false,
      phase3Success: true,
    });
    expect(result.pass).toBe(false);
    expect(result.checks.find(c => c.name === 'phase2-health')?.pass).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm run test --workspace=scraper`
Expected: All tests pass (existing + new).

- [ ] **Step 4: Integrate into scraper index.ts**

In `scraper/src/index.ts`, after the `logScrape()` and `exportJson()` calls, add:

```typescript
import { checkQuality } from './quality-check';

// After exportJson():
const qualityReport = checkQuality({
  totalPositions: positions.length,
  newCount: diff.newCount,
  expiredCount: diff.expiredCount,
  phase2Success,  // track these booleans from try/catch around phase 2/3
  phase3Success,
});

if (!qualityReport.pass) {
  logger.warn('Data quality check failed', { checks: qualityReport.checks.filter(c => !c.pass) });
}
```

Include `qualityReport` in the meta.json output so the admin page can display it.

- [ ] **Step 5: Commit**

```bash
git add scraper/src/quality-check.ts scraper/tests/quality-check.test.ts scraper/src/index.ts
git commit -m "feat: add data quality checks with thresholds and run-health summary"
```

---

## Task 15: Optimize admin/analytics data loading (reduce client bundle)

**Files:**
- Modify: `web/src/app/admin/page.tsx` -- switch from static imports to dynamic fetch
- Modify: `web/src/app/analytics/page.tsx` -- switch from static imports to dynamic fetch

**Why:** Both `/admin` and `/analytics` statically import large JSON files (`all-profiles.json`, `church-registry.json`, `position-church-map.json`). These get bundled into the client JS (~1.2MB for admin). On a static Next.js export, we can instead fetch these at runtime from `/data/*.json`, keeping the JS bundle small and loading data on demand.

- [ ] **Step 1: Refactor admin page to use runtime fetch**

In `web/src/app/admin/page.tsx`, replace static imports:

```typescript
// Remove these:
import profilesData from '../../../public/data/all-profiles.json';
import registryData from '../../../public/data/church-registry.json';
import mapData from '../../../public/data/position-church-map.json';
import metaData from '../../../public/data/meta.json';
```

Replace with a loading pattern using `useState` + `useEffect`:

```typescript
const [profilesData, setProfiles] = useState<Profile[]>([]);
const [registryData, setRegistry] = useState<RegistryData | null>(null);
const [mapData, setMapData] = useState<MapData | null>(null);
const [metaData, setMeta] = useState<MetaData | null>(null);
const [gapReportData, setGapReport] = useState<GapReport | null>(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  Promise.all([
    fetch('/data/all-profiles.json').then(r => r.json()),
    fetch('/data/church-registry.json').then(r => r.json()),
    fetch('/data/position-church-map.json').then(r => r.json()),
    fetch('/data/meta.json').then(r => r.json()),
    fetch('/data/needs-backfill.json').then(r => r.json()).catch(() => null),
  ]).then(([profiles, registry, map, meta, gaps]) => {
    setProfiles(profiles);
    setRegistry(registry);
    setMapData(map);
    setMeta(meta);
    setGapReport(gaps);
    setLoading(false);
  });
}, []);
```

Add a loading indicator while data is being fetched.

- [ ] **Step 2: Refactor analytics page similarly**

In `web/src/app/analytics/page.tsx`, replace:

```typescript
import profilesData from '../../../public/data/all-profiles.json';
```

With runtime fetch:

```typescript
const [profiles, setProfiles] = useState<Profile[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  fetch('/data/all-profiles.json')
    .then(r => r.json())
    .then(data => { setProfiles(data); setLoading(false); });
}, []);
```

Add loading state UI.

- [ ] **Step 3: Build and verify bundle sizes decreased**

Run: `npm run build --workspace=web`
Compare the route sizes in build output -- admin and analytics JS bundles should be significantly smaller.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/admin/page.tsx web/src/app/analytics/page.tsx
git commit -m "perf: switch admin/analytics to runtime data fetch, reduce JS bundle ~1MB"
```

---

## Summary: Audit Finding Cross-Reference

| Audit Finding | Task(s) |
|---|---|
| Docs out of sync with implementation | 8, 9, 10 |
| CI/CD duplication (dual deploy) | 2 |
| Enrichment runs in scraper + workflow | 3 |
| No lint quality gate in CI | 1, 2 |
| Diocese-to-state mapping duplicated | 6 |
| Normalization functions duplicated (7 copies) | 7 |
| MAX_RUNTIME_MS config mismatch | 4 |
| Unknown status defaults to "Closed" (hides data) | 5 |
| Dead showNew() function | 5 |
| Admin client-side "password" is not security | 11 |
| React fragment key warning | 12 |
| Minimal test coverage | 13 |
| Silent failure / no data quality checks | 14 |
| Large admin/analytics client bundle | 15 |
