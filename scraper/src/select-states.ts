import { Page } from 'playwright';
import { CONFIG } from './config.js';
import { SELECTORS } from './selectors.js';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';
import { sleep } from './navigate.js';

/**
 * Select all states from the State(s) multiselect dropdown.
 *
 * The Telerik MultiSelect auto-closes after each selection,
 * so we must re-open it for every state we pick.
 */
export async function selectAllStates(page: Page): Promise<number> {
  logger.info('Starting state selection');

  const seenStates = new Set<string>();
  let selectedCount = 0;
  let consecutiveFailures = 0;

  while (consecutiveFailures < CONFIG.maxDropdownRetries) {
    // Step 1: Click the state input to open the dropdown
    const opened = await openDropdown(page);
    if (!opened) {
      consecutiveFailures++;
      logger.warn('Failed to open dropdown', { attempt: consecutiveFailures });
      continue;
    }

    // Step 2: Find the first unselected item
    const popup = page.locator(SELECTORS.popupContainer).last();
    const unselectedItems = popup.locator(SELECTORS.listItemUnselected);
    const count = await unselectedItems.count();

    if (count === 0) {
      logger.info('All states have been selected', { total: selectedCount });
      // Click elsewhere to close any open dropdown
      await page.click('body', { position: { x: 10, y: 10 } });
      break;
    }

    // Get the text of the item we are about to select
    const itemText = await unselectedItems.first().textContent();
    const stateName = itemText?.trim() || 'unknown';

    // Guard against infinite loops
    if (seenStates.has(stateName)) {
      logger.warn('Already saw this state, possible loop', { state: stateName });
      consecutiveFailures++;
      await page.click('body', { position: { x: 10, y: 10 } });
      await sleep(CONFIG.scrapeDelay);
      continue;
    }

    // Step 3: Click the unselected item
    await unselectedItems.first().click();
    selectedCount++;
    seenStates.add(stateName);
    consecutiveFailures = 0;

    logger.info('Selected state', { state: stateName, count: selectedCount });

    // Step 4: Wait for Blazor to process
    await sleep(CONFIG.scrapeDelay);

    // Step 5: Verify chip count increased
    const chipCount = await page.locator(SELECTORS.chip).count();
    logger.debug('Chip count after selection', { chips: chipCount, expected: selectedCount });
  }

  if (consecutiveFailures >= CONFIG.maxDropdownRetries) {
    logger.error('Max dropdown retries exceeded, proceeding with what we have', {
      selected: selectedCount,
    });
  }

  await takeScreenshot(page, 'states-selected');
  logger.info('State selection complete', { totalSelected: selectedCount });
  return selectedCount;
}

async function openDropdown(page: Page): Promise<boolean> {
  try {
    await page.click(SELECTORS.stateInput);
    await page.waitForSelector(SELECTORS.popupContainer, {
      state: 'visible',
      timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}
