import { Page } from 'playwright';
import { logger } from './logger.js';
import { sleep } from './navigate.js';
import { SELECTORS } from './selectors.js';

/**
 * Discover VH position IDs by clicking each search result row.
 *
 * Flow for each row:
 * 1. Click row -> Blazor navigates to /PositionView/{id}
 * 2. Capture the ID from the URL
 * 3. Click "Back to Posting Search" button on the profile page
 * 4. The search form retains the space in Community Name
 * 5. Just click Search again (no need to re-type the space)
 * 6. Results come back, click next row
 */
export async function discoverPositionIds(
  page: Page,
  searchUrl: string
): Promise<number[]> {
  const ids: number[] = [];
  let pageNum = 1;
  let consecutiveFailures = 0;
  let isFirstSearch = true;

  while (consecutiveFailures < 3) {
    const rowCount = await page.locator('.k-grid tbody tr').count();
    logger.info('Discovering IDs', { page: pageNum, rows: rowCount });

    if (rowCount === 0) break;

    for (let i = 0; i < rowCount; i++) {
      try {
        // Click the row
        await page.locator('.k-grid tbody tr').nth(i).click();
        await sleep(1500);

        // Check URL for the profile ID
        const url = page.url();
        const match = url.match(/PositionView\/(\d+)/);

        if (match) {
          const id = parseInt(match[1], 10);
          ids.push(id);
          consecutiveFailures = 0;
          logger.info('Got ID', { id, row: i, page: pageNum, total: ids.length });

          // Click "Back to Posting Search" button on the profile page
          const backButton = page.locator('text=Back to Posting Search');
          if (await backButton.isVisible({ timeout: 5000 }).catch(() => false)) {
            await backButton.click();
            await sleep(2000);

            // The space is still in Community Name, just click Search
            await page.waitForSelector(SELECTORS.searchButton, { timeout: 10_000 });
            await page.locator(SELECTORS.searchButton).first().click();
            await sleep(3000);

            // Verify results came back
            const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
            if (!pagerText || pagerText.includes('0 - 0 of 0')) {
              logger.warn('Re-search returned 0 after Back button, stopping', { discovered: ids.length });
              return ids;
            }

            // Navigate to correct page if needed
            if (pageNum > 1) {
              await page.evaluate(`(function() {
                var buttons = document.querySelectorAll('.k-pager button, .k-pager a');
                for (var i = 0; i < buttons.length; i++) {
                  if (buttons[i].textContent.trim() === '${pageNum}') {
                    buttons[i].click();
                    return;
                  }
                }
              })()`);
              await sleep(2000);
            }
          } else {
            // Fallback: full re-navigate if Back button not found
            logger.warn('Back button not found, doing full re-navigate');
            await page.goto(searchUrl, { waitUntil: 'load', timeout: 20_000 });
            await page.waitForSelector(SELECTORS.searchButton, { timeout: 10_000 });
            await sleep(2000);

            // Re-type space and search
            const input = page.locator(
              'text=You can use standard search wildcards >> xpath=preceding::input[1]'
            );
            if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
              await input.fill(' ');
            }
            await page.locator(SELECTORS.searchButton).first().click();
            await sleep(3000);
          }
        } else {
          consecutiveFailures++;
          logger.warn('No navigation detected', { row: i, url: url.substring(0, 80) });

          // Try to get back to search results
          if (!url.includes('PositionSearch')) {
            await page.goto(searchUrl, { waitUntil: 'load', timeout: 20_000 });
            await sleep(3000);
            await page.locator(SELECTORS.searchButton).first().click();
            await sleep(3000);
          }
        }
      } catch (err) {
        consecutiveFailures++;
        logger.warn('Error', { row: i, error: String(err).substring(0, 100) });
        try {
          await page.goto(searchUrl, { waitUntil: 'load', timeout: 15_000 });
          await sleep(3000);
        } catch {
          return ids;
        }
      }
    }

    // Try next page
    const nextPageNum = pageNum + 1;
    const clicked = await page.evaluate(`(function() {
      var buttons = document.querySelectorAll('.k-pager button, .k-pager a');
      for (var i = 0; i < buttons.length; i++) {
        if (buttons[i].textContent.trim() === '${nextPageNum}') {
          buttons[i].click();
          return true;
        }
      }
      return false;
    })()`) as boolean;

    if (!clicked) break;
    pageNum++;
    await sleep(2000);
  }

  logger.info('ID discovery complete', { total: ids.length, ids });
  return ids;
}
