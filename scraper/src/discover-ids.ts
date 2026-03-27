/**
 * Fast ID discovery scan.
 * Visits /PositionView/{id} for a range of IDs using parallel browser pages.
 * Only checks if the page contains a valid profile (no data extraction).
 * Outputs a list of valid IDs.
 *
 * Usage: tsx src/discover-ids.ts [startId] [endId] [parallelism]
 * Example: tsx src/discover-ids.ts 0 11000 5
 */

import { chromium } from 'playwright';
import fs from 'fs';

const BASE_URL = 'https://vocationhub.episcopalchurch.org';
const startId = parseInt(process.argv[2] || '0', 10);
const endId = parseInt(process.argv[3] || '11000', 10);
const parallelism = parseInt(process.argv[4] || '10', 10);

const CHECK_SCRIPT = `(function() {
  // Tab count is the fastest and most reliable signal.
  // Valid profiles: 6 tabs (includes "Optional Narrative Reflections")
  // Invalid profiles: 5 tabs (missing that tab)
  // This is a structural DOM difference available immediately after load,
  // no need to wait for Blazor to populate content.
  var tabs = document.querySelectorAll('[role="tab"], .k-tabstrip-item, .k-item');
  return { hasProfile: tabs.length >= 6, filled: 0, tabs: tabs.length };
})()`;

interface CheckResult {
  hasProfile: boolean;
  filled: number;
  tabs: number;
}

async function main() {
  const totalIds = endId - startId + 1;
  console.log(`Scanning IDs ${startId} to ${endId} (${totalIds} IDs, ${parallelism} parallel)`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  const validIds: number[] = [];
  const invalidIds: number[] = [];
  let checked = 0;
  const startTime = Date.now();

  // Self-test: verify detection works before scanning
  console.log('Running self-test with known valid (10669) and known invalid (0) profiles...');
  const testPage = await context.newPage();

  const validResult = await checkId(testPage, 10669);
  const invalidResult = await checkId(testPage, 0);
  await testPage.close();

  console.log(`  Valid profile (10669):   detected=${validResult.found}, filled=${validResult.filled}, tabs=${validResult.tabs}`);
  console.log(`  Invalid profile (0):     detected=${invalidResult.found}, filled=${invalidResult.filled}, tabs=${invalidResult.tabs}`);

  if (!validResult.found) {
    console.error(`SELF-TEST FAILED: Known valid profile (10669) was not detected (filled=${validResult.filled}, tabs=${validResult.tabs}). Aborting scan.`);
    await browser.close();
    process.exit(1);
  }
  if (invalidResult.found) {
    console.error(`SELF-TEST FAILED: Known invalid profile (0) was incorrectly detected (filled=${invalidResult.filled}, tabs=${invalidResult.tabs}). Aborting scan.`);
    await browser.close();
    process.exit(1);
  }
  console.log('Self-test PASSED. Starting scan...\n');

  // Create worker pages
  const pages = await Promise.all(
    Array.from({ length: parallelism }, () => context.newPage())
  );

  // Process IDs in batches
  for (let batchStart = startId; batchStart <= endId; batchStart += parallelism) {
    const batch: number[] = [];
    for (let i = 0; i < parallelism && batchStart + i <= endId; i++) {
      batch.push(batchStart + i);
    }

    // Check all IDs in this batch in parallel
    const results = await Promise.allSettled(
      batch.map((id, idx) => checkId(pages[idx], id))
    );

    for (let i = 0; i < results.length; i++) {
      const id = batch[i];
      const result = results[i];
      checked++;

      if (result.status === 'fulfilled' && result.value.found) {
        validIds.push(id);
        console.log(`[FOUND] ID ${id} - ${result.value.filled} filled inputs, ${result.value.tabs} tabs (${validIds.length} found so far)`);
      }

      // Progress every 100 IDs
      if (checked % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = checked / elapsed;
        const remaining = (totalIds - checked) / rate;
        console.log(
          `[PROGRESS] ${checked}/${totalIds} checked ` +
          `(${validIds.length} found, ${rate.toFixed(1)}/sec, ~${Math.ceil(remaining / 60)}min remaining)`
        );
      }
    }
  }

  // Close browser
  await browser.close();

  // Output results
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n=== SCAN COMPLETE ===`);
  console.log(`Checked: ${checked} IDs in ${elapsed.toFixed(1)}s`);
  console.log(`Found: ${validIds.length} valid profiles`);
  console.log(`Rate: ${(checked / elapsed).toFixed(1)} IDs/sec`);
  console.log(`\nValid IDs: ${JSON.stringify(validIds)}`);

  // Save results to file
  const outputPath = process.env.OUTPUT_PATH || '../data';
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  const outputFile = `${outputPath}/discovered-ids.json`;
  fs.writeFileSync(outputFile, JSON.stringify({
    scannedAt: new Date().toISOString(),
    range: { start: startId, end: endId },
    validIds: validIds.sort((a, b) => a - b),
    totalChecked: checked,
    totalFound: validIds.length,
    durationSeconds: elapsed,
  }, null, 2));

  console.log(`Results saved to ${outputFile}`);
}

async function checkId(page: any, id: number): Promise<{ found: boolean; filled: number; tabs: number }> {
  try {
    const url = `${BASE_URL}/PositionView/${id}`;
    await page.goto(url, { waitUntil: 'load', timeout: 10_000 });
    await page.waitForTimeout(1000);

    const result = await page.evaluate(CHECK_SCRIPT) as CheckResult;
    return { found: result.hasProfile, filled: result.filled, tabs: result.tabs };
  } catch {
    return { found: false, filled: 0, tabs: 0 };
  }
}

main().catch((err) => {
  console.error('Scan failed:', err);
  process.exit(1);
});
