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

export async function clickSearchAndExtract(page: Page): Promise<RawPosition[]> {
  const hasResults = await waitForResults(page);
  if (!hasResults) {
    logger.info('Search returned no results');
    return [];
  }

  await takeScreenshot(page, 'results-loaded');

  const allPositions: RawPosition[] = [];
  let currentPage = 1;
  const maxPages = 20; // safety limit to prevent infinite loops

  while (currentPage <= maxPages) {
    logger.info('Extracting results from page', { page: currentPage });
    const positions = await extractCurrentPage(page);
    allPositions.push(...positions);
    logger.info('Extracted positions from page', { page: currentPage, count: positions.length });

    // If this page returned 0 rows, stop (even if pagination says there's more)
    if (positions.length === 0) {
      logger.warn('Page returned 0 rows, stopping pagination', {
        collected: allPositions.length,
      });
      break;
    }

    const hasNextPage = await goToNextPage(page);
    if (!hasNextPage) break;
    currentPage++;

    await sleep(2000);

    // Verify results still exist after pagination
    const pagerText = await page.locator(SELECTORS.pagerInfo).textContent().catch(() => '');
    if (!pagerText || pagerText.includes('0 - 0 of 0')) {
      logger.warn('Pagination caused page to reset, returning results from previous pages', {
        collected: allPositions.length,
      });
      await takeScreenshot(page, 'pagination-reset');
      break;
    }

    await takeScreenshot(page, `page-${currentPage}`);
  }

  if (currentPage > maxPages) {
    logger.warn('Hit max page limit', { maxPages, collected: allPositions.length });
  }

  logger.info('Total positions extracted', { total: allPositions.length });
  return allPositions;
}

// Plain JavaScript string passed to page.evaluate() to avoid tsx injecting
// __name() helpers that don't exist in the browser context.
const EXTRACT_SCRIPT = `(function() {
  var grid = document.querySelector('.k-grid');
  if (!grid) return [];

  var headerCells = grid.querySelectorAll('thead th');
  var colMap = {};
  for (var i = 0; i < headerCells.length; i++) {
    var text = (headerCells[i].textContent || '').trim().toUpperCase();
    if (text.indexOf('NAME') >= 0 && text.indexOf('RECEIVING') < 0) colMap.name = i;
    else if (text.indexOf('DIOCESE') >= 0) colMap.diocese = i;
    else if (text.indexOf('ORGANIZATION') >= 0) colMap.organizationType = i;
    else if (text.indexOf('POSITION') >= 0) colMap.positionType = i;
    else if (text.indexOf('RECEIVING') >= 0 && colMap.receivingFrom === undefined) colMap.receivingFrom = i;
    else if (text.indexOf('RECEIVING') >= 0) colMap.receivingTo = i;
    else if (text.indexOf('UPDATE') >= 0) colMap.updated = i;
    else if (text.indexOf('STATE') >= 0) colMap.state = i;
  }

  var rows = grid.querySelectorAll('tbody tr');
  var results = [];

  for (var r = 0; r < rows.length; r++) {
    var cells = rows[r].querySelectorAll('td');
    if (cells.length < 3) continue;

    var name = colMap.name !== undefined && colMap.name < cells.length
      ? (cells[colMap.name].textContent || '').trim() : '';
    var diocese = colMap.diocese !== undefined && colMap.diocese < cells.length
      ? (cells[colMap.diocese].textContent || '').trim() : '';

    if (!name && !diocese) continue;

    var detailsUrl = '';
    if (colMap.name !== undefined && colMap.name < cells.length) {
      var link = cells[colMap.name].querySelector('a');
      if (link) detailsUrl = link.getAttribute('href') || '';
    }

    var cell = function(key) {
      var idx = colMap[key];
      if (idx === undefined || idx >= cells.length) return '';
      return (cells[idx].textContent || '').trim();
    };

    results.push({
      name: name,
      diocese: diocese,
      state: cell('state'),
      organizationType: cell('organizationType'),
      positionType: cell('positionType'),
      receivingNamesFrom: cell('receivingFrom'),
      receivingNamesTo: cell('receivingTo'),
      updatedOnHub: cell('updated'),
      detailsUrl: detailsUrl,
      rawHtml: rows[r].innerHTML
    });
  }

  return results;
})()`;

interface RawRow {
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

async function extractCurrentPage(page: Page): Promise<RawPosition[]> {
  const rawRows = (await page.evaluate(EXTRACT_SCRIPT)) as RawRow[];

  return rawRows.map((row) => ({
    ...row,
    id: generateId(row.name, row.diocese, row.positionType),
  }));
}

async function goToNextPage(page: Page): Promise<boolean> {
  try {
    const pager = page.locator(SELECTORS.pager);
    if ((await pager.count()) === 0) return false;

    // Try clicking the next page NUMBER button (e.g. "2", "3") instead of the
    // arrow. Blazor may handle numbered page buttons differently than arrows.
    const currentPageNum = await page.evaluate(`(function() {
      var selected = document.querySelector('.k-pager .k-selected');
      return selected ? parseInt(selected.textContent) : 0;
    })()`);

    if (typeof currentPageNum === 'number' && currentPageNum > 0) {
      const nextPageNum = currentPageNum + 1;
      // Click the next page number button via JavaScript
      const clicked = await page.evaluate(`(function() {
        var buttons = document.querySelectorAll('.k-pager button, .k-pager a');
        for (var i = 0; i < buttons.length; i++) {
          if (buttons[i].textContent.trim() === '${nextPageNum}') {
            buttons[i].click();
            return true;
          }
        }
        return false;
      })()`);

      if (clicked) {
        logger.info('Clicked page number button', { nextPage: nextPageNum });
        await page.waitForTimeout(2000);
        return true;
      }
    }

    // Fallback: try the next arrow button
    const nextButton = page.locator(SELECTORS.pagerNext);
    if ((await nextButton.count()) === 0) return false;
    if (await nextButton.isDisabled().catch(() => true)) return false;

    await nextButton.click();
    logger.info('Clicked next arrow button');
    await page.waitForTimeout(1500);
    return true;
  } catch {
    return false;
  }
}
