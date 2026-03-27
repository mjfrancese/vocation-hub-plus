import { Page } from 'playwright';
import { logger } from './logger.js';
import { sleep } from './navigate.js';
import { navigateToSearch } from './navigate.js';
import { searchAllPositions } from './select-states.js';

/**
 * Discover VH position IDs by clicking each search result row.
 * After each click, fully re-navigates and re-searches using the
 * same proven functions that the main scrape uses.
 */
export async function discoverPositionIds(
  page: Page,
  searchUrl: string
): Promise<number[]> {
  const ids: number[] = [];
  let pageNum = 1;

  while (true) {
    const rowCount = await page.locator('.k-grid tbody tr').count();
    logger.info('Discovering IDs from search page', { page: pageNum, rows: rowCount });

    if (rowCount === 0) break;

    for (let i = 0; i < rowCount; i++) {
      try {
        // Click the row
        const row = page.locator('.k-grid tbody tr').nth(i);
        await row.click();

        // Wait for URL to change to /PositionView/{id}
        await page.waitForURL('**/PositionView/**', { timeout: 10_000 });
        const url = page.url();
        const match = url.match(/PositionView\/(\d+)/);

        if (match) {
          const id = parseInt(match[1], 10);
          ids.push(id);
          logger.info('Captured ID', { id, row: i, page: pageNum, total: ids.length });
        }

        // Re-navigate and re-search using the proven functions
        await navigateToSearch(page);
        await searchAllPositions(page);
        await sleep(3000);

        // Verify results came back
        const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
        if (!pagerText || pagerText.includes('0 - 0 of 0')) {
          logger.warn('Re-search returned 0 results, stopping', { discovered: ids.length });
          return ids;
        }

        // Navigate to the correct results page if needed
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
          if (clicked) await sleep(2000);
        }
      } catch (err) {
        logger.warn('Error capturing ID', {
          row: i,
          page: pageNum,
          error: String(err).substring(0, 100),
        });
        // Recover
        try {
          await navigateToSearch(page);
          await searchAllPositions(page);
          await sleep(3000);
        } catch {
          return ids;
        }
      }
    }

    // Try next page of results
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

    const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
    if (!pagerText || pagerText.includes('0 - 0 of 0')) break;
  }

  logger.info('ID discovery complete', { total: ids.length, ids });
  return ids;
}
