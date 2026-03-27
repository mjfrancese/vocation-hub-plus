/**
 * Deep scrape: extract full profile data from all discovered position IDs.
 * Reads IDs from data/discovered-ids.json and scrapes each profile page.
 * Processes in chunks to stay within workflow time limits.
 *
 * Usage: tsx src/deep-scrape.ts [chunkIndex] [chunkSize]
 * Example: tsx src/deep-scrape.ts 0 200  (scrapes IDs 0-199 from the list)
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const chunkIndex = parseInt(process.argv[2] || '0', 10);
const chunkSize = parseInt(process.argv[3] || '200', 10);

const BASE_URL = 'https://vocationhub.episcopalchurch.org';

// Plain JS extraction script (avoids tsx __name issues)
const EXTRACT_SCRIPT = `(function() {
  var result = {};
  var body = document.body || document.documentElement;
  var text = body.innerText || '';
  result.fullText = text;
  result.textLength = text.length;

  // Extract all input values with their preceding labels
  var inputs = document.querySelectorAll('.k-input-inner, .k-input, input, textarea');
  var fields = [];
  for (var i = 0; i < inputs.length; i++) {
    var val = (inputs[i].value || '').trim();
    if (val && val !== 'on' && val !== 'English') {
      // Try to find the label for this input
      var label = '';
      var prev = inputs[i].previousElementSibling;
      if (prev && prev.tagName === 'LABEL') label = prev.textContent.trim();
      var parent = inputs[i].parentElement;
      if (!label && parent) {
        var parentLabel = parent.querySelector('label');
        if (parentLabel) label = parentLabel.textContent.trim();
        if (!label) {
          var prevSib = parent.previousElementSibling;
          if (prevSib) label = prevSib.textContent.trim();
        }
      }
      fields.push({ label: label, value: val.substring(0, 5000) });
    }
  }

  // Extract Kendo DatePicker values (receiving names dates)
  var datePickers = document.querySelectorAll('.k-datepicker input, .k-dateinput input');
  for (var d = 0; d < datePickers.length; d++) {
    var dpVal = (datePickers[d].value || '').trim();
    // Skip empty and placeholder values
    if (!dpVal || /^month/i.test(dpVal) || /^mm/i.test(dpVal) || dpVal === 'month/day/year') continue;
    var dpLabel = '';
    // Walk up to find the label context
    var dpParent = datePickers[d].closest('.k-datepicker') || datePickers[d].closest('.k-dateinput');
    if (dpParent) {
      var dpPrev = dpParent.previousElementSibling;
      if (dpPrev) dpLabel = dpPrev.textContent.trim();
      if (!dpLabel) {
        var dpWrapper = dpParent.parentElement;
        if (dpWrapper) {
          var dpWrapperLabel = dpWrapper.querySelector('label');
          if (dpWrapperLabel) dpLabel = dpWrapperLabel.textContent.trim();
          if (!dpLabel) {
            var dpWrapperPrev = dpWrapper.previousElementSibling;
            if (dpWrapperPrev) dpLabel = dpWrapperPrev.textContent.trim();
          }
        }
      }
    }
    // Tag date fields so merge-profiles can identify them
    if (!dpLabel) dpLabel = 'DatePicker ' + (d + 1);
    fields.push({ label: dpLabel, value: dpVal });
  }

  // Extract checkbox state for "Open ended" (receiving names to)
  var checkboxes = document.querySelectorAll('input[type="checkbox"]');
  for (var c = 0; c < checkboxes.length; c++) {
    if (checkboxes[c].checked) {
      var cbLabel = '';
      var cbParent = checkboxes[c].parentElement;
      if (cbParent) cbLabel = cbParent.textContent.trim();
      if (cbLabel && /open.?ended/i.test(cbLabel)) {
        fields.push({ label: 'Open Ended', value: 'Yes' });
      }
    }
  }

  result.fields = fields;

  // Get tab count
  var tabs = document.querySelectorAll('[role="tab"], .k-tabstrip-item, .k-item');
  result.tabCount = tabs.length;

  return result;
})()`;

interface ExtractResult {
  fullText: string;
  textLength: number;
  fields: Array<{ label: string; value: string }>;
  tabCount: number;
}

interface ProfileData {
  id: number;
  url: string;
  tabCount: number;
  fields: Array<{ label: string; value: string }>;
  fullText: string;
  scrapedAt: string;
}

async function main() {
  // Load discovered IDs
  const idsFile = path.resolve(__dirname, '../../data/discovered-ids.json');
  if (!fs.existsSync(idsFile)) {
    console.error('No discovered-ids.json found. Run the discovery scan first.');
    process.exit(1);
  }

  const discovered = JSON.parse(fs.readFileSync(idsFile, 'utf-8'));
  const allIds: number[] = discovered.validIds;
  console.log(`Total discovered IDs: ${allIds.length}`);

  // Calculate chunk
  const startIdx = chunkIndex * chunkSize;
  const endIdx = Math.min(startIdx + chunkSize, allIds.length);
  const chunkIds = allIds.slice(startIdx, endIdx);

  if (chunkIds.length === 0) {
    console.log(`Chunk ${chunkIndex} is empty (all IDs processed). Nothing to do.`);
    return;
  }

  console.log(`Processing chunk ${chunkIndex}: IDs ${startIdx}-${endIdx - 1} (${chunkIds.length} profiles)`);
  console.log(`ID range: ${chunkIds[0]} to ${chunkIds[chunkIds.length - 1]}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  const results: ProfileData[] = [];
  const startTime = Date.now();

  // Use 3 parallel pages for detail scraping (need more wait time per page)
  const pageCount = 3;
  const pages = await Promise.all(
    Array.from({ length: pageCount }, () => context.newPage())
  );

  for (let batchStart = 0; batchStart < chunkIds.length; batchStart += pageCount) {
    const batch = chunkIds.slice(batchStart, batchStart + pageCount);

    const batchResults = await Promise.allSettled(
      batch.map((id, idx) => scrapeProfile(pages[idx], id))
    );

    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i];
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      }
    }

    const processed = batchStart + batch.length;
    if (processed % 30 === 0 || processed === chunkIds.length) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      console.log(
        `[PROGRESS] ${processed}/${chunkIds.length} scraped ` +
        `(${results.length} successful, ${rate.toFixed(1)}/sec)`
      );
    }
  }

  await browser.close();

  // Save results
  const outputDir = path.resolve(__dirname, '../../data/profiles');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, `chunk-${chunkIndex}.json`);
  fs.writeFileSync(outputFile, JSON.stringify({
    chunkIndex,
    chunkSize,
    idRange: { start: chunkIds[0], end: chunkIds[chunkIds.length - 1] },
    totalScraped: results.length,
    scrapedAt: new Date().toISOString(),
    profiles: results,
  }, null, 2));

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n=== CHUNK ${chunkIndex} COMPLETE ===`);
  console.log(`Scraped: ${results.length}/${chunkIds.length} profiles in ${elapsed.toFixed(1)}s`);
  console.log(`Saved to ${outputFile}`);
}

async function scrapeProfile(page: any, id: number): Promise<ProfileData | null> {
  try {
    const url = `${BASE_URL}/PositionView/${id}`;
    await page.goto(url, { waitUntil: 'load', timeout: 15_000 });

    // Wait for tabs to render (our proven signal for valid pages)
    await page.waitForSelector('[role="tab"]', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(2000); // Extra wait for content to populate

    // Click through all tabs to load their content
    const tabNames = [
      'Basic Information',
      'Position Details',
      'Stipend, Housing, and Benefits',
      'Ministry Context and Desired Skills',
      'Ministry Media and Links',
      'Optional Narrative Reflections',
    ];

    for (const tabName of tabNames) {
      try {
        const tab = page.locator(`text="${tabName}"`).first();
        if (await tab.isVisible({ timeout: 500 }).catch(() => false)) {
          await tab.click();
          await page.waitForTimeout(500);
        }
      } catch { /* tab may not exist */ }
    }

    // Wait for content to load after tab clicks
    await page.waitForTimeout(1000);

    // Extract all data
    const data = await page.evaluate(EXTRACT_SCRIPT) as ExtractResult;

    if (data.tabCount < 6) {
      return null; // Not a valid profile
    }

    return {
      id,
      url,
      tabCount: data.tabCount,
      fields: data.fields,
      fullText: data.fullText,
      scrapedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error('Deep scrape failed:', err);
  process.exit(1);
});
