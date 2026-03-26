import { Page } from 'playwright';
import { SELECTORS } from './selectors.js';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';

/**
 * Click Search with no filters to get all positions.
 * This returns more results than using a wildcard in the Community name field.
 */
export async function searchAllPositions(page: Page): Promise<void> {
  logger.info('Clicking Search with no filters to get all positions');

  // Click "New Search" first to ensure a clean form state
  const newSearchBtn = page.locator(SELECTORS.newSearchButton);
  if (await newSearchBtn.isVisible().catch(() => false)) {
    await newSearchBtn.click();
    logger.info('Clicked New Search to reset form');
    await page.waitForTimeout(2000);
  }

  await takeScreenshot(page, 'before-search');

  const searchButton = page.locator(SELECTORS.searchButton);
  await searchButton.click();
  logger.info('Clicked Search button');
}
