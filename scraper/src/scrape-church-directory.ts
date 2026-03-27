/**
 * Deep dive into the Episcopal Asset Map list page structure.
 * Checks if church data is embedded in the HTML or loaded via AJAX.
 *
 * Usage: tsx src/scrape-church-directory.ts
 */

import { chromium } from 'playwright';

const LIST_URL = 'https://www.episcopalassetmap.org/list?page=0';

async function main() {
  console.log('=== Episcopal Asset Map Deep Dive ===\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  const page = await context.newPage();

  // Intercept network requests to find any JSON/API calls
  const apiCalls: Array<{ url: string; method: string; responseType: string }> = [];
  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('json') || url.includes('api') || url.includes('json') || url.includes('geojson')) {
      apiCalls.push({ url, method: response.request().method(), responseType: contentType });
    }
  });

  console.log('Loading list page...');
  await page.goto(LIST_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check for API calls
  console.log(`\n=== Network API Calls (${apiCalls.length} found) ===`);
  for (const call of apiCalls) {
    console.log(`  ${call.method} ${call.url.substring(0, 150)}`);
    console.log(`    Content-Type: ${call.responseType}`);
  }

  // Deep inspect the page HTML for embedded data
  const inspection = await page.evaluate(`(function() {
    var result = {};

    // 1. Check for JSON-LD or embedded data
    var jsonScripts = document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]');
    result.jsonScripts = [];
    for (var i = 0; i < jsonScripts.length; i++) {
      result.jsonScripts.push(jsonScripts[i].textContent.substring(0, 500));
    }

    // 2. Check Drupal settings (drupalSettings often has data)
    if (window.drupalSettings) {
      result.hasDrupalSettings = true;
      result.drupalSettingsKeys = Object.keys(window.drupalSettings);
      // Look for place/location data
      var ds = JSON.stringify(window.drupalSettings).substring(0, 2000);
      result.drupalSettingsPreview = ds;
    }

    // 3. Inspect the list items
    var listItems = document.querySelectorAll('.views-row, .view-content .views-row');
    result.viewsRowCount = listItems.length;

    if (listItems.length === 0) {
      // Try other selectors
      listItems = document.querySelectorAll('.view-content > div, .item-list li, .search-results .result');
      result.altListCount = listItems.length;
    }

    // 4. Inspect first list item deeply
    result.firstListItems = [];
    var items = document.querySelectorAll('.views-row');
    if (items.length === 0) {
      // Try the actual list structure from the screenshot
      items = document.querySelectorAll('.view-content > div');
    }

    for (var j = 0; j < Math.min(items.length, 3); j++) {
      var item = items[j];
      result.firstListItems.push({
        outerHTML: item.outerHTML.substring(0, 1000),
        text: item.textContent.trim().substring(0, 200),
        links: Array.from(item.querySelectorAll('a')).map(function(a) {
          return { text: a.textContent.trim(), href: a.href };
        }),
        classes: item.className,
        dataAttrs: Array.from(item.attributes).filter(function(a) {
          return a.name.startsWith('data-');
        }).map(function(a) {
          return { name: a.name, value: a.value.substring(0, 100) };
        })
      });
    }

    // 5. Check if clicking a listing loads data or just shows hidden content
    // Look for hidden panels or popups
    var panels = document.querySelectorAll('.popup, .sidebar, .detail-panel, [class*="popup"], [class*="sidebar"], [class*="detail"]');
    result.panelCount = panels.length;
    result.panelSamples = [];
    for (var p = 0; p < Math.min(panels.length, 3); p++) {
      result.panelSamples.push({
        classes: panels[p].className,
        visible: panels[p].offsetHeight > 0,
        html: panels[p].outerHTML.substring(0, 500)
      });
    }

    // 6. Look for any GeoJSON or map data
    if (window.L) result.hasLeaflet = true;
    if (window.google) result.hasGoogleMaps = true;

    // 7. Check the total count text
    result.totalText = '';
    var found = document.body.textContent.match(/Found (\\d+) places/);
    if (found) result.totalText = found[0];

    // 8. Get the pagination info
    var pager = document.querySelector('.pager, .pagination, [class*="pager"]');
    result.hasPager = !!pager;
    if (pager) result.pagerHTML = pager.outerHTML.substring(0, 500);

    // 9. Try to find the individual listing URLs
    var listingLinks = document.querySelectorAll('a[href*="/places/"], a[href*="/node/"]');
    result.listingLinkCount = listingLinks.length;
    result.listingLinkSamples = [];
    for (var ll = 0; ll < Math.min(listingLinks.length, 5); ll++) {
      result.listingLinkSamples.push({
        text: listingLinks[ll].textContent.trim(),
        href: listingLinks[ll].href
      });
    }

    return result;
  })()`);

  console.log('\n=== Page Inspection ===');
  const r = inspection as any;
  console.log(`JSON scripts: ${r.jsonScripts?.length || 0}`);
  if (r.jsonScripts?.length > 0) {
    console.log('JSON script samples:');
    for (const s of r.jsonScripts) console.log(`  ${s.substring(0, 300)}`);
  }
  console.log(`Has Drupal settings: ${r.hasDrupalSettings || false}`);
  if (r.drupalSettingsKeys) console.log(`Drupal settings keys: ${r.drupalSettingsKeys.join(', ')}`);
  if (r.drupalSettingsPreview) console.log(`Drupal settings preview: ${r.drupalSettingsPreview.substring(0, 500)}`);
  console.log(`Views rows: ${r.viewsRowCount}`);
  console.log(`Alt list items: ${r.altListCount || 'n/a'}`);
  console.log(`Panels: ${r.panelCount}`);
  console.log(`Total text: ${r.totalText}`);
  console.log(`Has pager: ${r.hasPager}`);
  console.log(`Listing links: ${r.listingLinkCount}`);
  console.log(`Has Leaflet: ${r.hasLeaflet || false}`);

  console.log('\n=== First List Items ===');
  for (const item of (r.firstListItems || [])) {
    console.log(`\nItem (class: ${item.classes}):`);
    console.log(`  Text: ${item.text}`);
    console.log(`  Links: ${JSON.stringify(item.links)}`);
    console.log(`  Data attrs: ${JSON.stringify(item.dataAttrs)}`);
    console.log(`  HTML: ${item.outerHTML.substring(0, 400)}`);
  }

  console.log('\n=== Listing Link Samples ===');
  for (const link of (r.listingLinkSamples || [])) {
    console.log(`  ${link.text}: ${link.href}`);
  }

  if (r.panelSamples?.length > 0) {
    console.log('\n=== Panel Samples ===');
    for (const panel of r.panelSamples) {
      console.log(`  Class: ${panel.classes}, Visible: ${panel.visible}`);
      console.log(`  HTML: ${panel.html}`);
    }
  }

  // Now try clicking the first listing to see what happens
  console.log('\n\n=== Clicking first listing ===');
  const firstLink = page.locator('.view-content a').first();
  if (await firstLink.isVisible().catch(() => false)) {
    // Capture any new network requests
    const newApiCalls: string[] = [];
    page.on('response', async (response) => {
      const url = response.url();
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('json') || url.includes('api') || url.includes('json') || url.includes('node')) {
        newApiCalls.push(url);
      }
    });

    await firstLink.click();
    await page.waitForTimeout(3000);

    console.log(`New API calls after click: ${newApiCalls.length}`);
    for (const url of newApiCalls) {
      console.log(`  ${url.substring(0, 200)}`);

      // Try to fetch the JSON content
      try {
        const response = await page.request.get(url);
        const text = await response.text();
        console.log(`  Response (first 500 chars): ${text.substring(0, 500)}`);
      } catch {}
    }

    // Check the detail panel
    const panelContent = await page.evaluate(`(function() {
      // Look for the popup/sidebar that appeared
      var popup = document.querySelector('.leaflet-popup-content, .popup-content, [class*="popup"], .sidebar-content');
      if (popup) return popup.textContent.trim().substring(0, 1000);

      // Check if any new visible element appeared
      var panels = document.querySelectorAll('[class*="detail"], [class*="sidebar"]');
      for (var i = 0; i < panels.length; i++) {
        if (panels[i].offsetHeight > 0 && panels[i].textContent.trim().length > 50) {
          return panels[i].textContent.trim().substring(0, 1000);
        }
      }
      return 'No panel found';
    })()`);

    console.log(`\nDetail panel content:\n${panelContent}`);
  }

  await page.screenshot({ path: 'screenshots/asset-map-list.png', fullPage: true });
  console.log('\nScreenshot saved');

  await browser.close();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
