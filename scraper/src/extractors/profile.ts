/**
 * Canonical profile extraction logic for Vocation Hub position pages.
 *
 * This module centralises the DOM-scraping logic that was previously
 * duplicated across discover-ids-from-search.ts, backfill.ts, and
 * deep-scrape.ts. All callers should import from here so future fixes
 * to VH's Kendo UI / Blazor markup are applied in one place.
 */

import { Page } from 'playwright';

const BASE_URL = 'https://vocationhub.episcopalchurch.org';

/**
 * Tab names on the VH Position View page. Clicking each tab is required
 * to load its content into the DOM before the extraction script can read it.
 */
export const TAB_NAMES = [
  'Basic Information',
  'Position Details',
  'Stipend, Housing, and Benefits',
  'Ministry Context and Desired Skills',
  'Ministry Media and Links',
  'Optional Narrative Reflections',
] as const;

/**
 * Plain-JS IIFE evaluated on the profile page.
 *
 * Must be a string (not a TS function) to avoid tsx wrapping the
 * function in `__name(...)` helpers that fail inside page.evaluate.
 *
 * Extracts from three DOM sources:
 *   1. Form inputs with labels (via .k-form-field / form-group containers)
 *   2. label.small + div.form-control text pairs (dates, status fields)
 *   3. Kendo grid rows (Ministry Media and Links tab)
 *
 * Returns diagnostic signals: fullText, textLength, tabCount.
 */
export const EXTRACT_PROFILE_SCRIPT = `(function() {
  var result = {};
  var body = document.body || document.documentElement;
  var text = body.innerText || '';
  result.fullText = text;
  result.textLength = text.length;

  var inputs = document.querySelectorAll('.k-input-inner, .k-input, input, textarea');
  var fields = [];
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    var val = (el.value || '').trim();
    if (!val || val === 'on' || val === 'English') continue;
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
    var slLbl = smallLabels[sl];
    var sib = slLbl.nextElementSibling;
    while (sib && sib.nodeType === 8) sib = sib.nextElementSibling;
    if (sib && sib.classList && sib.classList.contains('form-control')) {
      var hasInput = sib.querySelector('input, textarea, select');
      var txtVal = (sib.textContent || '').trim();
      if (!hasInput && txtVal) {
        fields.push({ label: slLbl.textContent.trim(), value: txtVal.substring(0, 5000) });
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

  result.fields = fields;

  var tabs = document.querySelectorAll('[role="tab"], .k-tabstrip-item, .k-item');
  result.tabCount = tabs.length;

  return result;
})()`;

export interface ExtractResult {
  fullText: string;
  textLength: number;
  fields: Array<{ label: string; value: string }>;
  tabCount: number;
}

export interface ProfileRecord {
  id: number;
  url: string;
  tabCount: number;
  fields: Array<{ label: string; value: string }>;
  fullText: string;
  scrapedAt: string;
}

export interface ProfileExtractOptions {
  signal?: AbortSignal;
  /** Override BASE_URL (for testing). */
  baseUrl?: string;
  /** Timeout for page.goto. Default 15s. */
  navigationTimeoutMs?: number;
  /** Skip the tabCount >= 6 validity check. Default false. */
  skipValidation?: boolean;
}

/**
 * Click through all six VH tabs on the currently-loaded profile page.
 * Each tab click forces Blazor to render that tab's fields into the DOM.
 *
 * Caller is responsible for having already navigated to the profile page.
 */
export async function clickAllProfileTabs(
  page: Page,
  opts: { signal?: AbortSignal } = {}
): Promise<void> {
  for (const tabName of TAB_NAMES) {
    if (opts.signal?.aborted) return;
    try {
      const tab = page.locator(`text="${tabName}"`).first();
      if (await tab.isVisible({ timeout: 500 }).catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(500);
      }
    } catch {
      /* tab may not exist on minimal/invalid pages */
    }
  }
}

/**
 * Extract fields from the currently-loaded profile page.
 * Assumes caller has already navigated and (ideally) clicked through tabs.
 */
export async function extractProfileFromLoadedPage(
  page: Page
): Promise<ExtractResult> {
  return (await page.evaluate(EXTRACT_PROFILE_SCRIPT)) as ExtractResult;
}

/**
 * Navigate to /PositionView/{id}, wait for tabs, click through all six,
 * and extract the full profile. Returns null if the page has fewer than
 * 6 tabs (i.e. the ID doesn't correspond to a valid public posting).
 *
 * Used by deep-scrape.ts and refresh-profiles.ts. Callers that are
 * already on the profile page (e.g. discover-ids-from-search after a
 * row click) should use clickAllProfileTabs + extractProfileFromLoadedPage
 * directly instead.
 */
export async function openProfileAndExtract(
  page: Page,
  id: number,
  opts: ProfileExtractOptions = {}
): Promise<ProfileRecord | null> {
  const baseUrl = opts.baseUrl ?? BASE_URL;
  const url = `${baseUrl}/PositionView/${id}`;
  const navTimeout = opts.navigationTimeoutMs ?? 15_000;

  await page.goto(url, { waitUntil: 'load', timeout: navTimeout });

  await page.waitForSelector('[role="tab"]', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await clickAllProfileTabs(page, { signal: opts.signal });

  await page.waitForTimeout(1000);

  const data = await extractProfileFromLoadedPage(page);

  if (!opts.skipValidation && data.tabCount < 6) {
    return null;
  }

  return {
    id,
    url,
    tabCount: data.tabCount,
    fields: data.fields,
    fullText: data.fullText,
    scrapedAt: new Date().toISOString(),
  };
}
