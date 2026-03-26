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
import { discoverPositionIds, scrapePositionDetails } from './position-details.js';

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
    // Phase 1: Search table scrape
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

      // Phase 2: Discover position IDs by clicking rows, then scrape profiles.
      // Non-fatal: if this fails, we still have the search results.
      try {
        const elapsed = Date.now() - startTime;
        const timeLeft = CONFIG.maxRuntime - elapsed - 120_000;

        if (timeLeft > 60_000) {
          logger.info('Starting Phase 2: ID discovery + profile scraping', { timeLeftMs: timeLeft });

          // Re-navigate and search to get a fresh results page for clicking
          await navigateToSearch(page);
          await searchAllPositions(page);
          await sleep(3000);

          // Wait for results
          const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
          logger.info('Search results for ID discovery', { pagerText });

          if (pagerText && !pagerText.includes('0 - 0 of 0')) {
            // Discover IDs by clicking each row
            const positionIds = await discoverPositionIds(page, positions.length);
            logger.info('Discovered position IDs', { count: positionIds.length, ids: positionIds });

            if (positionIds.length > 0) {
              // Scrape each profile in a SEPARATE browser page
              const baseUrl = CONFIG.url.replace('/PositionSearch', '');
              const elapsed2 = Date.now() - startTime;
              const timeLeft2 = CONFIG.maxRuntime - elapsed2 - 120_000;
              await scrapePositionDetails(context, positionIds, baseUrl, timeLeft2);
            }
          }
        } else {
          logger.warn('Not enough time for Phase 2', { elapsed, timeLeft });
        }
      } catch (detailErr) {
        logger.warn('Phase 2 failed (non-fatal)', {
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

main();
