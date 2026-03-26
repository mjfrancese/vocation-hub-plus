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

  // Find the Community name input field. It's after the "Community name" label.
  // Since there are multiple text inputs on the page, locate it relative to its label.
  const communitySection = page.locator('text=Community name').first();
  await communitySection.scrollIntoViewIfNeeded();

  // The input is near the Community name label. Use the last plain text input
  // on the page (the Community name field is at the bottom of the form).
  const allInputs = page.locator('input[type="text"]');
  const inputCount = await allInputs.count();
  logger.info('Found text inputs on page', { count: inputCount });

  // The Community name input is the last text input that is NOT inside a
  // multiselect widget (no placeholder containing "select one or more")
  let communityInput = null;
  for (let i = inputCount - 1; i >= 0; i--) {
    const input = allInputs.nth(i);
    const placeholder = await input.getAttribute('placeholder') || '';
    const isMultiselect = placeholder.toLowerCase().includes('select one or more');
    if (!isMultiselect) {
      communityInput = input;
      logger.info('Found Community name input', { index: i, placeholder });
      break;
    }
  }

  if (!communityInput) {
    // Fallback: try to find by proximity to label
    communityInput = page.locator('input[type="text"]').last();
    logger.warn('Using fallback: last text input on page');
  }

  // Clear any existing text and type the wildcard
  await communityInput.click();
  await communityInput.fill('*');
  logger.info('Typed wildcard "*" in Community name field');

  await takeScreenshot(page, 'wildcard-entered');

  // Click the Search button
  const searchButton = page.locator(SELECTORS.searchButton);
  await searchButton.click();
  logger.info('Clicked Search button');
}
