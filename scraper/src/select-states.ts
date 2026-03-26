import { Page, Locator } from 'playwright';
import { SELECTORS } from './selectors.js';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';

/**
 * Prepare the search form and click Search to get ALL positions.
 *
 * Steps:
 * 1. Clear any pre-selected Position Type chips (the page sometimes
 *    loads with entries already selected)
 * 2. Type a single space in Community name (this matches all entries
 *    since every name contains a space, and ensures the search runs
 *    even with no other filters)
 * 3. Click Search
 */
export async function searchAllPositions(page: Page): Promise<void> {
  logger.info('Preparing search for all positions');

  // Step 1: Clear any pre-selected chips in ALL multiselect fields.
  // Each multiselect has a clear button (x icon) when items are selected.
  await clearAllMultiselects(page);

  await takeScreenshot(page, 'after-clearing-filters');

  // Step 2: Type a single space in the Community name field.
  // This matches all entries since every community name contains spaces.
  const communityInput = page.locator(
    'text=Community name >> xpath=following::input[1]'
  );

  if (await communityInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await communityInput.click();
    await communityInput.fill(' ');
    logger.info('Typed space in Community name field');
  } else {
    // Fallback: find input near the wildcard help text
    const fallback = page.locator(
      'text=You can use standard search wildcards >> xpath=preceding::input[1]'
    );
    await fallback.click();
    await fallback.fill(' ');
    logger.info('Typed space in Community name field (fallback locator)');
  }

  await takeScreenshot(page, 'before-search');

  // Step 3: Click the Search button
  const searchButton = page.locator(SELECTORS.searchButton).first();
  const buttonText = await searchButton.textContent();
  logger.info('Clicking search button', { text: buttonText?.trim() });

  await searchButton.click();
  logger.info('Clicked Search button');

  // Wait and check if the click worked
  await page.waitForTimeout(3000);
  await takeScreenshot(page, 'after-search-click');

  // Check if results appeared
  const pagerText = await page.locator(SELECTORS.pagerInfo).textContent().catch(() => '');
  logger.info('Pager after Playwright click', { text: pagerText });

  // If no results, try JavaScript click as fallback
  if (!pagerText || pagerText.includes('0 - 0 of 0')) {
    logger.warn('Playwright click may not have worked, trying JS click');
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent || '';
        if (text.includes('Search') && !text.includes('New')) {
          btn.click();
          return;
        }
      }
    });
    await page.waitForTimeout(3000);
    await takeScreenshot(page, 'after-js-click');
  }
}

/**
 * Clear all pre-selected items from multiselect dropdowns.
 * Each Telerik multiselect with selections shows a clear (x) button.
 */
async function clearAllMultiselects(page: Page): Promise<void> {
  // Find all chip remove buttons (the x on each individual chip)
  // and the clear-all button (the x on the right side of the multiselect)
  const clearButtons = page.locator('.k-clear-value, .k-chip-action, .k-chip-remove-action');
  let clearCount = await clearButtons.count();

  // Click clear-all buttons on multiselects first (the x icon on the right)
  const clearAll = page.locator('.k-clear-value');
  const clearAllCount = await clearAll.count();
  for (let i = 0; i < clearAllCount; i++) {
    const btn = clearAll.nth(i);
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      logger.info('Clicked clear-all button on multiselect', { index: i });
      await page.waitForTimeout(500);
    }
  }

  // Verify chips are gone
  const remainingChips = await page.locator(SELECTORS.chip).count();
  if (remainingChips > 0) {
    logger.warn('Some chips remain after clearing, removing individually', {
      remaining: remainingChips,
    });
    // Click individual chip remove buttons
    for (let i = remainingChips - 1; i >= 0; i--) {
      const removeBtn = page.locator(SELECTORS.chip).nth(i).locator('.k-chip-action, button').first();
      if (await removeBtn.isVisible().catch(() => false)) {
        await removeBtn.click();
        await page.waitForTimeout(300);
      }
    }
  }

  const finalChips = await page.locator(SELECTORS.chip).count();
  logger.info('Multiselect clearing complete', { remainingChips: finalChips });
}
