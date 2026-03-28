import { Page } from 'playwright';
import { logger } from './logger.js';
import { sleep } from './navigate.js';
import { SELECTORS } from './selectors.js';
import { takeScreenshot } from './browser.js';

// Same extraction script from deep-scrape (plain JS string, no tsx __name issue)
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

  // Extract label + div.form-control text pairs (dates, status fields rendered as plain text)
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

  // Extract Kendo grid table rows (Ministry Media and Links tab)
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

interface ProfileResult {
  id: number;
  fields: Array<{ label: string; value: string }>;
}

/**
 * Discover VH IDs AND extract detail data in a single pass.
 * For each search result row:
 * 1. Click row -> lands on /PositionView/{id}
 * 2. Capture the ID from the URL
 * 3. Wait for Blazor to load, click through tabs, extract all data
 * 4. Click "Back to Posting Search"
 * 5. Click Search again (space is retained)
 * 6. Continue to next row
 *
 * Returns both the discovered IDs and the extracted profile data.
 */
export interface DiscoveredId {
  id: number;
  name: string;
  diocese: string;
}

/**
 * Normalize a church/position name for comparison.
 * Strips formatting differences between VH search results and profile pages.
 */
function normalizeName(name: string): string {
  return (name || '').toLowerCase()
    .replace(/\bsaints?\b/g, 'st')
    .replace(/\bsts\.?\s/g, 'st ')
    .replace(/\bst\.\s*/g, 'st ')
    .replace(/\bmount\b/g, 'mt')
    .replace(/\bmt\.\s*/g, 'mt ')
    .replace(/\s*\/.*$/, '')
    .replace(/['\u2018\u2019`]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/,.*$/, '')
    .replace(/-/g, ' ')
    .replace(/\b(the|of|and|in|at|for|a|an|be)\b/g, '')
    .replace(/\b(episcopal|church|parish|community|chapel|cathedral|mission|memorial)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/([a-z]{4,})s\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two names are compatible (share key distinguishing tokens).
 * Returns true if names likely refer to the same church.
 */
function namesMatch(rowName: string, profileCongregation: string): boolean {
  const rn = normalizeName(rowName);
  const pn = normalizeName(profileCongregation);
  if (!rn || !pn) return true; // Can't validate without names
  if (rn === pn) return true;

  const rTokens = rn.split(/\s+/).filter(t => t.length > 1);
  const pTokens = pn.split(/\s+/).filter(t => t.length > 1);
  if (rTokens.length === 0 || pTokens.length === 0) return true;

  // Check if key tokens overlap (at least one non-generic word matches)
  const generic = new Set(['st', 'mt', 'holy', 'all', 'good']);
  const rKey = rTokens.filter(t => !generic.has(t));
  const pKey = pTokens.filter(t => !generic.has(t));
  if (rKey.length === 0 || pKey.length === 0) {
    // All tokens are generic (e.g., "Holy Trinity") - compare full normalized
    return rTokens.some(t => pTokens.includes(t));
  }
  return rKey.some(t => pKey.includes(t));
}

export async function discoverAndScrapePositions(
  page: Page,
  searchUrl: string
): Promise<{ ids: DiscoveredId[]; profiles: ProfileResult[] }> {
  const ids: DiscoveredId[] = [];
  const profiles: ProfileResult[] = [];
  let pageNum = 1;
  let consecutiveFailures = 0;

  while (consecutiveFailures < 3) {
    const rowCount = await page.locator('.k-grid tbody tr').count();
    logger.info('Processing search results', { page: pageNum, rows: rowCount });

    if (rowCount === 0) break;

    for (let i = 0; i < rowCount; i++) {
      try {
        // Capture row name and diocese BEFORE clicking (for reliable ID mapping)
        const row = page.locator('.k-grid tbody tr').nth(i);
        const cells = row.locator('td');
        const rowName = await cells.nth(0).textContent().catch(() => '') || '';
        const rowDiocese = await cells.nth(1).textContent().catch(() => '') || '';

        // Click the row
        await row.click();
        await sleep(1500);

        const url = page.url();
        const match = url.match(/PositionView\/(\d+)/);

        if (match) {
          const id = parseInt(match[1], 10);
          consecutiveFailures = 0;

          // We're on the profile page. Extract detail data while we're here.
          // Wait for tabs to render
          await page.waitForSelector('[role="tab"]', { timeout: 5_000 }).catch(() => {});
          await sleep(1500);

          // Click through all 6 tabs to load content
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

          // Extract all field data
          const fields = await page.evaluate(EXTRACT_PROFILE) as Array<{ label: string; value: string }>;

          // Post-click validation: verify the profile page matches the row we intended to click.
          // Extract congregation name from profile fields and compare to captured row name.
          const congField = fields.find(f =>
            f.label.toLowerCase() === 'congregation' ||
            f.label.toLowerCase() === 'community name' ||
            f.label.toLowerCase() === 'congregation name'
          );
          const profileCongregation = congField?.value || '';

          if (profileCongregation && rowName.trim() && !namesMatch(rowName.trim(), profileCongregation)) {
            logger.warn('Post-click mismatch: row name does not match profile congregation', {
              row: i,
              page: pageNum,
              rowName: rowName.trim(),
              profileCongregation,
              vhId: id,
            });
            // Don't record this ID - it belongs to a different position
          } else {
            ids.push({ id, name: rowName.trim(), diocese: rowDiocese.trim() });
            profiles.push({ id, fields });

            logger.info('Got ID + data', {
              id,
              row: i,
              page: pageNum,
              fields: fields.length,
              total: ids.length,
            });
          }

          // Now go back to search results
          const backButton = page.locator('text=Back to Posting Search');
          if (await backButton.isVisible({ timeout: 5000 }).catch(() => false)) {
            await backButton.click();
            await sleep(2000);

            await page.waitForSelector(SELECTORS.searchButton, { timeout: 10_000 });
            await page.locator(SELECTORS.searchButton).first().click();
            await sleep(3000);

            const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
            if (!pagerText || pagerText.includes('0 - 0 of 0')) {
              logger.warn('Re-search returned 0, stopping', { discovered: ids.length });
              return { ids, profiles };
            }

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
            logger.warn('Back button not found, full re-navigate');
            await page.goto(searchUrl, { waitUntil: 'load', timeout: 20_000 });
            await page.waitForSelector(SELECTORS.searchButton, { timeout: 10_000 });
            await sleep(2000);
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
          logger.warn('No navigation', { row: i, url: url.substring(0, 80) });
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
          return { ids, profiles };
        }
      }
    }

    // Next page
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

  logger.info('Discovery + scrape complete', {
    ids: ids.length,
    profiles: profiles.length,
  });
  return { ids, profiles };
}
