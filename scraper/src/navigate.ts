import { Page } from 'playwright';
import { CONFIG } from './config.js';
import { SELECTORS } from './selectors.js';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';

export async function navigateToSearch(page: Page): Promise<void> {
  logger.info('Navigating to Vocation Hub', { url: CONFIG.url });

  // Use 'load' instead of 'networkidle' because Blazor maintains a
  // persistent SignalR WebSocket that prevents networkidle from resolving.
  await page.goto(CONFIG.url, { waitUntil: 'load', timeout: 60_000 });

  // Wait for the Blazor app to render the search form.
  // Look for the Search button as a reliable indicator.
  await page.waitForSelector(SELECTORS.searchButton, { timeout: 30_000 });

  // Additional wait for Blazor to finish initializing event handlers.
  logger.info('Waiting for Blazor to finish initialization');
  await page.waitForTimeout(3000);

  // Verify the "Community name" field is present (our search strategy needs it)
  await page.waitForSelector(SELECTORS.communityNameLabel, { timeout: 10_000 });

  logger.info('Page loaded, search form is ready');
  await takeScreenshot(page, 'page-loaded');
}

export async function waitForResults(page: Page): Promise<boolean> {
  logger.info('Waiting for search results');

  // After clicking search, wait for the page to show results.
  // The pager info text changes from "0 - 0 of 0 items" to "1 - N of M items"
  // We wait for either actual results or the "0 items" / "no records" state.
  try {
    // Wait for the grid/table to update. Give it up to 60 seconds for large result sets.
    await page.waitForFunction(
      () => {
        const pagerInfo = document.querySelector('.k-pager-info');
        if (pagerInfo) {
          const text = pagerInfo.textContent || '';
          // Check if it shows actual results (not "0 - 0 of 0")
          if (text.includes('of') && !text.includes('0 - 0 of 0')) {
            return true;
          }
        }
        // Also check for "no records" text
        if (document.body.textContent?.includes('No records matching')) {
          return true;
        }
        return false;
      },
      { timeout: 60_000 }
    );
  } catch {
    logger.warn('Timed out waiting for results, checking current state');
  }

  // Check what we got
  const pagerInfo = page.locator(SELECTORS.pagerInfo);
  const pagerText = await pagerInfo.textContent().catch(() => '');
  logger.info('Pager info text', { text: pagerText });

  if (pagerText && !pagerText.includes('0 - 0 of 0')) {
    logger.info('Results found', { pagerText });
    // Give Blazor time to finish rendering all rows
    await page.waitForTimeout(2000);
    return true;
  }

  // Check for "no records" message
  const noRecords = await page.locator(SELECTORS.noResults).count();
  if (noRecords > 0) {
    logger.info('No records matching the search');
    return false;
  }

  logger.warn('Unclear result state', { pagerText });
  return false;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
