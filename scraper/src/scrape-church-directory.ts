/**
 * Test scraper for Episcopal Asset Map church directory.
 * Phase 1: Extract list data from HTML + try Drupal JSON endpoint.
 *
 * Usage: tsx src/scrape-church-directory.ts
 */

import { chromium } from 'playwright';

const LIST_URL = 'https://www.episcopalassetmap.org/list?page=0';

// Extract all listings from a list page using the clean Drupal Views HTML
const EXTRACT_LIST = `(function() {
  var rows = document.querySelectorAll('.views-row');
  var results = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];

    // Name + Drupal Node ID from the class
    var nameEl = row.querySelector('.views-field-title-unmodified .field-content');
    var name = nameEl ? nameEl.textContent.trim() : '';
    var nid = '';
    if (nameEl) {
      var classes = nameEl.className || '';
      var nidMatch = classes.match(/nid--(\\d+)/);
      if (nidMatch) nid = nidMatch[1];
    }

    // Address fields
    var street = '';
    var city = '';
    var state = '';
    var zip = '';
    var country = '';

    var streetEl = row.querySelector('.views-field-address-line1-unmodified .field-content');
    if (streetEl) street = streetEl.textContent.trim().replace(/,\\s*$/, '');

    var cityEl = row.querySelector('.views-field-locality-unmodified .field-content');
    if (cityEl) city = cityEl.textContent.trim().replace(/,\\s*$/, '');

    var stateEl = row.querySelector('.views-field-administrative-area-unmodified .field-content');
    if (stateEl) state = stateEl.textContent.trim().replace(/,\\s*$/, '');

    var zipEl = row.querySelector('.views-field-postal-code-unmodified .field-content');
    if (zipEl) zip = zipEl.textContent.trim().replace(/,\\s*$/, '');

    var countryEl = row.querySelector('.views-field-country-code-unmodified .field-content');
    if (countryEl) country = countryEl.textContent.trim();

    // Get ALL field class names to find ones we might have missed
    var allFields = row.querySelectorAll('.views-field');
    var fieldClasses = [];
    for (var f = 0; f < allFields.length; f++) {
      fieldClasses.push(allFields[f].className);
    }

    results.push({
      name: name,
      nid: nid,
      street: street,
      city: city,
      state: state,
      zip: zip,
      country: country,
      fieldClasses: fieldClasses,
      fullText: row.textContent.trim()
    });
  }

  return results;
})()`;

async function main() {
  console.log('=== Episcopal Asset Map Test Scrape ===\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  const page = await context.newPage();

  // Step 1: Extract list data from page 0
  console.log('Loading list page 0...');
  await page.goto(LIST_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const listings = await page.evaluate(EXTRACT_LIST) as any[];
  console.log(`\nExtracted ${listings.length} listings from page 0:\n`);

  for (const listing of listings) {
    console.log(`  Name: ${listing.name}`);
    console.log(`  NID: ${listing.nid}`);
    console.log(`  Street: ${listing.street}`);
    console.log(`  City: ${listing.city}`);
    console.log(`  State: ${listing.state}`);
    console.log(`  Zip: ${listing.zip}`);
    console.log(`  Country: ${listing.country}`);
    console.log(`  Full text: ${listing.fullText}`);
    console.log(`  Field classes: ${listing.fieldClasses.join(' | ')}`);
    console.log('');
  }

  // Step 2: Try Drupal JSON endpoints for the first listing
  if (listings.length > 0 && listings[0].nid) {
    const nid = listings[0].nid;
    console.log(`\n=== Testing Drupal JSON endpoints for NID ${nid} ===\n`);

    const endpoints = [
      `/node/${nid}?_format=json`,
      `/jsonapi/node/place/${nid}`,
      `/api/v1/places/${nid}`,
      `/node/${nid}?_format=hal_json`,
      `/rest/node/${nid}`,
    ];

    for (const endpoint of endpoints) {
      const url = `https://www.episcopalassetmap.org${endpoint}`;
      try {
        const response = await page.request.get(url, { timeout: 5000 });
        const status = response.status();
        const contentType = response.headers()['content-type'] || '';
        console.log(`  ${endpoint}`);
        console.log(`    Status: ${status}, Content-Type: ${contentType}`);
        if (status === 200 && contentType.includes('json')) {
          const body = await response.text();
          console.log(`    SUCCESS! Response (first 1000 chars):`);
          console.log(`    ${body.substring(0, 1000)}`);
        }
      } catch (err) {
        console.log(`  ${endpoint} -> Error: ${String(err).substring(0, 80)}`);
      }
    }
  }

  // Step 3: Click the first listing to see the detail panel
  console.log('\n=== Clicking first listing for detail panel ===\n');

  // Capture AJAX requests when clicking
  const ajaxUrls: string[] = [];
  page.on('response', async (response) => {
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('json') || ct.includes('html')) {
      const url = response.url();
      if (!url.includes('google') && !url.includes('fonts') && !url.includes('translate')) {
        ajaxUrls.push(url);
      }
    }
  });

  const firstName = page.locator('.search-info--place').first();
  if (await firstName.isVisible()) {
    await firstName.click();
    await page.waitForTimeout(3000);

    console.log(`AJAX calls after click: ${ajaxUrls.length}`);
    for (const url of ajaxUrls) {
      console.log(`  ${url.substring(0, 200)}`);
      // Try to get the response body for JSON calls
      try {
        const resp = await page.request.get(url, { timeout: 5000 });
        const ct = resp.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const body = await resp.text();
          console.log(`  JSON Response (first 500): ${body.substring(0, 500)}`);
        }
      } catch {}
    }

    // Extract detail panel content
    const panelData = await page.evaluate(`(function() {
      // The detail panel that opened on the right
      var result = {};

      // Try various selectors for the panel
      var panels = document.querySelectorAll('.search-result-popup, .popup, [class*="popup"], [class*="sidebar"], [class*="detail"], [class*="result"]');
      result.panelCount = panels.length;

      // Get the largest visible panel
      var bestPanel = null;
      var bestSize = 0;
      for (var i = 0; i < panels.length; i++) {
        if (panels[i].offsetHeight > bestSize) {
          bestSize = panels[i].offsetHeight;
          bestPanel = panels[i];
        }
      }

      if (bestPanel) {
        result.panelHTML = bestPanel.outerHTML.substring(0, 3000);
        result.panelText = bestPanel.textContent.trim().substring(0, 1000);

        // Extract specific fields
        var links = bestPanel.querySelectorAll('a');
        result.links = [];
        for (var l = 0; l < links.length; l++) {
          result.links.push({ text: links[l].textContent.trim(), href: links[l].href });
        }

        // Look for phone numbers
        var phoneMatch = bestPanel.textContent.match(/\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}/);
        result.phone = phoneMatch ? phoneMatch[0] : '';
      }

      return result;
    })()`);

    console.log('\nDetail panel:');
    console.log(`  Panels found: ${(panelData as any).panelCount}`);
    console.log(`  Text: ${(panelData as any).panelText}`);
    console.log(`  Links: ${JSON.stringify((panelData as any).links)}`);
    console.log(`  Phone: ${(panelData as any).phone}`);
    console.log(`  HTML (first 1500): ${(panelData as any).panelHTML?.substring(0, 1500)}`);
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
