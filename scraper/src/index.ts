import { launchBrowser, takeScreenshot, closeBrowser } from './browser.js';
import { navigateToSearch } from './navigate.js';
import { searchAllPositions } from './select-states.js';
import { clickSearchAndExtract } from './scrape-results.js';
import { applyDiff } from './diff.js';
import { logScrape, closeDb } from './db.js';
import { exportJson } from './export-json.js';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { sleep } from './navigate.js';
import { scanAndScrapeProfiles } from './position-details.js';

async function main(): Promise<void> {
  const startTime = Date.now();

  logger.info('Vocation Hub+ scraper starting', {
    dryRun: CONFIG.dryRun,
    url: CONFIG.url,
    maxRuntime: CONFIG.maxRuntime,
  });

  // Set overall timeout
  const timeout = setTimeout(() => {
    logger.error('Maximum runtime exceeded, aborting');
    process.exit(1);
  }, CONFIG.maxRuntime);

  const { browser, page } = await launchBrowser();

  try {
    // Phase 1: Search table scrape (discover active positions)
    await navigateToSearch(page);
    await searchAllPositions(page);
    const positions = await clickSearchAndExtract(page);
    logger.info('Search scrape complete', { positionsFound: positions.length });

    if (positions.length === 0) {
      throw new Error(
        'Scrape returned 0 positions. The search may not have returned results, ' +
        'or the table extraction failed. Check screenshots for page state.'
      );
    }

    if (!CONFIG.dryRun) {
      // Save search results to DB
      const diff = applyDiff(positions);
      logger.info('Search results saved', {
        new: diff.newCount,
        updated: diff.updatedCount,
        expired: diff.expiredCount,
      });

      // Phase 2: Detail scrape (visit each position's profile page)
      // Scan a range of /PositionView/{id} URLs directly.
      // Wrapped in try/catch so failures never block the main pipeline.
      try {
        const elapsed = Date.now() - startTime;
        const timeLeft = CONFIG.maxRuntime - elapsed - 120_000;

        if (timeLeft > 60_000) {
          logger.info('Starting profile scan', { timeLeftMs: timeLeft });
          const baseUrl = CONFIG.url.replace('/PositionSearch', '');

          // Start scanning from ID 10220 (known active range).
          // Stop after 50 consecutive misses to cover gaps between IDs.
          const result = await scanAndScrapeProfiles(page, baseUrl, 10220, timeLeft);

          logger.info('Profile scan results', {
            scraped: result.scraped,
            maxId: result.maxId,
            idsFound: result.ids.length,
          });
        } else {
          logger.warn('Not enough time for profile scan, skipping', { elapsed, timeLeft });
        }
      } catch (detailErr) {
        logger.warn('Profile scanning failed (non-fatal)', {
          error: detailErr instanceof Error ? detailErr.message : String(detailErr),
        });
      }

      const durationMs = Date.now() - startTime;
      logScrape(positions.length, diff.newCount, diff.expiredCount, durationMs, 'success');

      // Export to JSON (includes detail data if available)
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
      logger.info('Sample positions', {
        first: positions.slice(0, 3).map((p) => ({
          name: p.name,
          diocese: p.diocese,
          state: p.state,
          positionType: p.positionType,
        })),
      });
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

main();
