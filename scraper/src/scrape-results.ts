import { Page } from 'playwright';
import { SELECTORS } from './selectors.js';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';
import { waitForResults, sleep } from './navigate.js';
import { CONFIG } from './config.js';
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

  // Read the header row to determine column mapping
  const columnMap = await detectColumns(page);
  logger.info('Detected column mapping', { columns: columnMap });

  const allPositions: RawPosition[] = [];
  let currentPage = 1;

  while (true) {
    logger.info('Extracting results from page', { page: currentPage });
    const positions = await extractCurrentPage(page, columnMap);
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
 * Read the table header row to build a column index map.
 * This makes the scraper resilient to column order changes.
 */
async function detectColumns(page: Page): Promise<Record<string, number>> {
  const headers = page.locator(`${SELECTORS.resultsGrid} ${SELECTORS.resultsHeader}`);
  const headerCount = await headers.count();
  const columnMap: Record<string, number> = {};

  for (let i = 0; i < headerCount; i++) {
    const text = (await headers.nth(i).textContent())?.trim().toUpperCase() || '';

    if (text.includes('NAME') && !text.includes('RECEIVING')) {
      columnMap.name = i;
    } else if (text.includes('DIOCESE')) {
      columnMap.diocese = i;
    } else if (text.includes('ORGANIZATION')) {
      columnMap.organizationType = i;
    } else if (text.includes('POSITION')) {
      columnMap.positionType = i;
    } else if (text.includes('RECEIVING') && !('receivingFrom' in columnMap)) {
      columnMap.receivingFrom = i;
    } else if (text.includes('RECEIVING')) {
      columnMap.receivingTo = i;
    } else if (text.includes('UPDATE')) {
      columnMap.updated = i;
    } else if (text.includes('STATE')) {
      columnMap.state = i;
    }
  }

  return columnMap;
}

async function extractCurrentPage(
  page: Page,
  columnMap: Record<string, number>
): Promise<RawPosition[]> {
  const rows = page.locator(`${SELECTORS.resultsGrid} ${SELECTORS.resultsRow}`);
  const rowCount = await rows.count();
  const positions: RawPosition[] = [];

  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const cells = row.locator(SELECTORS.resultsCell);
    const cellCount = await cells.count();

    if (cellCount < 3) {
      continue; // Skip malformed rows
    }

    const getCell = async (key: string): Promise<string> => {
      const idx = columnMap[key];
      if (idx === undefined || idx >= cellCount) return '';
      return (await cells.nth(idx).textContent())?.trim() || '';
    };

    const name = await getCell('name');
    const diocese = await getCell('diocese');
    const organizationType = await getCell('organizationType');
    const positionType = await getCell('positionType');
    const receivingNamesFrom = await getCell('receivingFrom');
    const receivingNamesTo = await getCell('receivingTo');
    const updatedOnHub = await getCell('updated');
    const state = await getCell('state');

    // Skip empty rows (e.g. "no data" placeholder rows)
    if (!name && !diocese) {
      continue;
    }

    // Try to get a details link if the name cell contains a link
    const nameIdx = columnMap.name;
    const detailsUrl =
      nameIdx !== undefined
        ? await cells
            .nth(nameIdx)
            .locator('a')
            .getAttribute('href')
            .catch(() => '')
        : '';

    const rawHtml = await row.innerHTML().catch(() => '');
    const id = generateId(name, diocese, positionType);

    positions.push({
      id,
      name,
      diocese,
      state,
      organizationType,
      positionType,
      receivingNamesFrom,
      receivingNamesTo,
      updatedOnHub,
      detailsUrl: detailsUrl || '',
      rawHtml,
    });
  }

  return positions;
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
    // Wait for the table to update
    await page.waitForTimeout(1500);
    return true;
  } catch {
    return false;
  }
}
