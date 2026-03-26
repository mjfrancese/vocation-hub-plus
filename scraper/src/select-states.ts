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

  // Take a screenshot before we start to see the initial state
  await takeScreenshot(page, 'before-state-selection');

  while (consecutiveFailures < CONFIG.maxDropdownRetries) {
    // Step 1: Click the state input to open the dropdown
    const opened = await openDropdown(page);
    if (!opened) {
      consecutiveFailures++;
      logger.warn('Failed to open dropdown', {
        attempt: consecutiveFailures,
        maxRetries: CONFIG.maxDropdownRetries,
      });
      // Wait a bit longer between retries in case Blazor is still processing
      await sleep(1000 * consecutiveFailures);
      continue;
    }

    // Short pause to let the dropdown list fully populate
    await sleep(500);

    // Step 2: Find the first unselected item in the visible popup
    const popups = page.locator(SELECTORS.popupContainer);
    const popupCount = await popups.count();
    logger.debug('Found popup containers', { count: popupCount });

    // Find the visible popup (there may be hidden ones in the DOM)
    let activePopup = null;
    for (let i = popupCount - 1; i >= 0; i--) {
      const popup = popups.nth(i);
      const isVisible = await popup.isVisible().catch(() => false);
      if (isVisible) {
        activePopup = popup;
        break;
      }
    }

    if (!activePopup) {
      logger.warn('No visible popup found after opening dropdown');
      consecutiveFailures++;
      await page.click('body', { position: { x: 10, y: 10 } });
      await sleep(500);
      continue;
    }

    const unselectedItems = activePopup.locator(SELECTORS.listItemUnselected);
    const count = await unselectedItems.count();
    logger.debug('Unselected items in popup', { count });

    if (count === 0) {
      // Check if there are ANY items (selected or not) to distinguish
      // "all selected" from "empty/wrong popup"
      const allItems = activePopup.locator(SELECTORS.listItem);
      const totalItems = await allItems.count();

      if (totalItems > 0) {
        logger.info('All states have been selected', { total: selectedCount, totalItems });
        await page.click('body', { position: { x: 10, y: 10 } });
        break;
      } else {
        logger.warn('Popup is open but contains no items, retrying');
        consecutiveFailures++;
        await page.click('body', { position: { x: 10, y: 10 } });
        await sleep(1000);
        continue;
      }
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

    // Step 4: Wait for Blazor to process the selection
    await sleep(CONFIG.scrapeDelay);

    // Step 5: Verify chip count
    const chipCount = await page.locator(SELECTORS.chip).count();
    logger.debug('Chip count after selection', { chips: chipCount, expected: selectedCount });

    // Take a progress screenshot every 10 states
    if (selectedCount % 10 === 0) {
      await takeScreenshot(page, `states-progress-${selectedCount}`);
    }
  }

  if (consecutiveFailures >= CONFIG.maxDropdownRetries) {
    logger.error('Max dropdown retries exceeded', { selected: selectedCount });
    await takeScreenshot(page, 'dropdown-failure');
  }

  await takeScreenshot(page, 'states-selected');
  logger.info('State selection complete', { totalSelected: selectedCount });
  return selectedCount;
}

async function openDropdown(page: Page): Promise<boolean> {
  try {
    // Focus the input first, then click. Some Blazor components need
    // focus before click to trigger the dropdown.
    const input = page.locator(SELECTORS.stateInput);
    await input.scrollIntoViewIfNeeded();
    await input.click();

    // Wait for popup to appear. Use a generous timeout because Blazor
    // may need a SignalR round-trip to render the dropdown items.
    await page.waitForSelector(SELECTORS.popupContainer, {
      state: 'visible',
      timeout: 5000,
    });

    // Extra wait for the list items to populate inside the popup
    await page.waitForSelector(`${SELECTORS.popupContainer} ${SELECTORS.listItem}`, {
      timeout: 5000,
    });

    return true;
  } catch (err) {
    logger.debug('openDropdown failed', { error: String(err) });
    return false;
  }
}
