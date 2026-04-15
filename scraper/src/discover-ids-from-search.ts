import { Page } from 'playwright';
import { logger } from './logger.js';
import { sleep } from './navigate.js';
import { SELECTORS } from './selectors.js';
import { clickAllProfileTabs, extractProfileFromLoadedPage } from './extractors/profile.js';

/**
 * Discover VH IDs by clicking search-result rows and reading /PositionView/{id}
 * from the URL. While on the profile page, also extract all field data.
 *
 * This path is now reserved for positions that DON'T yet have a VH ID
 * in position_vh_ids — typically 5-10 newly-posted positions on any
 * given daily run, not all 45 active positions. Previously-mapped
 * positions are refreshed via refresh-profiles.ts's direct-URL path.
 *
 * When `options.targets` is passed, only rows whose name+diocese match
 * a target are clicked. Other rows are skipped. This skips the ~35
 * rows per run that used to burn budget needlessly.
 *
 * Honors `options.signal`: checks between rows and between pages.
 * Aborting returns partial results with `aborted: true`.
 */

interface ProfileResult {
  id: number;
  fields: Array<{ label: string; value: string }>;
}

export interface DiscoveredId {
  id: number;
  name: string;
  diocese: string;
}

export interface DiscoveryTarget {
  positionId: string;
  name: string;
  diocese: string;
}

export interface DiscoverOptions {
  /** If provided, only click rows matching one of these targets. */
  targets?: DiscoveryTarget[];
  /** Check between rows and pages; abort returns partial results. */
  signal?: AbortSignal;
}

export interface DiscoverResult {
  ids: DiscoveredId[];
  profiles: ProfileResult[];
  aborted: boolean;
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
  if (!rn || !pn) return true;
  if (rn === pn) return true;

  const rTokens = rn.split(/\s+/).filter(t => t.length > 1);
  const pTokens = pn.split(/\s+/).filter(t => t.length > 1);
  if (rTokens.length === 0 || pTokens.length === 0) return true;

  const generic = new Set(['st', 'mt', 'holy', 'all', 'good']);
  const rKey = rTokens.filter(t => !generic.has(t));
  const pKey = pTokens.filter(t => !generic.has(t));
  if (rKey.length === 0 || pKey.length === 0) {
    return rTokens.some(t => pTokens.includes(t));
  }
  return rKey.some(t => pKey.includes(t));
}

/**
 * Normalize a diocese for matching. Diocese names are short and stable
 * enough that we can do a strict normalized-equality check.
 */
function normalizeDiocese(d: string): string {
  return (d || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Find an unmatched target whose diocese equals the row's diocese
 * and whose name is name-compatible with the row's name.
 */
function findMatchingTarget(
  rowName: string,
  rowDiocese: string,
  targets: DiscoveryTarget[],
  used: Set<string>
): DiscoveryTarget | null {
  const rd = normalizeDiocese(rowDiocese);
  for (const t of targets) {
    if (used.has(t.positionId)) continue;
    if (normalizeDiocese(t.diocese) !== rd) continue;
    if (namesMatch(rowName, t.name)) return t;
  }
  return null;
}

export async function discoverAndScrapePositions(
  page: Page,
  searchUrl: string,
  options: DiscoverOptions = {}
): Promise<DiscoverResult> {
  const ids: DiscoveredId[] = [];
  const profiles: ProfileResult[] = [];
  let pageNum = 1;
  let consecutiveFailures = 0;
  let aborted = false;
  const usedTargets = new Set<string>();

  const hasTargetFilter = Array.isArray(options.targets) && options.targets.length > 0;
  const remainingTargets = () =>
    hasTargetFilter
      ? (options.targets as DiscoveryTarget[]).filter(t => !usedTargets.has(t.positionId)).length
      : Infinity;

  if (hasTargetFilter) {
    logger.info('Discovery with target filter', {
      targets: (options.targets as DiscoveryTarget[]).length,
    });
  }

  while (consecutiveFailures < 3) {
    if (options.signal?.aborted) {
      aborted = true;
      logger.warn('Discovery aborted (before page loop)');
      break;
    }

    const rowCount = await page.locator('.k-grid tbody tr').count();
    logger.info('Processing search results', { page: pageNum, rows: rowCount });

    if (rowCount === 0) break;

    for (let i = 0; i < rowCount; i++) {
      if (options.signal?.aborted) {
        aborted = true;
        logger.warn('Discovery aborted mid-page', { page: pageNum, row: i });
        return { ids, profiles, aborted };
      }

      // Early exit when we've resolved every target.
      if (hasTargetFilter && remainingTargets() === 0) {
        logger.info('All targets resolved, ending discovery', { ids: ids.length });
        return { ids, profiles, aborted };
      }

      try {
        // Capture row name and diocese BEFORE clicking (for reliable ID mapping)
        const row = page.locator('.k-grid tbody tr').nth(i);
        const cells = row.locator('td');
        const rowName = (await cells.nth(0).textContent().catch(() => '') || '').trim();
        const rowDiocese = (await cells.nth(1).textContent().catch(() => '') || '').trim();

        // Skip rows that don't match any remaining target (target-filter mode).
        let matchedTarget: DiscoveryTarget | null = null;
        if (hasTargetFilter) {
          matchedTarget = findMatchingTarget(
            rowName,
            rowDiocese,
            options.targets as DiscoveryTarget[],
            usedTargets
          );
          if (!matchedTarget) continue;
        }

        // Click the row
        await row.click();
        await sleep(1500);

        const url = page.url();
        const match = url.match(/PositionView\/(\d+)/);

        if (match) {
          const id = parseInt(match[1], 10);
          consecutiveFailures = 0;

          await page.waitForSelector('[role="tab"]', { timeout: 5_000 }).catch(() => {});
          await sleep(1500);

          await clickAllProfileTabs(page, { signal: options.signal });

          const extracted = await extractProfileFromLoadedPage(page);
          const fields = extracted.fields;

          // Post-click validation: verify the profile page matches the row we intended to click.
          const congField = fields.find(f =>
            f.label.toLowerCase() === 'congregation' ||
            f.label.toLowerCase() === 'community name' ||
            f.label.toLowerCase() === 'congregation name'
          );
          const profileCongregation = congField?.value || '';

          if (profileCongregation && rowName && !namesMatch(rowName, profileCongregation)) {
            logger.warn('Post-click mismatch: row name does not match profile congregation', {
              row: i,
              page: pageNum,
              rowName,
              profileCongregation,
              vhId: id,
            });
          } else {
            ids.push({ id, name: rowName, diocese: rowDiocese });
            profiles.push({ id, fields });
            if (matchedTarget) usedTargets.add(matchedTarget.positionId);

            logger.info('Got ID + data', {
              id,
              row: i,
              page: pageNum,
              fields: fields.length,
              total: ids.length,
              targetRemaining: hasTargetFilter ? remainingTargets() : undefined,
            });
          }

          // Go back to search results.
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
              return { ids, profiles, aborted };
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
          return { ids, profiles, aborted };
        }
      }
    }

    // Early exit: targets exhausted, no need to paginate further.
    if (hasTargetFilter && remainingTargets() === 0) {
      logger.info('All targets resolved after page, ending discovery', {
        ids: ids.length,
        page: pageNum,
      });
      return { ids, profiles, aborted };
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
    aborted,
  });
  return { ids, profiles, aborted };
}
