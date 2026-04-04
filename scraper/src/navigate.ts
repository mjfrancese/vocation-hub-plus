import { Page } from 'playwright';
import { CONFIG } from './config.js';
import { SELECTORS } from './selectors.js';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';

export async function navigateToSearch(page: Page): Promise<void> {
  logger.info('Navigating to Vocation Hub', { url: CONFIG.url });

  await page.goto(CONFIG.url, { waitUntil: 'load', timeout: 60_000 });

  // Wait for the Blazor app to render the search form
  await page.waitForSelector(SELECTORS.searchButton, { timeout: 30_000 });

  // Wait for Blazor to fully initialize by checking for default filter chips.
  // The page always loads with at least one Position Type chip pre-selected
  // (e.g. "Rector/Priest-in-Charge"). The chip appearing confirms Blazor's
  // SignalR connection is live and the form is interactive.
  logger.info('Waiting for Blazor initialization');
  try {
    await page.waitForSelector(SELECTORS.chip, { timeout: 20_000 });
    logger.info('Blazor ready (default chip detected)');
  } catch {
    // Chip never appeared -- Blazor may have changed defaults or is slow.
    // Fall back to a fixed delay so we still attempt the scrape.
    logger.warn('No default chip detected within 20s, falling back to fixed delay');
    await page.waitForTimeout(5000);
  }

  // Brief extra settle time for SignalR event handlers to attach
  await page.waitForTimeout(1000);

  // Log the current page state for debugging
  const title = await page.title();
  const url = page.url();
  logger.info('Page ready', { title, url });

  await takeScreenshot(page, 'page-loaded');
}

export async function waitForResults(page: Page): Promise<boolean> {
  logger.info('Waiting for search results to load');

  // Poll the pager info text for up to 60 seconds
  const startTime = Date.now();
  const timeout = 60_000;

  while (Date.now() - startTime < timeout) {
    // Check pager info text
    const pagerInfo = page.locator(SELECTORS.pagerInfo);
    const text = await pagerInfo.textContent().catch(() => '');

    if (text && !text.includes('0 - 0 of 0')) {
      logger.info('Results loaded', { pagerText: text });
      await page.waitForTimeout(2000); // let rows finish rendering
      return true;
    }

    // Check for "No records" message
    const noRecords = await page.locator('text=No records').count().catch(() => 0);
    if (noRecords > 0) {
      logger.info('No records found');
      return false;
    }

    // Check for any rows in the table
    const rowCount = await page
      .locator(`${SELECTORS.resultsGrid} ${SELECTORS.resultsRow}`)
      .count()
      .catch(() => 0);
    if (rowCount > 0) {
      logger.info('Found table rows even though pager text not updated', { rowCount });
      await page.waitForTimeout(2000);
      return true;
    }

    await page.waitForTimeout(1000);
  }

  logger.warn('Timed out waiting for results');
  await takeScreenshot(page, 'results-timeout');
  return false;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
