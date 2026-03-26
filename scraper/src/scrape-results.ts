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
 * Click the search button and extract all results across all pages.
 */
export async function clickSearchAndExtract(page: Page): Promise<RawPosition[]> {
  logger.info('Clicking search button');
  await page.click(SELECTORS.searchButton);

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
    await sleep(CONFIG.scrapeDelay);
  }

  logger.info('Total positions extracted', { total: allPositions.length });
  return allPositions;
}

async function extractCurrentPage(page: Page): Promise<RawPosition[]> {
  const rows = page.locator(`${SELECTORS.resultsTable} ${SELECTORS.resultsRow}`);
  const rowCount = await rows.count();
  const positions: RawPosition[] = [];

  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const cells = row.locator(SELECTORS.resultsCell);
    const cellCount = await cells.count();

    if (cellCount < 7) {
      continue; // Skip header or malformed rows
    }

    const name = (await cells.nth(0).textContent())?.trim() || '';
    const diocese = (await cells.nth(1).textContent())?.trim() || '';
    const state = (await cells.nth(2).textContent())?.trim() || '';
    const organizationType = (await cells.nth(3).textContent())?.trim() || '';
    const positionType = (await cells.nth(4).textContent())?.trim() || '';
    const receivingNamesFrom = (await cells.nth(5).textContent())?.trim() || '';
    const receivingNamesTo = (await cells.nth(6).textContent())?.trim() || '';
    const updatedOnHub = cellCount > 7 ? (await cells.nth(7).textContent())?.trim() || '' : '';

    // Try to get a details link if present
    const link = await cells.nth(0).locator('a').getAttribute('href').catch(() => '');
    const detailsUrl = link || '';

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
      detailsUrl,
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
    const isDisabled = await nextButton.isDisabled().catch(() => true);

    if (isDisabled) {
      return false;
    }

    await nextButton.click();
    // Wait for the table to update
    await page.waitForTimeout(1000);
    return true;
  } catch {
    return false;
  }
}
