/**
 * Test deep scrape on a single known profile to verify extraction works.
 * Scrapes ID 10669 (Cople Parish, Virginia) and dumps all extracted data.
 *
 * Usage: tsx src/test-scrape-profile.ts
 */

import { chromium } from 'playwright';

const BASE_URL = 'https://vocationhub.episcopalchurch.org';
const TEST_ID = 10669;

const EXTRACT_SCRIPT = `(function() {
  var result = {};
  var body = document.body || document.documentElement;
  result.fullText = body.innerText || '';

  // Extract all input values with context
  var inputs = document.querySelectorAll('.k-input-inner, .k-input, input, textarea');
  var fields = [];
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    var val = (el.value || '').trim();
    if (!val || val === 'on') continue;

    // Get the tag and type
    var tag = el.tagName.toLowerCase();
    var type = el.getAttribute('type') || '';

    // Try to find label context by walking up the DOM
    var label = '';
    var container = el.closest('.k-form-field, .form-group, [class*="field"]');
    if (container) {
      var lbl = container.querySelector('label, .k-label, [class*="label"]');
      if (lbl) label = lbl.textContent.trim();
    }
    if (!label) {
      // Try previous sibling or parent's previous sibling
      var prev = el.previousElementSibling;
      while (prev && !label) {
        if (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV') {
          var t = prev.textContent.trim();
          if (t.length > 0 && t.length < 100) label = t;
        }
        prev = prev.previousElementSibling;
      }
    }

    fields.push({
      label: label,
      value: val.substring(0, 2000),
      tag: tag,
      type: type
    });
  }
  result.fields = fields;

  var tabs = document.querySelectorAll('[role="tab"], .k-tabstrip-item, .k-item');
  result.tabCount = tabs.length;

  return result;
})()`;

async function main() {
  console.log(`=== Testing profile scrape on ID ${TEST_ID} ===\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  const page = await context.newPage();

  // Load the profile
  console.log(`Loading ${BASE_URL}/PositionView/${TEST_ID}...`);
  await page.goto(`${BASE_URL}/PositionView/${TEST_ID}`, {
    waitUntil: 'load',
    timeout: 30_000,
  });

  // Wait for Blazor
  await page.waitForSelector('[role="tab"]', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(3000);

  console.log('Page loaded. Clicking through tabs...\n');

  // Click each tab and extract after each one
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
      if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(1500);
        console.log(`Clicked tab: ${tabName}`);
      } else {
        console.log(`Tab not visible: ${tabName}`);
      }
    } catch {
      console.log(`Tab error: ${tabName}`);
    }
  }

  // Now extract everything
  console.log('\nExtracting data...\n');
  const data = await page.evaluate(EXTRACT_SCRIPT) as any;

  console.log(`Tab count: ${data.tabCount}`);
  console.log(`Full text length: ${data.fullText.length}`);
  console.log(`Fields found: ${data.fields.length}\n`);

  console.log('=== EXTRACTED FIELDS ===');
  for (let i = 0; i < data.fields.length; i++) {
    const f = data.fields[i];
    const valPreview = f.value.length > 200 ? f.value.substring(0, 200) + '...' : f.value;
    console.log(`\n[${i}] Label: "${f.label}" (${f.tag}${f.type ? ' type=' + f.type : ''})`);
    console.log(`    Value: "${valPreview}"`);
  }

  console.log('\n\n=== FULL PAGE TEXT (first 3000 chars) ===');
  console.log(data.fullText.substring(0, 3000));

  await browser.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
