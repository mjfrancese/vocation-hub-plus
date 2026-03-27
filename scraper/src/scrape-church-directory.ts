/**
 * Test: Fetch full church data from Drupal JSON endpoint.
 * Dumps the complete JSON structure so we know what fields to extract.
 *
 * Usage: tsx src/scrape-church-directory.ts
 */

import { chromium } from 'playwright';

const LIST_URL = 'https://www.episcopalassetmap.org/list?page=0';

const EXTRACT_NIDS = `(function() {
  var rows = document.querySelectorAll('.views-row');
  var results = [];
  for (var i = 0; i < rows.length; i++) {
    var nameEl = rows[i].querySelector('.views-field-title-unmodified .field-content');
    var name = nameEl ? nameEl.textContent.trim() : '';
    var nid = '';
    if (nameEl) {
      var m = (nameEl.className || '').match(/nid--(\\d+)/);
      if (m) nid = m[1];
    }
    var street = '', city = '', state = '';
    var s = rows[i].querySelector('.views-field-address-line1-unmodified .field-content');
    if (s) street = s.textContent.trim().replace(/,\\s*$/, '');
    var c = rows[i].querySelector('.views-field-locality-unmodified .field-content');
    if (c) city = c.textContent.trim().replace(/,\\s*$/, '');
    var st = rows[i].querySelector('.views-field-administrative-area-unmodified .field-content');
    if (st) state = st.textContent.trim().replace(/,\\s*$/, '');
    results.push({ name: name, nid: nid, street: street, city: city, state: state });
  }
  return results;
})()`;

async function main() {
  console.log('=== Church Directory: JSON Endpoint Test ===\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newContext().then(ctx => ctx.newPage());

  // Get NIDs from page 0
  await page.goto(LIST_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const listings = await page.evaluate(EXTRACT_NIDS) as any[];

  console.log(`Got ${listings.length} NIDs from page 0`);
  for (const l of listings) {
    console.log(`  NID ${l.nid}: ${l.name} (${l.city}, ${l.state})`);
  }

  // Fetch full JSON for first 3 listings
  for (let i = 0; i < Math.min(3, listings.length); i++) {
    const nid = listings[i].nid;
    const url = `https://www.episcopalassetmap.org/node/${nid}?_format=json`;

    console.log(`\n=== Full JSON for NID ${nid} (${listings[i].name}) ===`);
    try {
      const resp = await page.request.get(url, { timeout: 10000 });
      const data = await resp.json();

      // List all top-level fields
      const keys = Object.keys(data);
      console.log(`Fields (${keys.length}): ${keys.join(', ')}`);
      console.log('');

      // Print each field's value (condensed)
      for (const key of keys) {
        const val = data[key];
        if (Array.isArray(val) && val.length > 0) {
          const first = val[0];
          if (first.value !== undefined) {
            const v = String(first.value).substring(0, 120);
            console.log(`  ${key}: "${v}"`);
          } else if (first.target_id !== undefined) {
            console.log(`  ${key}: target_id=${first.target_id}`);
          } else if (first.uri !== undefined) {
            console.log(`  ${key}: uri="${first.uri}", title="${first.title || ''}"`);
          } else {
            console.log(`  ${key}: ${JSON.stringify(first).substring(0, 120)}`);
          }
        } else if (Array.isArray(val) && val.length === 0) {
          // skip empty arrays
        } else {
          console.log(`  ${key}: ${JSON.stringify(val).substring(0, 120)}`);
        }
      }
    } catch (err) {
      console.log(`  Error: ${err}`);
    }
  }

  // Also test: can we fetch JSON without Playwright? (simple HTTP)
  console.log('\n=== Testing direct HTTP fetch (no browser needed) ===');
  try {
    const resp = await fetch(`https://www.episcopalassetmap.org/node/${listings[0].nid}?_format=json`);
    console.log(`Direct fetch status: ${resp.status}`);
    if (resp.ok) {
      const data = await resp.json();
      console.log(`Direct fetch works! Title: ${data.title?.[0]?.value}`);
    }
  } catch (err) {
    console.log(`Direct fetch failed: ${err}`);
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
