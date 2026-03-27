import { launchBrowser, takeScreenshot, closeBrowser } from './browser.js';
import { navigateToSearch } from './navigate.js';
import { searchAllPositions } from './select-states.js';
import { clickSearchAndExtract } from './scrape-results.js';
import { applyDiff } from './diff.js';
import { logScrape, closeDb, getDb } from './db.js';
import { exportJson } from './export-json.js';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { scrapePositionDetails } from './position-details.js';
import fs from 'fs';
import path from 'path';

async function main(): Promise<void> {
  const startTime = Date.now();

  logger.info('Vocation Hub+ scraper starting', {
    dryRun: CONFIG.dryRun,
    url: CONFIG.url,
    maxRuntime: CONFIG.maxRuntime,
  });

  const timeout = setTimeout(() => {
    logger.error('Maximum runtime exceeded, aborting');
    process.exit(1);
  }, CONFIG.maxRuntime);

  const { browser, context, page } = await launchBrowser();

  try {
    // Phase 1: Search table scrape (fast, ~30s)
    await navigateToSearch(page);
    await searchAllPositions(page);
    const positions = await clickSearchAndExtract(page);
    logger.info('Search scrape complete', { positionsFound: positions.length });

    if (positions.length === 0) {
      throw new Error('Scrape returned 0 positions.');
    }

    if (!CONFIG.dryRun) {
      const diff = applyDiff(positions);
      logger.info('Search results saved', {
        new: diff.newCount,
        updated: diff.updatedCount,
        expired: diff.expiredCount,
      });

      // Phase 2: Scrape detail data for positions missing it.
      // Uses discovered-ids.json to map position names to VH profile IDs.
      // Only scrapes positions that don't already have detail data.
      try {
        const elapsed = Date.now() - startTime;
        const timeLeft = CONFIG.maxRuntime - elapsed - 120_000;

        if (timeLeft > 60_000) {
          const idsToScrape = findPositionsMissingDetails();

          if (idsToScrape.length > 0) {
            logger.info('Scraping details for positions missing data', {
              count: idsToScrape.length,
              timeLeftMs: timeLeft,
            });

            const baseUrl = CONFIG.url.replace('/PositionSearch', '');
            await scrapePositionDetails(context, idsToScrape, baseUrl, timeLeft);
          } else {
            logger.info('All active positions have detail data');
          }
        } else {
          logger.warn('Not enough time for detail scraping', { elapsed, timeLeft });
        }
      } catch (detailErr) {
        logger.warn('Detail scraping failed (non-fatal)', {
          error: detailErr instanceof Error ? detailErr.message : String(detailErr),
        });
      }

      const durationMs = Date.now() - startTime;
      logScrape(positions.length, diff.newCount, diff.expiredCount, durationMs, 'success');
      exportJson();

      logger.info('Scrape completed successfully', {
        duration: `${(durationMs / 1000).toFixed(1)}s`,
        found: positions.length,
        new: diff.newCount,
        updated: diff.updatedCount,
        expired: diff.expiredCount,
      });
    } else {
      logger.info('Dry run mode: skipping database writes');
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error('Scrape failed', { error: errorMessage });
    await takeScreenshot(page, 'error');

    if (!CONFIG.dryRun) {
      logScrape(0, 0, 0, durationMs, 'failed', errorMessage);
    }

    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await closeBrowser(browser);
    if (!CONFIG.dryRun) {
      closeDb();
    }
  }
}

/**
 * Find active positions that don't have detail data yet.
 * Cross-references with discovered-ids.json to get VH profile IDs.
 * Returns an array of VH IDs to scrape.
 */
function findPositionsMissingDetails(): number[] {
  const d = getDb();

  // Get active positions that don't have detail data
  const missingDetails = d.prepare(`
    SELECT p.id, p.name, p.diocese
    FROM positions p
    LEFT JOIN position_details d ON p.id = d.position_id
    WHERE p.status IN ('active', 'new')
    AND d.position_id IS NULL
  `).all() as Array<{ id: string; name: string; diocese: string }>;

  if (missingDetails.length === 0) return [];

  logger.info('Positions missing detail data', { count: missingDetails.length });

  // Load discovered IDs
  const idsFilePaths = [
    path.resolve(__dirname, '../../data/discovered-ids.json'),
    path.resolve(__dirname, '../../../data/discovered-ids.json'),
  ];

  let allKnownIds: number[] = [];
  for (const p of idsFilePaths) {
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      allKnownIds = data.validIds || [];
      logger.info('Loaded discovered IDs', { path: p, count: allKnownIds.length });
      break;
    }
  }

  if (allKnownIds.length === 0) {
    logger.warn('No discovered-ids.json found, cannot map positions to VH IDs');
    return [];
  }

  // For now, return the top N IDs from the known list that we haven't scraped yet.
  // In the future, we'll have a proper mapping from position name to VH ID.
  // For now, try all known IDs that don't have details in the DB.
  const existingVhIds = d.prepare(
    'SELECT vh_id FROM position_details WHERE vh_id IS NOT NULL'
  ).all() as Array<{ vh_id: number }>;

  const scrapedIds = new Set(existingVhIds.map((r) => r.vh_id));
  const unscrapedIds = allKnownIds.filter((id) => !scrapedIds.has(id));

  // Limit to a reasonable number per run (prioritize recent/high IDs)
  const maxPerRun = 50;
  const idsToScrape = unscrapedIds.slice(-maxPerRun);

  logger.info('IDs selected for detail scraping', {
    totalUnscraped: unscrapedIds.length,
    selectedForThisRun: idsToScrape.length,
  });

  return idsToScrape;
}

main();
