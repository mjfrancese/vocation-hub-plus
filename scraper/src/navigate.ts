import { Page } from 'playwright';
import { CONFIG } from './config.js';
import { SELECTORS } from './selectors.js';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';

export async function navigateToSearch(page: Page): Promise<void> {
  logger.info('Navigating to Vocation Hub', { url: CONFIG.url });

  await page.goto(CONFIG.url, { waitUntil: 'networkidle', timeout: 60_000 });

  // Wait for the Blazor app to fully load
  await page.waitForSelector(SELECTORS.stateInput, { timeout: 30_000 });

  logger.info('Page loaded, search form is ready');
  await takeScreenshot(page, 'page-loaded');
}

export async function waitForResults(page: Page): Promise<boolean> {
  logger.info('Waiting for search results');

  // Wait for either results table or "no records" message
  const result = await Promise.race([
    page
      .waitForSelector(SELECTORS.resultsTable, { timeout: 60_000 })
      .then(() => true),
    page
      .waitForSelector(SELECTORS.noResults, { timeout: 60_000 })
      .then(() => false),
  ]);

  if (result) {
    logger.info('Results table found');
    // Give Blazor a moment to finish rendering all rows
    await page.waitForTimeout(1000);
  } else {
    logger.info('No results found');
  }

  return result;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
