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
  // The definitive check: look at the visible text on the page.
  // On valid profiles, the "Diocese" label is followed by an actual
  // diocese name (e.g. "Virginia"). On empty profiles, "Diocese" is
  // followed by another label (e.g. "Name") or blank space.
  var text = (document.body ? document.body.innerText : '') || '';
  var lines = text.split('\\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

  // Find "Diocese" label and check the line after it
  var dioceseValue = '';
  for (var i = 0; i < lines.length - 1; i++) {
    if (lines[i] === 'Diocese') {
      dioceseValue = lines[i + 1] || '';
      break;
    }
  }

  // If the line after "Diocese" is another label, a section header,
  // or empty, this is not a real profile. Real diocese values are
  // names like "Virginia", "Connecticut", "Atlanta", etc.
  var labels = ['Name', 'Congregation', 'Type', 'Multi-Point', 'Contact',
                'Organization', 'Position', 'Stipend', 'Ministry', 'Basic',
                'Optional', 'Application', 'Current status', 'Receiving'];
  var isLabel = false;
  for (var j = 0; j < labels.length; j++) {
    if (dioceseValue === labels[j] || dioceseValue.indexOf(labels[j]) === 0) {
      isLabel = true;
      break;
    }
  }

  var isReal = dioceseValue.length > 0 && !isLabel;
  return { hasProfile: isReal, diocese: dioceseValue };
})()`;

interface CheckResult {
  hasProfile: boolean;
  diocese: string;
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

      if (result.status === 'fulfilled' && result.value.found) {
        validIds.push(id);
        console.log(`[FOUND] ID ${id} - ${result.value.diocese} (${validIds.length} found so far)`);
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

async function checkId(page: any, id: number): Promise<{ found: boolean; diocese: string }> {
  try {
    const url = `${BASE_URL}/PositionView/${id}`;
    await page.goto(url, { waitUntil: 'load', timeout: 10_000 });
    await page.waitForTimeout(1000);

    const result = await page.evaluate(CHECK_SCRIPT) as CheckResult;
    return { found: result.hasProfile, diocese: result.diocese || '' };
  } catch {
    return { found: false, diocese: '' };
  }
}

main().catch((err) => {
  console.error('Scan failed:', err);
  process.exit(1);
});
