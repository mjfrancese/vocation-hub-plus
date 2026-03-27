import { Page } from 'playwright';
import { logger } from './logger.js';
import { sleep } from './navigate.js';

// JavaScript to intercept Blazor's navigation and capture the URL
// without actually leaving the search results page.
const INTERCEPT_SCRIPT = `(function() {
  window.__capturedUrl = null;
  window.__origPushState = history.pushState.bind(history);
  window.__origReplaceState = history.replaceState.bind(history);

  history.pushState = function(state, title, url) {
    window.__capturedUrl = url;
    // DON'T actually navigate - keep the search page
  };
  history.replaceState = function(state, title, url) {
    window.__capturedUrl = url;
  };

  // Also intercept location changes
  window.__origLocation = window.location.href;
})()`;

const RESTORE_SCRIPT = `(function() {
  if (window.__origPushState) {
    history.pushState = window.__origPushState;
  }
  if (window.__origReplaceState) {
    history.replaceState = window.__origReplaceState;
  }
  window.__capturedUrl = null;
})()`;

const GET_CAPTURED_URL = `(function() {
  return window.__capturedUrl || null;
})()`;

/**
 * Discover VH position IDs by clicking each search result row.
 * Intercepts Blazor's navigation so the search page stays intact.
 * No re-searching needed between clicks.
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
        // Install the navigation interceptor
        await page.evaluate(INTERCEPT_SCRIPT);

        // Click the row - Blazor will try to navigate but we intercept it
        const row = page.locator('.k-grid tbody tr').nth(i);
        await row.click();

        // Give Blazor a moment to process the click and attempt navigation
        await sleep(500);

        // Read the captured URL
        const capturedUrl = await page.evaluate(GET_CAPTURED_URL) as string | null;

        // Restore normal navigation
        await page.evaluate(RESTORE_SCRIPT);

        if (capturedUrl) {
          const match = capturedUrl.match(/PositionView\/(\d+)/);
          if (match) {
            const id = parseInt(match[1], 10);
            ids.push(id);
            logger.info('Captured ID', { id, row: i, page: pageNum, total: ids.length });
          }
        } else {
          logger.warn('No URL captured for row', { row: i, page: pageNum });

          // Fallback: check if the page actually navigated despite our intercept
          const currentUrl = page.url();
          const match = currentUrl.match(/PositionView\/(\d+)/);
          if (match) {
            const id = parseInt(match[1], 10);
            ids.push(id);
            logger.info('Captured ID from actual navigation (fallback)', { id });

            // We need to go back to search since we actually navigated
            await page.goto(searchUrl, { waitUntil: 'load', timeout: 30_000 });
            await sleep(5000);

            // Re-search
            const { searchAllPositions } = await import('./select-states.js');
            await searchAllPositions(page);
            await sleep(3000);

            // Navigate to correct results page
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
          }
        }
      } catch (err) {
        logger.warn('Error discovering ID', {
          row: i,
          page: pageNum,
          error: String(err).substring(0, 100),
        });
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
