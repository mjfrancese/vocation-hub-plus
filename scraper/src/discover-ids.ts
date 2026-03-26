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
  var text = document.body ? document.body.innerText : '';
  var hasProfile = text.indexOf('Position Profile') >= 0 ||
                   text.indexOf('Basic Information') >= 0;
  var title = document.title || '';
  return { hasProfile: hasProfile, title: title, len: text.length };
})()`;

interface CheckResult {
  hasProfile: boolean;
  title: string;
  len: number;
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

      if (result.status === 'fulfilled' && result.value) {
        validIds.push(id);
        console.log(`[FOUND] ID ${id} - valid profile (${validIds.length} found so far)`);
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

async function checkId(page: any, id: number): Promise<boolean> {
  try {
    const url = `${BASE_URL}/PositionView/${id}`;

    // Navigate with a short timeout - we just need the page to load enough
    // to check if it's a valid profile
    await page.goto(url, { waitUntil: 'load', timeout: 10_000 });

    // Brief wait for Blazor to render something
    await page.waitForTimeout(1000);

    // Quick check
    const result = await page.evaluate(CHECK_SCRIPT) as CheckResult;
    return result.hasProfile;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error('Scan failed:', err);
  process.exit(1);
});
