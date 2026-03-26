import { Page } from 'playwright';
import { SELECTORS } from './selectors.js';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';

/**
 * Click Search with no filters to get all positions.
 */
export async function searchAllPositions(page: Page): Promise<void> {
  logger.info('Clicking Search with no filters to get all positions');

  await takeScreenshot(page, 'before-search');

  // Find and click the Search button (not "New Search")
  const searchButton = page.locator(SELECTORS.searchButton).first();
  await searchButton.scrollIntoViewIfNeeded();

  // Log what we found for debugging
  const buttonText = await searchButton.textContent();
  logger.info('Found search button', { text: buttonText?.trim() });

  // Click the button
  await searchButton.click();
  logger.info('Clicked Search button via Playwright click');

  // Wait a moment, then take screenshot to see if click had effect
  await page.waitForTimeout(3000);
  await takeScreenshot(page, 'after-search-click');

  // Check if the pager info changed from "0 - 0 of 0"
  const pagerText = await page.locator(SELECTORS.pagerInfo).textContent().catch(() => '');
  logger.info('Pager info after click', { text: pagerText });

  // If still showing 0 items, try JavaScript click as fallback
  if (!pagerText || pagerText.includes('0 - 0 of 0')) {
    logger.warn('Playwright click may not have triggered Blazor, trying JS click');
    await page.evaluate((selector) => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent || '';
        if (text.includes('Search') && !text.includes('New')) {
          btn.click();
          return;
        }
      }
    }, SELECTORS.searchButton);

    await page.waitForTimeout(3000);
    await takeScreenshot(page, 'after-js-click');

    const pagerText2 = await page.locator(SELECTORS.pagerInfo).textContent().catch(() => '');
    logger.info('Pager info after JS click', { text: pagerText2 });
  }
}
