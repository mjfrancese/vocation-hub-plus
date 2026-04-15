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
import { openProfileAndExtract, type ProfileRecord } from './extractors/profile.js';

const chunkIndex = parseInt(process.argv[2] || '0', 10);
const chunkSize = parseInt(process.argv[3] || '200', 10);

type ProfileData = ProfileRecord;

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

  const results: ProfileData[] = [];
  const startTime = Date.now();

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    // Use 5 parallel pages for detail scraping
    const pageCount = 5;
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
  } finally {
    await browser.close();
  }

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
    const record = await openProfileAndExtract(page, id);
    if (!record) {
      console.warn(`Profile ${id} has fewer than 6 tabs, skipping`);
      return null;
    }
    return record;
  } catch (e) {
    console.error(`Failed to scrape profile ${id}: ${(e as Error).message}`);
    return null;
  }
}

main().catch((err) => {
  console.error('Deep scrape failed:', err);
  process.exit(1);
});
