import { launchBrowser, takeScreenshot, closeBrowser } from './browser.js';
import { navigateToSearch } from './navigate.js';
import { selectAllStates } from './select-states.js';
import { clickSearchAndExtract } from './scrape-results.js';
import { applyDiff } from './diff.js';
import { logScrape, closeDb } from './db.js';
import { exportJson } from './export-json.js';
import { CONFIG } from './config.js';
import { logger } from './logger.js';

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
    // Navigate to the search page
    await navigateToSearch(page);

    // Select all states
    const stateCount = await selectAllStates(page);
    logger.info('State selection complete', { statesSelected: stateCount });

    // If no states were selected, something is wrong with the dropdown.
    // Do not proceed with an empty search (it returns 0 results).
    if (stateCount === 0) {
      throw new Error(
        'Failed to select any states. The dropdown interaction is not working. ' +
        'Check screenshots for page state.'
      );
    }

    // Search and extract results
    const positions = await clickSearchAndExtract(page);
    logger.info('Scraping complete', { positionsFound: positions.length });

    if (CONFIG.dryRun) {
      logger.info('Dry run mode: skipping database writes');
      logger.info('Sample positions', {
        first: positions.slice(0, 3).map((p) => ({
          name: p.name,
          diocese: p.diocese,
          state: p.state,
          positionType: p.positionType,
        })),
      });
    } else {
      // Apply diff to database
      const diff = applyDiff(positions);

      const durationMs = Date.now() - startTime;
      logScrape(positions.length, diff.newCount, diff.expiredCount, durationMs, 'success');

      // Export to JSON
      exportJson();

      logger.info('Scrape completed successfully', {
        duration: `${(durationMs / 1000).toFixed(1)}s`,
        found: positions.length,
        new: diff.newCount,
        updated: diff.updatedCount,
        expired: diff.expiredCount,
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
