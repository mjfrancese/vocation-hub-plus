/**
 * Scrape the Episcopal Asset Map (episcopalassetmap.org) to build a church directory.
 *
 * Phase 1: Collect NIDs from list pages using Playwright (830 pages, ~8,299 churches)
 * Phase 2: Fetch full church data from /node/{nid}?_format=json via HTTP (no browser needed)
 * Phase 3: Export churches.json for frontend consumption
 * Phase 4: Scrape parochial report data from General Convention Power BI dashboard
 *
 * Usage:
 *   tsx src/scrape-church-directory.ts              # Full run (all phases)
 *   tsx src/scrape-church-directory.ts --pages-only  # Only collect NIDs
 *   tsx src/scrape-church-directory.ts --json-only   # Only fetch JSON (requires existing NIDs file)
 *   tsx src/scrape-church-directory.ts --resume       # Resume from last checkpoint
 *   tsx src/scrape-church-directory.ts --no-parochial # Skip parochial report scraping
 *   tsx src/scrape-church-directory.ts test           # Test mode: 3 pages, 10 JSON fetches, 3 dioceses
 */

import fs from 'fs';
import path from 'path';
import { launchBrowser, closeBrowser } from './browser.js';
import { logger } from './logger.js';
import type { Church, ChurchDirectory } from './church-types.js';
import { scrapeParochialReports } from './scrape-parochial-reports.js';
import type { Page } from 'playwright';

const LIST_BASE_URL = 'https://www.episcopalassetmap.org/list?page=';
const JSON_BASE_URL = 'https://www.episcopalassetmap.org/node/';

const DATA_DIR = path.resolve(__dirname, '../../data');
const NIDS_FILE = path.join(DATA_DIR, 'church-nids.json');
const WEB_DATA_DIR = path.resolve(__dirname, '../../web/public/data');
const OUTPUT_FILE = path.join(WEB_DATA_DIR, 'churches.json');

const CONCURRENT_FETCHES = 15;
const FETCH_DELAY_MS = 50;
const NID_CHECKPOINT_INTERVAL = 50; // Save NIDs every 50 pages
const JSON_CHECKPOINT_INTERVAL = 500; // Save churches every 500 fetches

// Plain JS string for page.evaluate() (no arrow functions, no tsx __name injection)
const EXTRACT_NIDS = `(function() {
  var rows = document.querySelectorAll('.views-row');
  var results = [];
  for (var i = 0; i < rows.length; i++) {
    var info = rows[i].querySelector('.search-info--place');
    var nid = '';
    if (info) {
      var classes = info.className || '';
      var m = classes.match(/nid--(\\d+)/);
      if (m) nid = m[1];
    }
    if (!nid) {
      var nameEl = rows[i].querySelector('.views-field-title-unmodified .field-content');
      if (nameEl) {
        var m2 = (nameEl.className || '').match(/nid--(\\d+)/);
        if (m2) nid = m2[1];
      }
    }
    var name = '';
    var nameField = rows[i].querySelector('.views-field-title-unmodified .field-content');
    if (nameField) name = nameField.textContent.trim();
    var street = '', city = '', state = '';
    var s = rows[i].querySelector('.views-field-address-line1-unmodified .field-content');
    if (s) street = s.textContent.trim().replace(/,\\s*$/, '');
    var c = rows[i].querySelector('.views-field-locality-unmodified .field-content');
    if (c) city = c.textContent.trim().replace(/,\\s*$/, '');
    var st = rows[i].querySelector('.views-field-administrative-area-unmodified .field-content');
    if (st) state = st.textContent.trim().replace(/,\\s*$/, '');
    if (nid) {
      results.push({ nid: parseInt(nid, 10), name: name, street: street, city: city, state: state });
    }
  }
  return results;
})()`;

interface ListEntry {
  nid: number;
  name: string;
  street: string;
  city: string;
  state: string;
}

// --- Concurrency limiter ---

function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      const run = queue.shift()!;
      run();
    }
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
  };
}

// --- CLI args ---

const args = process.argv.slice(2);
const testMode = args.includes('test');
const pagesOnly = args.includes('--pages-only');
const jsonOnly = args.includes('--json-only');
const resume = args.includes('--resume');
const noParochial = args.includes('--no-parochial');

// --- Phase 1: NID Collection ---

async function collectNids(maxPages?: number): Promise<ListEntry[]> {
  const allEntries: ListEntry[] = [];
  const seenNids = new Set<number>();

  // Resume from checkpoint if available
  if (resume && fs.existsSync(NIDS_FILE)) {
    const existing = JSON.parse(fs.readFileSync(NIDS_FILE, 'utf-8')) as ListEntry[];
    for (const entry of existing) {
      if (!seenNids.has(entry.nid)) {
        seenNids.add(entry.nid);
        allEntries.push(entry);
      }
    }
    logger.info('Resumed NID collection', { existingCount: allEntries.length });
  }

  const { browser, page } = await launchBrowser();

  try {
    // Determine total pages from page 0
    await page.goto(`${LIST_BASE_URL}0`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const totalPages = await detectTotalPages(page, maxPages);
    logger.info('Starting NID collection', { totalPages });

    // Determine starting page for resume
    const startPage = resume ? Math.floor(allEntries.length / 10) : 0;

    for (let pageNum = startPage; pageNum < totalPages; pageNum++) {
      try {
        if (pageNum > 0) {
          await page.goto(`${LIST_BASE_URL}${pageNum}`, { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(1500);
        }

        const entries = await page.evaluate(EXTRACT_NIDS) as ListEntry[];

        for (const entry of entries) {
          if (!seenNids.has(entry.nid)) {
            seenNids.add(entry.nid);
            allEntries.push(entry);
          }
        }

        if (pageNum % 10 === 0) {
          logger.info('NID collection progress', {
            page: pageNum,
            totalPages,
            nidsFound: allEntries.length,
          });
        }

        // Checkpoint save
        if ((pageNum + 1) % NID_CHECKPOINT_INTERVAL === 0) {
          saveNidsCheckpoint(allEntries);
        }
      } catch (err) {
        logger.warn('Failed to scrape list page', {
          page: pageNum,
          error: String(err),
        });
        // Continue to next page
      }
    }

    // Final save
    saveNidsCheckpoint(allEntries);
    logger.info('NID collection complete', { totalNids: allEntries.length });
  } finally {
    await closeBrowser(browser);
  }

  return allEntries;
}

async function detectTotalPages(page: Page, maxPages?: number): Promise<number> {
  // Try to find the pager to determine total pages
  const lastPageLink = await page.evaluate(`(function() {
    var pager = document.querySelector('.pager__item--last a');
    if (pager) {
      var href = pager.getAttribute('href') || '';
      var m = href.match(/page=(\\d+)/);
      if (m) return parseInt(m[1], 10) + 1;
    }
    return 0;
  })()`);

  if (lastPageLink && typeof lastPageLink === 'number' && lastPageLink > 0) {
    const total = maxPages ? Math.min(lastPageLink, maxPages) : lastPageLink;
    logger.info('Detected total pages from pager', { totalPages: total });
    return total;
  }

  // Fallback: estimate from known count (~8,299 places, 10 per page)
  const fallback = maxPages || 830;
  logger.info('Using fallback page count', { totalPages: fallback });
  return fallback;
}

function saveNidsCheckpoint(entries: ListEntry[]): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(NIDS_FILE, JSON.stringify(entries, null, 2));
  logger.info('Saved NID checkpoint', { count: entries.length });
}

// --- Phase 2: JSON Fetch ---

function parseChurchJson(data: Record<string, unknown>, nid: number): Church | null {
  try {
    const d = data as Record<string, Array<Record<string, unknown>>>;

    const name = (d.title?.[0] as Record<string, string>)?.value || '';
    if (!name) return null;

    const addr = d.field_place_address?.[0] as Record<string, string> | undefined;
    const coords = d.field_place_coordinates?.[0] as Record<string, number> | undefined;
    const pathAlias = (d.path?.[0] as Record<string, string>)?.alias || '';

    return {
      nid,
      name,
      diocese: extractDioceseFromPath(pathAlias),
      street: addr?.address_line1 || '',
      city: addr?.locality || '',
      state: addr?.administrative_area || '',
      zip: addr?.postal_code || '',
      phone: (d.field_phone?.[0] as Record<string, string>)?.value || '',
      email: (d.field_email_address?.[0] as Record<string, string>)?.value || '',
      website: (d.field_external_url?.[0] as Record<string, string>)?.uri || '',
      type: (d.field_place_type?.[0] as Record<string, string>)?.value || '',
      lat: coords?.lat ?? null,
      lng: coords?.lon ?? null, // Drupal uses "lon" not "lng"
    };
  } catch (err) {
    logger.warn('Failed to parse church JSON', { nid, error: String(err) });
    return null;
  }
}

function extractDioceseFromPath(pathAlias: string): string {
  // Path aliases look like: /dioceses/diocese-virginia/list/abingdon-church
  // or /dioceses/episcopal-diocese-texas/list/some-church
  // or /dioceses/convocation-of-episcopal-churches-in-europe/list/american-cathedral
  if (!pathAlias) return '';

  const parts = pathAlias.split('/').filter(Boolean);
  // Find the diocese slug (typically after "dioceses")
  let dioceseSlug = '';
  const diocesesIdx = parts.indexOf('dioceses');
  if (diocesesIdx >= 0 && parts.length > diocesesIdx + 1) {
    dioceseSlug = parts[diocesesIdx + 1];
  } else if (parts.length > 0) {
    dioceseSlug = parts[0];
  }

  if (!dioceseSlug) return '';

  // Skip bogus slugs (numeric IDs, "list", etc.)
  if (/^\d+$/.test(dioceseSlug) || dioceseSlug === 'list') return '';

  // Convert slug to readable name: "diocese-virginia" -> "Virginia"
  // Strip all known prefixes to get the canonical name
  return dioceseSlug
    .replace(/^episcopal-church-/i, '')
    .replace(/^episcopal-diocese-of-/i, '')
    .replace(/^episcopal-diocese-/i, '')
    .replace(/^diocese-of-/i, '')
    .replace(/^diocese-/i, '')
    .replace(/^convocation-of-/i, 'Convocation of ')
    .replace(/^missionary-diocese-of-/i, '')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}


async function fetchChurchDetails(
  nids: ListEntry[],
  maxFetches?: number,
): Promise<Church[]> {
  const churches: Church[] = [];
  const limit = pLimit(CONCURRENT_FETCHES);

  // Load existing churches for resume
  const fetchedNids = new Set<number>();
  if (resume && fs.existsSync(OUTPUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8')) as ChurchDirectory;
      for (const church of existing.churches) {
        fetchedNids.add(church.nid);
        churches.push(church);
      }
      logger.info('Resumed from existing churches', { count: churches.length });
    } catch {
      // Start fresh if file is corrupted
    }
  }

  const toFetch = nids.filter(e => !fetchedNids.has(e.nid));
  const total = maxFetches ? Math.min(toFetch.length, maxFetches) : toFetch.length;

  logger.info('Starting JSON fetch', { total, alreadyFetched: churches.length });

  let completed = 0;
  let errors = 0;

  const batch = toFetch.slice(0, total);
  const promises = batch.map((entry) =>
    limit(async () => {
      const church = await fetchSingleChurch(entry.nid);
      completed++;

      if (church) {
        churches.push(church);
      } else {
        errors++;
      }

      if (completed % 100 === 0) {
        logger.info('JSON fetch progress', {
          completed,
          total,
          churches: churches.length,
          errors,
        });
      }

      // Checkpoint save
      if (completed % JSON_CHECKPOINT_INTERVAL === 0) {
        saveChurchesCheckpoint(churches);
      }

      // Small delay between launches for rate limiting courtesy
      await sleep(FETCH_DELAY_MS);
    })
  );

  await Promise.all(promises);

  logger.info('JSON fetch complete', {
    total: completed,
    churches: churches.length,
    errors,
  });

  return churches;
}

async function fetchSingleChurch(nid: number, retries = 3): Promise<Church | null> {
  const url = `${JSON_BASE_URL}${nid}?_format=json`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; VocationHubPlus/1.0)',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (resp.status === 404) {
        // Not found, skip silently
        return null;
      }

      if (resp.status === 429) {
        // Rate limited, back off
        const backoff = attempt * 2000;
        logger.warn('Rate limited, backing off', { nid, backoffMs: backoff });
        await sleep(backoff);
        continue;
      }

      if (!resp.ok) {
        logger.warn('HTTP error fetching church', { nid, status: resp.status });
        if (attempt < retries) {
          await sleep(attempt * 1000);
          continue;
        }
        return null;
      }

      const data = await resp.json();
      return parseChurchJson(data as Record<string, unknown>, nid);
    } catch (err) {
      if (attempt < retries) {
        await sleep(attempt * 1000);
        continue;
      }
      logger.warn('Failed to fetch church', { nid, error: String(err) });
      return null;
    }
  }

  return null;
}

function saveChurchesCheckpoint(churches: Church[]): void {
  const directory: ChurchDirectory = {
    meta: {
      lastUpdated: new Date().toISOString(),
      totalChurches: churches.length,
    },
    churches,
  };

  if (!fs.existsSync(WEB_DATA_DIR)) {
    fs.mkdirSync(WEB_DATA_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(directory, null, 2));
  logger.info('Saved churches checkpoint', { count: churches.length });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Main ---

async function main() {
  const startTime = Date.now();
  logger.info('Church directory scraper starting', {
    testMode,
    pagesOnly,
    jsonOnly,
    resume,
    noParochial,
  });

  let nids: ListEntry[];

  if (jsonOnly) {
    // Load NIDs from file
    if (!fs.existsSync(NIDS_FILE)) {
      logger.error('No NIDs file found. Run without --json-only first.');
      process.exit(1);
    }
    nids = JSON.parse(fs.readFileSync(NIDS_FILE, 'utf-8')) as ListEntry[];
    logger.info('Loaded NIDs from file', { count: nids.length });
  } else {
    // Phase 1: Collect NIDs
    const maxPages = testMode ? 3 : undefined;
    nids = await collectNids(maxPages);
  }

  if (pagesOnly) {
    logger.info('Pages-only mode, skipping JSON fetch', { nidsCollected: nids.length });
    const durationMs = Date.now() - startTime;
    logger.info('Done', { durationMs });
    return;
  }

  // Phase 2: Fetch JSON details
  const maxFetches = testMode ? 10 : undefined;
  const churches = await fetchChurchDetails(nids, maxFetches);

  // Phase 3: Export
  saveChurchesCheckpoint(churches);

  // Stats
  const withEmail = churches.filter(c => c.email).length;
  const withPhone = churches.filter(c => c.phone).length;
  const withWebsite = churches.filter(c => c.website).length;
  const withCoords = churches.filter(c => c.lat !== null).length;
  const withDiocese = churches.filter(c => c.diocese).length;

  logger.info('Church directory scrape complete', {
    totalChurches: churches.length,
    withEmail,
    withPhone,
    withWebsite,
    withCoords,
    withDiocese,
  });

  // Phase 4: Parochial report data
  if (!noParochial) {
    await scrapeParochialReports(testMode);
  }

  const durationMs = Date.now() - startTime;
  logger.info('All phases complete', { durationMs });
}

main().catch(err => {
  logger.error('Church directory scraper failed', { error: String(err) });
  process.exit(1);
});
