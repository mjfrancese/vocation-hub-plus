/**
 * Test scraper for the Episcopal Church "Find a Church" directory.
 * Explores the page structure to understand how to extract church data.
 *
 * Usage: tsx src/scrape-church-directory.ts [test|full]
 * test mode: scrape one diocese to verify extraction
 * full mode: scrape all dioceses
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const MODE = process.argv[2] || 'test';
const BASE_URL = 'https://www.episcopalchurch.org/find-a-church/browse-by-diocese/';

interface Church {
  name: string;
  address: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  website: string;
  diocese: string;
  sourceUrl: string;
}

// Script to extract page structure (what's on the browse-by-diocese page)
const EXPLORE_BROWSE_PAGE = `(function() {
  var result = {};
  result.title = document.title;
  result.url = window.location.href;

  // Find all links that look like diocese pages
  var links = document.querySelectorAll('a');
  var dioceseLinks = [];
  for (var i = 0; i < links.length; i++) {
    var href = links[i].href || '';
    var text = links[i].textContent.trim();
    if (href.includes('diocese') || href.includes('find-a-church') || text.match(/^(Diocese|Alabama|Alaska|Arizona)/i)) {
      dioceseLinks.push({ text: text, href: href });
    }
  }
  result.dioceseLinks = dioceseLinks;

  // Get all text content to understand page structure
  result.bodyText = document.body.innerText.substring(0, 5000);

  // Look for lists or tables
  var lists = document.querySelectorAll('ul, ol, table');
  result.listCount = lists.length;

  // Look for any structured data
  var articles = document.querySelectorAll('article, .entry, .listing, .church, .congregation');
  result.articleCount = articles.length;

  return result;
})()`;

// Script to extract church data from a diocese page
const EXTRACT_CHURCHES = `(function() {
  var result = {};
  result.title = document.title;
  result.url = window.location.href;
  result.bodyText = document.body.innerText.substring(0, 10000);

  // Look for church listings in various possible formats
  // The Find a Church directory might use cards, lists, or other layouts
  var churches = [];

  // Try various selectors for church entries
  var selectors = [
    '.church-listing', '.congregation', '.parish', '.entry-content',
    'article', '.wp-block-group', '.listing', '.result',
    '.church', '.location', 'li'
  ];

  // Also try to find address-like patterns in the page text
  var lines = document.body.innerText.split('\\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
  result.lineCount = lines.length;
  result.first100Lines = lines.slice(0, 100);

  // Look for links to individual church pages
  var allLinks = document.querySelectorAll('a');
  var churchLinks = [];
  for (var i = 0; i < allLinks.length; i++) {
    var href = allLinks[i].href || '';
    var text = allLinks[i].textContent.trim();
    if (text.length > 3 && text.length < 80 && !href.includes('episcopalchurch.org/find-a-church/browse')) {
      if (href.includes('church') || href.includes('parish') || href.includes('congregation') || href.includes('location')) {
        churchLinks.push({ text: text, href: href.substring(0, 200) });
      }
    }
  }
  result.churchLinks = churchLinks.slice(0, 20);

  // Look for any elements with address-like content
  var addressElements = document.querySelectorAll('address, [class*="address"], [class*="location"]');
  result.addressElementCount = addressElements.length;
  result.addressSamples = [];
  for (var a = 0; a < Math.min(addressElements.length, 5); a++) {
    result.addressSamples.push(addressElements[a].textContent.trim().substring(0, 200));
  }

  return result;
})()`;

async function main() {
  console.log(`=== Episcopal Church Directory Scraper (${MODE} mode) ===\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  const page = await context.newPage();

  try {
    // Step 1: Explore the browse-by-diocese page
    console.log('Loading browse-by-diocese page...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const browseData = await page.evaluate(EXPLORE_BROWSE_PAGE);
    console.log(`Page title: ${(browseData as any).title}`);
    console.log(`Diocese links found: ${(browseData as any).dioceseLinks?.length || 0}`);

    if ((browseData as any).dioceseLinks?.length > 0) {
      console.log('\nFirst 10 diocese links:');
      for (const link of (browseData as any).dioceseLinks.slice(0, 10)) {
        console.log(`  ${link.text}: ${link.href}`);
      }
    }

    console.log('\nPage text (first 2000 chars):');
    console.log((browseData as any).bodyText?.substring(0, 2000));

    // Step 2: Try clicking into a specific diocese
    console.log('\n\n=== Exploring a specific diocese page ===');

    // Try the Asset Map instead if the main site doesn't work well
    console.log('\nTrying Episcopal Asset Map...');
    await page.goto('https://www.episcopalassetmap.org/dioceses', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const assetMapData = await page.evaluate(EXTRACT_CHURCHES);
    console.log(`Asset Map title: ${(assetMapData as any).title}`);
    console.log(`Lines: ${(assetMapData as any).lineCount}`);
    console.log(`Church links: ${(assetMapData as any).churchLinks?.length || 0}`);
    console.log(`Address elements: ${(assetMapData as any).addressElementCount}`);

    if ((assetMapData as any).churchLinks?.length > 0) {
      console.log('\nChurch links:');
      for (const link of (assetMapData as any).churchLinks) {
        console.log(`  ${link.text}: ${link.href}`);
      }
    }

    console.log('\nFirst 50 lines:');
    for (const line of ((assetMapData as any).first100Lines || []).slice(0, 50)) {
      console.log(`  ${line}`);
    }

    // Step 3: Try the Find a Church search directly
    console.log('\n\n=== Trying Find a Church search ===');
    await page.goto('https://www.episcopalchurch.org/find-a-church/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const searchData = await page.evaluate(EXTRACT_CHURCHES);
    console.log(`Find a Church title: ${(searchData as any).title}`);
    console.log(`Lines: ${(searchData as any).lineCount}`);
    console.log(`Church links: ${(searchData as any).churchLinks?.length || 0}`);

    console.log('\nFirst 50 lines:');
    for (const line of ((searchData as any).first100Lines || []).slice(0, 50)) {
      console.log(`  ${line}`);
    }

    // Take screenshots
    await page.screenshot({ path: 'screenshots/find-a-church.png', fullPage: true });
    console.log('\nScreenshot saved to screenshots/find-a-church.png');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
