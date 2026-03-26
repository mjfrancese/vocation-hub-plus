import { Page } from 'playwright';
import { SELECTORS } from './selectors.js';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';

/**
 * Instead of selecting individual states from the dropdown (which requires
 * complex Telerik MultiSelect interaction that fails in headless mode),
 * we use the Community name wildcard search.
 *
 * The site supports standard search wildcards (* and ?) in the community
 * name field. Typing "*" and clicking Search returns ALL positions.
 */
export async function searchAllPositions(page: Page): Promise<void> {
  logger.info('Using wildcard search to find all positions');

  // First, clear any pre-selected Position Types by clicking "New Search"
  // to reset the form to a clean state.
  const newSearchBtn = page.locator(SELECTORS.newSearchButton);
  if (await newSearchBtn.isVisible().catch(() => false)) {
    await newSearchBtn.click();
    logger.info('Clicked New Search to reset form');
    await page.waitForTimeout(2000);
  }

  // Locate the Community name input using its relationship to the
  // "Community name" label and the wildcard help text.
  // Strategy: find the first <input> that appears after "Community name" text
  // in DOM order, using XPath following-axis.
  const communityInput = page.locator(
    'text=Community name >> xpath=following::input[1]'
  );

  // Verify we found it
  const inputVisible = await communityInput.isVisible({ timeout: 5000 }).catch(() => false);

  if (!inputVisible) {
    // Fallback: find the input that's near the wildcard help text
    logger.warn('Primary locator failed, trying fallback');
    const fallbackInput = page.locator(
      'text=You can use standard search wildcards >> xpath=preceding::input[1]'
    );
    const fallbackVisible = await fallbackInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (fallbackVisible) {
      await fallbackInput.scrollIntoViewIfNeeded();
      await fallbackInput.click();
      await fallbackInput.fill('*');
      logger.info('Typed wildcard "*" in Community name field (fallback locator)');
    } else {
      throw new Error('Could not locate the Community name input field');
    }
  } else {
    await communityInput.scrollIntoViewIfNeeded();
    await communityInput.click();
    await communityInput.fill('*');
    logger.info('Typed wildcard "*" in Community name field');
  }

  await takeScreenshot(page, 'wildcard-entered');

  // Click the Search button
  const searchButton = page.locator(SELECTORS.searchButton);
  await searchButton.click();
  logger.info('Clicked Search button');
}
