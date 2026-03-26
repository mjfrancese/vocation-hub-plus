/**
 * Diagnostic script to find the best profile detection strategy.
 * Tests multiple approaches against a known valid and known invalid profile.
 *
 * Usage: tsx src/diagnose-detection.ts
 */

import { chromium } from 'playwright';

const VALID_ID = 10669;
const INVALID_ID = 0;
const BASE_URL = 'https://vocationhub.episcopalchurch.org';

// Each test returns a value for both pages so we can compare
const TESTS = `(function() {
  var results = {};
  var body = document.body || document.documentElement;
  var text = body.innerText || '';
  var html = body.innerHTML || '';

  // Test 1: Page text length
  results.textLength = text.length;

  // Test 2: Line count
  results.lineCount = text.split('\\n').filter(function(l) { return l.trim().length > 0; }).length;

  // Test 3: Input elements with non-empty values
  var inputs = document.querySelectorAll('input');
  var filledInputs = 0;
  var inputValues = [];
  for (var i = 0; i < inputs.length; i++) {
    var v = (inputs[i].value || '').trim();
    if (v.length > 0) {
      filledInputs++;
      inputValues.push(v);
    }
  }
  results.filledInputCount = filledInputs;
  results.inputValues = inputValues.slice(0, 20);

  // Test 4: Textarea elements with content
  var textareas = document.querySelectorAll('textarea');
  var filledTextareas = 0;
  for (var t = 0; t < textareas.length; t++) {
    if ((textareas[t].value || '').trim().length > 0) filledTextareas++;
  }
  results.filledTextareaCount = filledTextareas;

  // Test 5: What comes after "Diocese" in the text
  var lines = text.split('\\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
  results.dioceseNextLine = '';
  results.dioceseNextLines = [];
  for (var d = 0; d < lines.length; d++) {
    if (lines[d] === 'Diocese') {
      results.dioceseNextLine = lines[d+1] || '(empty)';
      results.dioceseNextLines = lines.slice(d, d+5);
      break;
    }
  }

  // Test 6: What comes after "Type" in the text
  results.typeNextLine = '';
  for (var tt = 0; tt < lines.length; tt++) {
    if (lines[tt] === 'Type') {
      results.typeNextLine = lines[tt+1] || '(empty)';
      break;
    }
  }

  // Test 7: What comes after "Congregation" or "Name" label
  results.nameNextLine = '';
  for (var n = 0; n < lines.length; n++) {
    if (lines[n] === 'Congregation' || lines[n] === 'Name') {
      results.nameNextLine = lines[n+1] || '(empty)';
      break;
    }
  }

  // Test 8: Check for specific CSS classes that might differ
  results.hasPublished = html.indexOf('published') >= 0;
  results.hasUnpublished = html.indexOf('unpublished') >= 0;

  // Test 9: Count elements with actual data content
  var spans = document.querySelectorAll('span, div, p');
  var dataSpans = 0;
  for (var s = 0; s < spans.length; s++) {
    var st = (spans[s].textContent || '').trim();
    if (st.length > 2 && st.length < 100) dataSpans++;
  }
  results.dataSpanCount = dataSpans;

  // Test 10: Check select/dropdown values
  var selects = document.querySelectorAll('select');
  var selectValues = [];
  for (var sel = 0; sel < selects.length; sel++) {
    selectValues.push(selects[sel].value || '');
  }
  results.selectValues = selectValues;

  // Test 11: Check for .k-input elements with values
  var kInputs = document.querySelectorAll('.k-input-inner, .k-input');
  var kValues = [];
  for (var k = 0; k < kInputs.length; k++) {
    var kv = (kInputs[k].value || kInputs[k].textContent || '').trim();
    if (kv) kValues.push(kv);
  }
  results.kInputValues = kValues;

  // Test 12: Page title
  results.pageTitle = document.title;

  // Test 13: URL
  results.url = window.location.href;

  // Test 14: Check tab count (valid might have 6, invalid might have 5)
  var tabButtons = document.querySelectorAll('[role="tab"], .k-tabstrip-item, .k-item');
  results.tabCount = tabButtons.length;
  var tabTexts = [];
  for (var tb = 0; tb < tabButtons.length; tb++) {
    tabTexts.push((tabButtons[tb].textContent || '').trim());
  }
  results.tabTexts = tabTexts;

  // Test 15: First 50 non-empty lines of page text
  results.first50Lines = lines.slice(0, 50);

  return results;
})()`;

async function main() {
  console.log('=== Profile Detection Diagnostic ===\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  const page = await context.newPage();

  // Test VALID profile
  console.log(`Loading VALID profile (ID ${VALID_ID})...`);
  await page.goto(`${BASE_URL}/PositionView/${VALID_ID}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3000);
  const validResults = await page.evaluate(TESTS);

  // Test INVALID profile
  console.log(`Loading INVALID profile (ID ${INVALID_ID})...`);
  await page.goto(`${BASE_URL}/PositionView/${INVALID_ID}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3000);
  const invalidResults = await page.evaluate(TESTS);

  await browser.close();

  // Compare results
  console.log('\n========================================');
  console.log('COMPARISON: VALID (10669) vs INVALID (0)');
  console.log('========================================\n');

  const v = validResults as any;
  const inv = invalidResults as any;

  console.log(`Test 1  - Text length:          VALID=${v.textLength}    INVALID=${inv.textLength}`);
  console.log(`Test 2  - Line count:           VALID=${v.lineCount}      INVALID=${inv.lineCount}`);
  console.log(`Test 3  - Filled inputs:        VALID=${v.filledInputCount}      INVALID=${inv.filledInputCount}`);
  console.log(`Test 4  - Filled textareas:     VALID=${v.filledTextareaCount}      INVALID=${inv.filledTextareaCount}`);
  console.log(`Test 5  - After "Diocese":      VALID="${v.dioceseNextLine}"  INVALID="${inv.dioceseNextLine}"`);
  console.log(`Test 6  - After "Type":         VALID="${v.typeNextLine}"  INVALID="${inv.typeNextLine}"`);
  console.log(`Test 7  - After "Name/Congregation": VALID="${v.nameNextLine}"  INVALID="${inv.nameNextLine}"`);
  console.log(`Test 8  - Has 'published':      VALID=${v.hasPublished}   INVALID=${inv.hasPublished}`);
  console.log(`Test 8b - Has 'unpublished':    VALID=${v.hasUnpublished}   INVALID=${inv.hasUnpublished}`);
  console.log(`Test 9  - Data span count:      VALID=${v.dataSpanCount}     INVALID=${inv.dataSpanCount}`);
  console.log(`Test 10 - Select values:        VALID=${JSON.stringify(v.selectValues)}  INVALID=${JSON.stringify(inv.selectValues)}`);
  console.log(`Test 11 - Kendo input values:   VALID=${JSON.stringify(v.kInputValues)}  INVALID=${JSON.stringify(inv.kInputValues)}`);
  console.log(`Test 12 - Page title:           VALID="${v.pageTitle}"  INVALID="${inv.pageTitle}"`);
  console.log(`Test 13 - Tab count:            VALID=${v.tabCount}      INVALID=${inv.tabCount}`);
  console.log(`Test 14 - Tab texts:            VALID=${JSON.stringify(v.tabTexts)}`);
  console.log(`                                INVALID=${JSON.stringify(inv.tabTexts)}`);

  console.log(`\nTest 3 - All input values:`);
  console.log(`  VALID:   ${JSON.stringify(v.inputValues)}`);
  console.log(`  INVALID: ${JSON.stringify(inv.inputValues)}`);

  console.log(`\nTest 5 - Lines around "Diocese":`);
  console.log(`  VALID:   ${JSON.stringify(v.dioceseNextLines)}`);
  console.log(`  INVALID: ${JSON.stringify(inv.dioceseNextLines)}`);

  console.log(`\nFirst 50 lines VALID:`);
  v.first50Lines.forEach((l: string, i: number) => console.log(`  ${i}: ${l}`));

  console.log(`\nFirst 50 lines INVALID:`);
  inv.first50Lines.forEach((l: string, i: number) => console.log(`  ${i}: ${l}`));
}

main().catch((err) => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
