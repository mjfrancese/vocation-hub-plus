/**
 * Diagnostic: inspect search result rows for hidden IDs or link data.
 * Checks data attributes, event handlers, Telerik internal state, etc.
 *
 * Usage: tsx src/diagnose-row-ids.ts
 */

import { chromium } from 'playwright';

const BASE_URL = 'https://vocationhub.episcopalchurch.org/PositionSearch';

const INSPECT_SCRIPT = `(function() {
  var grid = document.querySelector('.k-grid');
  if (!grid) return { error: 'No grid found' };

  var results = {};

  // 1. Check grid element attributes
  results.gridAttributes = {};
  for (var a = 0; a < grid.attributes.length; a++) {
    results.gridAttributes[grid.attributes[a].name] = grid.attributes[a].value;
  }

  // 2. Check first few row elements for any data attributes
  var rows = grid.querySelectorAll('tbody tr');
  results.rowCount = rows.length;
  results.rows = [];

  for (var r = 0; r < Math.min(rows.length, 5); r++) {
    var row = rows[r];
    var rowInfo = {
      tagName: row.tagName,
      attributes: {},
      outerHTMLPreview: row.outerHTML.substring(0, 500),
      cells: []
    };

    // All attributes on the tr
    for (var i = 0; i < row.attributes.length; i++) {
      rowInfo.attributes[row.attributes[i].name] = row.attributes[i].value;
    }

    // Check each cell for links, data attributes
    var cells = row.querySelectorAll('td');
    for (var c = 0; c < cells.length; c++) {
      var cell = cells[c];
      var cellInfo = {
        index: c,
        attributes: {},
        hasLink: false,
        linkHref: '',
        innerHTML: cell.innerHTML.substring(0, 200)
      };
      for (var j = 0; j < cell.attributes.length; j++) {
        cellInfo.attributes[cell.attributes[j].name] = cell.attributes[j].value;
      }
      var link = cell.querySelector('a');
      if (link) {
        cellInfo.hasLink = true;
        cellInfo.linkHref = link.href || link.getAttribute('href') || '';
      }
      rowInfo.cells.push(cellInfo);
    }

    results.rows.push(rowInfo);
  }

  // 3. Check for Blazor internal state
  results.blazorState = {};
  try {
    // Blazor stores component state in _blazorState or similar
    if (window._blazorState) results.blazorState.hasBlazorState = true;
    if (window.Blazor) results.blazorState.hasBlazor = true;
    if (window.DotNet) results.blazorState.hasDotNet = true;
  } catch(e) {}

  // 4. Check for Telerik/Kendo grid data
  results.kendoData = {};
  try {
    // Kendo stores data on elements with data('kendoGrid')
    var kGrid = grid.kendoGrid || grid.dataset;
    if (kGrid) results.kendoData.found = true;
  } catch(e) {}

  // 5. Look for any elements with data-id, data-uid, data-item-id patterns
  var allDataElements = grid.querySelectorAll('[data-id], [data-uid], [data-item-id], [data-key]');
  results.dataIdElements = allDataElements.length;
  results.dataIdSamples = [];
  for (var d = 0; d < Math.min(allDataElements.length, 5); d++) {
    var el = allDataElements[d];
    var attrs = {};
    for (var k = 0; k < el.attributes.length; k++) {
      if (el.attributes[k].name.startsWith('data-')) {
        attrs[el.attributes[k].name] = el.attributes[k].value;
      }
    }
    results.dataIdSamples.push({ tag: el.tagName, attrs: attrs });
  }

  // 6. Check for any onclick handlers or blazor event attributes
  var firstRow = rows[0];
  if (firstRow) {
    results.firstRowEventAttrs = {};
    var evtAttrs = ['onclick', 'onmousedown', 'blazor:onclick', 'b-'];
    for (var e = 0; e < firstRow.attributes.length; e++) {
      var attr = firstRow.attributes[e];
      results.firstRowEventAttrs[attr.name] = attr.value.substring(0, 200);
    }
  }

  // 7. Check for any hidden inputs or forms with position data
  var hiddenInputs = document.querySelectorAll('input[type="hidden"]');
  results.hiddenInputs = [];
  for (var h = 0; h < hiddenInputs.length; h++) {
    results.hiddenInputs.push({
      name: hiddenInputs[h].name || hiddenInputs[h].id || '',
      value: (hiddenInputs[h].value || '').substring(0, 100)
    });
  }

  // 8. Look for any script tags or JSON data embedded in the page
  var scripts = document.querySelectorAll('script[type="application/json"], script:not([src])');
  results.inlineScripts = scripts.length;
  results.scriptSamples = [];
  for (var s = 0; s < Math.min(scripts.length, 3); s++) {
    results.scriptSamples.push(scripts[s].textContent.substring(0, 200));
  }

  // 9. Check the name spans for any data attributes
  var nameSpans = grid.querySelectorAll('span.published, span.unpublished');
  results.nameSpanCount = nameSpans.length;
  if (nameSpans.length > 0) {
    var span = nameSpans[0];
    results.nameSpanAttrs = {};
    for (var ns = 0; ns < span.attributes.length; ns++) {
      results.nameSpanAttrs[span.attributes[ns].name] = span.attributes[ns].value;
    }
    results.nameSpanParentAttrs = {};
    var parent = span.parentElement;
    if (parent) {
      for (var np = 0; np < parent.attributes.length; np++) {
        results.nameSpanParentAttrs[parent.attributes[np].name] = parent.attributes[np].value;
      }
    }
  }

  return results;
})()`;

async function main() {
  console.log('=== Diagnosing search result row IDs ===\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  const page = await context.newPage();

  // Load and search
  console.log('Loading search page...');
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('button:has-text("Search"):not(:has-text("New"))', { timeout: 15000 });
  await page.waitForTimeout(3000);

  // Type space in community name and search
  const communityInput = page.locator('text=Community name >> xpath=following::input[1]');
  if (await communityInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await communityInput.fill(' ');
  } else {
    const fallback = page.locator('text=You can use standard search wildcards >> xpath=preceding::input[1]');
    await fallback.fill(' ');
  }

  await page.locator('button:has-text("Search"):not(:has-text("New"))').first().click();
  await page.waitForTimeout(5000);

  console.log('Search complete. Inspecting grid...\n');

  const results = await page.evaluate(INSPECT_SCRIPT);
  console.log(JSON.stringify(results, null, 2));

  await browser.close();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
