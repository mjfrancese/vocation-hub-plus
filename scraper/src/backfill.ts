/**
 * Layer 2: Targeted backfill for positions missing VH IDs.
 *
 * Instead of relying on clicking search result rows (which is fragile),
 * this searches VH by the specific position name to find its VH ID.
 * Runs after the main scrape pass when there are positions without VH IDs.
 *
 * Strategy:
 * 1. Get list of positions missing VH IDs (with attempt tracking)
 * 2. For each, search VH using the community name
 * 3. If exactly one result, click it to get the VH ID from the URL
 * 4. Extract profile data while on the page
 * 5. Record success or failure for tracking
 */

import { Page } from 'playwright';
import { logger } from './logger.js';
import { sleep } from './navigate.js';
import { SELECTORS } from './selectors.js';
import {
  getBackfillCandidates,
  recordDiscoveryAttempt,
  recordDiscoverySuccess,
  getDiscoveryStats,
  type BackfillCandidate,
} from './db.js';

// Same extraction script as discover-ids-from-search.ts
const EXTRACT_PROFILE = `(function() {
  var inputs = document.querySelectorAll('.k-input-inner, .k-input, input, textarea');
  var fields = [];
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    var val = (el.value || '').trim();
    if (!val || val === 'on') continue;
    var label = '';
    var container = el.closest('.k-form-field, .form-group, [class*="field"]');
    if (container) {
      var lbl = container.querySelector('label, .k-label, [class*="label"]');
      if (lbl) label = lbl.textContent.trim();
    }
    if (!label) {
      var prev = el.previousElementSibling;
      while (prev && !label) {
        if (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV') {
          var t = prev.textContent.trim();
          if (t.length > 0 && t.length < 100) label = t;
        }
        prev = prev.previousElementSibling;
      }
    }
    fields.push({ label: label, value: val.substring(0, 5000) });
  }
  var smallLabels = document.querySelectorAll('label.small');
  for (var sl = 0; sl < smallLabels.length; sl++) {
    var lbl = smallLabels[sl];
    var sib = lbl.nextElementSibling;
    while (sib && sib.nodeType === 8) sib = sib.nextElementSibling;
    if (sib && sib.classList && sib.classList.contains('form-control')) {
      var hasInput = sib.querySelector('input, textarea, select');
      var txtVal = (sib.textContent || '').trim();
      if (!hasInput && txtVal) {
        fields.push({ label: lbl.textContent.trim(), value: txtVal.substring(0, 5000) });
      }
    }
  }
  var gridRows = document.querySelectorAll('tr.k-table-row, tr[role="row"].k-master-row');
  for (var gr = 0; gr < gridRows.length; gr++) {
    var cells = gridRows[gr].querySelectorAll('td');
    if (cells.length >= 2) {
      var gridLabel = (cells[0].textContent || '').trim();
      var gridVal = '';
      var gridLink = cells[1].querySelector('a[href]');
      if (gridLink) gridVal = gridLink.href;
      else gridVal = (cells[1].textContent || '').trim();
      if (gridLabel && gridVal) {
        fields.push({ label: gridLabel, value: gridVal.substring(0, 5000) });
      }
    }
  }
  return fields;
})()`;

interface BackfillResult {
  attempted: number;
  succeeded: number;
  failed: number;
  profiles: Array<{ id: number; fields: Array<{ label: string; value: string }> }>;
}

/**
 * Extract a search-friendly name from the position name.
 * e.g. "St Johns (Wake Forest)" -> "St Johns"
 * e.g. "Wethersfield and Glastonbury, Diocese of Connecticut" -> "Wethersfield"
 * The VH search uses wildcard matching, so a shorter unique term works better.
 */
function extractSearchName(name: string): string {
  // Remove diocese suffix like ", Diocese of X"
  let cleaned = name.replace(/,?\s*Diocese\s+of\s+.*/i, '').trim();
  // Remove parenthetical city/location
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/, '').trim();
  // For multi-church names like "Trinity Torrington and Trinity Lime Rock"
  // just use the first part
  if (cleaned.includes(' and ')) {
    cleaned = cleaned.split(' and ')[0].trim();
  }
  // For "Rosebud Episcopal Mission West" type names, use first 2-3 distinctive words
  const words = cleaned.split(/\s+/);
  const stopWords = new Set(['the', 'of', 'in', 'at', 'for', 'a', 'an', 'episcopal', 'church', 'parish']);
  const distinctive = words.filter(w => !stopWords.has(w.toLowerCase()));
  // Use first distinctive word (most unique) + wildcard
  if (distinctive.length > 0) {
    return distinctive[0] + '*';
  }
  return cleaned;
}

export async function runBackfill(
  page: Page,
  searchUrl: string,
  maxPositions: number = 10,
): Promise<BackfillResult> {
  const candidates = getBackfillCandidates(5);
  const result: BackfillResult = { attempted: 0, succeeded: 0, failed: 0, profiles: [] };

  if (candidates.length === 0) {
    logger.info('Backfill: no candidates needing VH IDs');
    return result;
  }

  const toProcess = candidates.slice(0, maxPositions);
  logger.info('Backfill: starting targeted search', {
    candidates: candidates.length,
    processing: toProcess.length,
  });

  for (const candidate of toProcess) {
    result.attempted++;
    const searchName = extractSearchName(candidate.name);

    try {
      logger.info('Backfill: searching for position', {
        name: candidate.name,
        searchTerm: searchName,
        diocese: candidate.diocese,
        attempt: candidate.attempts + 1,
      });

      // Navigate to search page
      await page.goto(searchUrl, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForSelector(SELECTORS.searchButton, { timeout: 15_000 });
      await sleep(3000);

      // Enter the position name in the community name search field
      const nameInput = page.locator('input[type="text"]').first();
      if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nameInput.fill(searchName);
        await sleep(500);
      }

      // Select the diocese to narrow results
      if (candidate.diocese) {
        try {
          const dioceseInput = page.locator(SELECTORS.dioceseInput);
          if (await dioceseInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await dioceseInput.click();
            await sleep(1000);
            // Type diocese name to filter the dropdown
            await dioceseInput.fill(candidate.diocese);
            await sleep(1000);
            // Click the matching option
            const option = page.locator(`${SELECTORS.listItem}:has-text("${candidate.diocese}")`).first();
            if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
              await option.click();
              await sleep(500);
              // Close dropdown by clicking elsewhere
              await page.locator('body').click({ position: { x: 10, y: 10 } });
              await sleep(500);
            }
          }
        } catch {
          // Diocese filter is nice-to-have, not critical
          logger.warn('Backfill: could not set diocese filter', { diocese: candidate.diocese });
        }
      }

      // Click Search
      await page.locator(SELECTORS.searchButton).first().click();
      await sleep(4000);

      // Check results
      const pagerText = await page.locator(SELECTORS.pagerInfo).textContent().catch(() => '');
      const rowCount = await page.locator('.k-grid tbody tr').count();

      if (rowCount === 0 || (pagerText && pagerText.includes('0 - 0 of 0'))) {
        logger.warn('Backfill: no search results', { name: candidate.name, searchTerm: searchName });
        recordDiscoveryAttempt(candidate.position_id, candidate.name, candidate.diocese, 'no_search_results');
        result.failed++;
        continue;
      }

      // If multiple results, try to find the right row by matching name and diocese
      let targetRow = 0;
      if (rowCount > 1) {
        const normalizedName = candidate.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (let i = 0; i < rowCount; i++) {
          const row = page.locator('.k-grid tbody tr').nth(i);
          const cellText = await row.locator('td').first().textContent().catch(() => '') || '';
          const normalizedCell = cellText.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (normalizedCell === normalizedName || normalizedCell.includes(normalizedName) || normalizedName.includes(normalizedCell)) {
            targetRow = i;
            break;
          }
        }
      }

      // Click the target row
      const row = page.locator('.k-grid tbody tr').nth(targetRow);
      await row.click();
      await sleep(2000);

      // Check if we navigated to a PositionView page
      const url = page.url();
      const idMatch = url.match(/PositionView\/(\d+)/);

      if (!idMatch) {
        logger.warn('Backfill: click did not navigate to profile', {
          name: candidate.name,
          url: url.substring(0, 80),
        });
        recordDiscoveryAttempt(candidate.position_id, candidate.name, candidate.diocese, 'no_navigation');
        result.failed++;
        continue;
      }

      const vhId = parseInt(idMatch[1], 10);
      logger.info('Backfill: found VH ID', { name: candidate.name, vhId });

      // Extract profile data while we're on the page
      await page.waitForSelector('[role="tab"]', { timeout: 5_000 }).catch(() => {});
      await sleep(1500);

      // Click through tabs
      const tabNames = [
        'Basic Information',
        'Position Details',
        'Stipend, Housing, and Benefits',
        'Ministry Context and Desired Skills',
        'Ministry Media and Links',
        'Optional Narrative Reflections',
      ];

      for (const tabName of tabNames) {
        try {
          const tab = page.locator(`text="${tabName}"`).first();
          if (await tab.isVisible({ timeout: 500 }).catch(() => false)) {
            await tab.click();
            await sleep(500);
          }
        } catch { /* tab may not exist */ }
      }

      const fields = await page.evaluate(EXTRACT_PROFILE) as Array<{ label: string; value: string }>;
      result.profiles.push({ id: vhId, fields });

      // Record success
      recordDiscoverySuccess(candidate.position_id, vhId);
      result.succeeded++;

      logger.info('Backfill: success', {
        name: candidate.name,
        vhId,
        fields: fields.length,
      });

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn('Backfill: error processing position', {
        name: candidate.name,
        error: errorMsg.substring(0, 200),
      });
      recordDiscoveryAttempt(
        candidate.position_id,
        candidate.name,
        candidate.diocese,
        errorMsg.substring(0, 500)
      );
      result.failed++;
    }
  }

  // Log summary
  const stats = getDiscoveryStats();
  logger.info('Backfill complete', {
    attempted: result.attempted,
    succeeded: result.succeeded,
    failed: result.failed,
    profiles: result.profiles.length,
    pendingTotal: stats.pending,
    failedTotal: stats.failed,
    resolvedTotal: stats.resolved,
  });

  return result;
}
