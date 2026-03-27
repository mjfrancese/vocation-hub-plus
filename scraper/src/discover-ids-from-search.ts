import { Page } from 'playwright';
import { logger } from './logger.js';
import { sleep } from './navigate.js';
import { SELECTORS } from './selectors.js';
import { CONFIG } from './config.js';

/**
 * Fast re-search without screenshots or fallback JS clicks.
 * Used during ID discovery where speed matters.
 */
async function fastReSearch(page: Page): Promise<boolean> {
  await page.goto(CONFIG.url, { waitUntil: 'load', timeout: 20_000 });
  await page.waitForSelector(SELECTORS.searchButton, { timeout: 10_000 });
  await sleep(2000);

  // Type space in community name
  const input = page.locator(
    'text=You can use standard search wildcards >> xpath=preceding::input[1]'
  );
  if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
    await input.fill(' ');
  }

  await page.locator(SELECTORS.searchButton).first().click();
  await sleep(3000);

  const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
  return !!pagerText && !pagerText.includes('0 - 0 of 0');
}

/**
 * Discover VH position IDs by clicking each search result row.
 * Lets Blazor navigate, captures the URL, then does a fast re-search.
 */
export async function discoverPositionIds(
  page: Page,
  searchUrl: string
): Promise<number[]> {
  const ids: number[] = [];
  let pageNum = 1;
  let consecutiveFailures = 0;

  while (consecutiveFailures < 3) {
    const rowCount = await page.locator('.k-grid tbody tr').count();
    logger.info('Discovering IDs', { page: pageNum, rows: rowCount });

    if (rowCount === 0) break;

    for (let i = 0; i < rowCount; i++) {
      try {
        // Click the row
        await page.locator('.k-grid tbody tr').nth(i).click();
        await sleep(1500);

        // Check URL
        const url = page.url();
        const match = url.match(/PositionView\/(\d+)/);

        if (match) {
          const id = parseInt(match[1], 10);
          ids.push(id);
          consecutiveFailures = 0;
          logger.info('Got ID', { id, row: i, page: pageNum, total: ids.length });
        } else {
          consecutiveFailures++;
          logger.warn('No navigation', { row: i, url: url.substring(0, 80) });
        }

        // Fast re-search (no screenshots, no fallback)
        const ok = await fastReSearch(page);
        if (!ok) {
          logger.warn('Re-search failed, stopping', { discovered: ids.length });
          return ids;
        }

        // Navigate to correct results page if not on page 1
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
      } catch (err) {
        consecutiveFailures++;
        logger.warn('Error', { row: i, error: String(err).substring(0, 100) });
        try {
          await fastReSearch(page);
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
