import { Page, BrowserContext } from 'playwright';
import { logger } from './logger.js';
import { sleep } from './navigate.js';
import { SELECTORS } from './selectors.js';

/**
 * Discover VH position IDs by clicking each search result row.
 * Uses a fresh page navigation approach: after clicking a row and
 * capturing the URL, navigates directly back to the search page
 * instead of using browser back (which was unreliable with Blazor).
 */
export async function discoverPositionIds(
  page: Page,
  searchUrl: string
): Promise<number[]> {
  const ids: number[] = [];
  let pageNum = 1;

  while (true) {
    // Count rows on current page
    const rowCount = await page.locator('.k-grid tbody tr').count();
    logger.info('Discovering IDs from search page', { page: pageNum, rows: rowCount });

    if (rowCount === 0) break;

    for (let i = 0; i < rowCount; i++) {
      try {
        // Click the row - Blazor will navigate to /PositionView/{id}
        const row = page.locator('.k-grid tbody tr').nth(i);
        await row.click();

        // Wait for URL to change to a PositionView page
        await page.waitForURL('**/PositionView/**', { timeout: 10_000 });
        const url = page.url();
        const match = url.match(/PositionView\/(\d+)/);

        if (match) {
          const id = parseInt(match[1], 10);
          ids.push(id);
          logger.info('Captured ID', { id, row: i, page: pageNum, total: ids.length });
        }

        // Navigate directly back to search (not goBack, which is fragile)
        await page.goto(searchUrl, { waitUntil: 'load', timeout: 30_000 });
        await page.waitForSelector(SELECTORS.searchButton, { timeout: 15_000 });
        await sleep(3000);

        // Re-search to get results back
        const communityInput = page.locator(
          'text=You can use standard search wildcards >> xpath=preceding::input[1]'
        );
        if (await communityInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await communityInput.fill(' ');
        }
        await page.locator(SELECTORS.searchButton).first().click();
        await sleep(3000);

        // Verify results came back
        const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
        if (!pagerText || pagerText.includes('0 - 0 of 0')) {
          logger.warn('Could not restore search results, stopping', { discovered: ids.length });
          return ids;
        }

        // If we need to navigate to the right page of results
        if (pageNum > 1) {
          const clicked = await page.evaluate(`(function() {
            var buttons = document.querySelectorAll('.k-pager button, .k-pager a');
            for (var i = 0; i < buttons.length; i++) {
              if (buttons[i].textContent.trim() === '${pageNum}') {
                buttons[i].click();
                return true;
              }
            }
            return false;
          })()`) as boolean;

          if (clicked) {
            await sleep(2000);
          }
        }
      } catch (err) {
        logger.warn('Error capturing ID for row', {
          row: i,
          page: pageNum,
          error: String(err).substring(0, 100),
        });
        // Try to recover by going back to search
        try {
          await page.goto(searchUrl, { waitUntil: 'load', timeout: 15_000 });
          await sleep(5000);
        } catch {
          return ids;
        }
      }
    }

    // Try to go to next page of results
    const currentPageNum = await page.evaluate(`(function() {
      var selected = document.querySelector('.k-pager .k-selected');
      return selected ? parseInt(selected.textContent) : 0;
    })()`) as number;

    const nextPageNum = currentPageNum + 1;
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

    const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
    if (!pagerText || pagerText.includes('0 - 0 of 0')) break;
  }

  logger.info('ID discovery complete', { total: ids.length, ids });
  return ids;
}
