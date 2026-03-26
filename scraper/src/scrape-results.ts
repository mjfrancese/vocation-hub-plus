import { Page } from 'playwright';
import { SELECTORS } from './selectors.js';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';
import { waitForResults, sleep } from './navigate.js';
import crypto from 'crypto';

export interface RawPosition {
  id: string;
  name: string;
  diocese: string;
  state: string;
  organizationType: string;
  positionType: string;
  receivingNamesFrom: string;
  receivingNamesTo: string;
  updatedOnHub: string;
  detailsUrl: string;
  rawHtml: string;
}

function generateId(name: string, diocese: string, positionType: string): string {
  const input = `${name}|${diocese}|${positionType}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Wait for search results and extract all positions across all pages.
 */
export async function clickSearchAndExtract(page: Page): Promise<RawPosition[]> {
  const hasResults = await waitForResults(page);
  if (!hasResults) {
    logger.info('Search returned no results');
    return [];
  }

  await takeScreenshot(page, 'results-loaded');

  const allPositions: RawPosition[] = [];
  let currentPage = 1;

  while (true) {
    logger.info('Extracting results from page', { page: currentPage });
    const positions = await extractCurrentPage(page);
    allPositions.push(...positions);
    logger.info('Extracted positions from page', { page: currentPage, count: positions.length });

    // Check for next page
    const hasNextPage = await goToNextPage(page);
    if (!hasNextPage) {
      break;
    }
    currentPage++;

    // Wait for the table to reload after pagination
    await sleep(2000);

    // Verify results still exist after pagination. Blazor may reset the
    // search context when paginating, causing 0 results on page 2+.
    const pagerText = await page.locator(SELECTORS.pagerInfo).textContent().catch(() => '');
    if (!pagerText || pagerText.includes('0 - 0 of 0')) {
      logger.warn('Pagination caused page to reset, returning results from previous pages', {
        collected: allPositions.length,
      });
      await takeScreenshot(page, 'pagination-reset');
      break;
    }
  }

  logger.info('Total positions extracted', { total: allPositions.length });
  return allPositions;
}

/**
 * Extract all rows from the current page in a SINGLE page.evaluate() call.
 *
 * This replaces the previous approach of calling Playwright locators
 * individually for each cell (175+ round-trips for 25 rows x 7 columns),
 * which caused 10-minute timeouts. A single evaluate() runs all DOM
 * reads in the browser context with one round-trip.
 */
async function extractCurrentPage(page: Page): Promise<RawPosition[]> {
  const rawRows = await page.evaluate(() => {
    const grid = document.querySelector('.k-grid');
    if (!grid) return [];

    // Read headers to build column map
    const headerCells = grid.querySelectorAll('thead th');
    const colMap: Record<string, number> = {};
    headerCells.forEach((th, i) => {
      const text = (th.textContent || '').trim().toUpperCase();
      if (text.includes('NAME') && !text.includes('RECEIVING')) colMap.name = i;
      else if (text.includes('DIOCESE')) colMap.diocese = i;
      else if (text.includes('ORGANIZATION')) colMap.organizationType = i;
      else if (text.includes('POSITION')) colMap.positionType = i;
      else if (text.includes('RECEIVING') && !('receivingFrom' in colMap)) colMap.receivingFrom = i;
      else if (text.includes('RECEIVING')) colMap.receivingTo = i;
      else if (text.includes('UPDATE')) colMap.updated = i;
      else if (text.includes('STATE')) colMap.state = i;
    });

    // Read all data rows
    const rows = grid.querySelectorAll('tbody tr');
    const results: Array<{
      name: string;
      diocese: string;
      state: string;
      organizationType: string;
      positionType: string;
      receivingNamesFrom: string;
      receivingNamesTo: string;
      updatedOnHub: string;
      detailsUrl: string;
      rawHtml: string;
    }> = [];

    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) return;

      const getCell = (key: string): string => {
        const idx = colMap[key];
        if (idx === undefined || idx >= cells.length) return '';
        return (cells[idx].textContent || '').trim();
      };

      const name = getCell('name');
      const diocese = getCell('diocese');
      if (!name && !diocese) return; // skip empty rows

      // Check for a link in the name cell
      let detailsUrl = '';
      if (colMap.name !== undefined && colMap.name < cells.length) {
        const link = cells[colMap.name].querySelector('a');
        if (link) detailsUrl = link.getAttribute('href') || '';
      }

      results.push({
        name,
        diocese,
        state: getCell('state'),
        organizationType: getCell('organizationType'),
        positionType: getCell('positionType'),
        receivingNamesFrom: getCell('receivingFrom'),
        receivingNamesTo: getCell('receivingTo'),
        updatedOnHub: getCell('updated'),
        detailsUrl,
        rawHtml: row.innerHTML,
      });
    });

    return results;
  });

  // Add IDs on the Node side (crypto not available in browser)
  return rawRows.map((row) => ({
    ...row,
    id: generateId(row.name, row.diocese, row.positionType),
  }));
}

async function goToNextPage(page: Page): Promise<boolean> {
  try {
    const pager = page.locator(SELECTORS.pager);
    const pagerExists = (await pager.count()) > 0;

    if (!pagerExists) {
      return false;
    }

    const nextButton = page.locator(SELECTORS.pagerNext);
    const nextExists = (await nextButton.count()) > 0;
    if (!nextExists) {
      return false;
    }

    const isDisabled = await nextButton.isDisabled().catch(() => true);
    if (isDisabled) {
      return false;
    }

    await nextButton.click();
    await page.waitForTimeout(1500);
    return true;
  } catch {
    return false;
  }
}
