import { Page } from 'playwright';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';
import { sleep } from './navigate.js';
import { SELECTORS } from './selectors.js';
import { upsertPositionDetails } from './db.js';

/**
 * Detailed position data extracted from the Position Profile page.
 */
export interface PositionDetails {
  positionId: number;
  profileUrl: string;
  communityName: string;
  diocese: string;
  address: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  positionTitle: string;
  positionType: string;
  fullPartTime: string;
  positionDescription: string;
  minimumStipend: string;
  maximumStipend: string;
  housingType: string;
  housingDescription: string;
  benefits: string;
  communityDescription: string;
  worshipStyle: string;
  avgSundayAttendance: string;
  churchSchoolSize: string;
  desiredSkills: string;
  challenges: string;
  websiteUrl: string;
  socialMediaLinks: string;
  narrativeReflections: string;
  scrapedAt: string;
  rawContent: string;
}

/**
 * Discover Vocation Hub position IDs by clicking rows in the search results.
 * Each row navigates to /PositionView/{id} when clicked.
 */
export async function discoverIdsFromSearchResults(
  page: Page,
  expectedCount: number
): Promise<number[]> {
  const ids: number[] = [];
  const maxAttempts = Math.min(expectedCount, 50); // cap at 50

  for (let rowIdx = 0; rowIdx < maxAttempts; rowIdx++) {
    try {
      // Count available rows
      const rows = page.locator('.k-grid tbody tr');
      const rowCount = await rows.count();

      if (rowIdx >= rowCount) {
        // Try to paginate
        logger.info('Reached end of visible rows, checking for next page', {
          discovered: ids.length,
        });
        // We already have pagination logic, but for ID discovery we just stop
        break;
      }

      // Click the row
      await rows.nth(rowIdx).click();
      await sleep(2000);

      // Check if we navigated to a profile page
      const url = page.url();
      const match = url.match(/PositionView\/(\d+)/);

      if (match) {
        const id = parseInt(match[1], 10);
        if (!ids.includes(id)) {
          ids.push(id);
          logger.info('Discovered position ID', { id, row: rowIdx, total: ids.length });
        }
      } else {
        logger.warn('Row click did not navigate to profile', { url, row: rowIdx });
      }

      // Go back to search results
      await page.goBack({ waitUntil: 'load' });
      await sleep(2000);

      // Verify we're back on the search page
      const backUrl = page.url();
      if (!backUrl.includes('PositionSearch')) {
        logger.warn('Did not return to search page, re-navigating');
        await page.goto(
          'https://vocationhub.episcopalchurch.org/PositionSearch',
          { waitUntil: 'load', timeout: 30_000 }
        );
        await sleep(3000);
        // Re-search to get results back
        const searchButton = page.locator(SELECTORS.searchButton).first();
        await searchButton.click();
        await sleep(3000);
        // Reset row index since we re-searched
        // But rows might be in same order, so continue
      }
    } catch (err) {
      logger.warn('Error during ID discovery', { row: rowIdx, error: String(err) });
      // Try to recover by navigating back to search
      try {
        await page.goto(
          'https://vocationhub.episcopalchurch.org/PositionSearch',
          { waitUntil: 'load', timeout: 30_000 }
        );
        await sleep(3000);
      } catch {
        break;
      }
    }
  }

  logger.info('ID discovery complete', { total: ids.length });
  return ids;
}

// JavaScript string for extracting all tab data from a profile page.
// Uses string to avoid tsx __name injection.
const EXTRACT_PROFILE_SCRIPT = `(function() {
  var result = {};

  // Get all text content from the page
  var body = document.body.innerText || '';
  result.rawContent = body;

  // Try to find labeled fields (pattern: "Label\\nValue" or "Label: Value")
  var allText = body;

  // Helper to find a value after a label
  function findField(label) {
    var patterns = [
      new RegExp(label + '\\\\s*:\\\\s*(.+)', 'i'),
      new RegExp(label + '\\\\s*\\n\\\\s*(.+)', 'i'),
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = allText.match(patterns[i]);
      if (m && m[1]) return m[1].trim();
    }
    return '';
  }

  // Try to extract structured fields
  // These may not all be present depending on the profile
  result.communityName = findField('Community Name|Name of Community');
  result.diocese = findField('Diocese');
  result.address = findField('Address|Street');
  result.city = findField('City');
  result.stateProvince = findField('State|Province');
  result.postalCode = findField('Zip|Postal Code');
  result.contactName = findField('Contact Name|Contact Person');
  result.contactEmail = findField('Contact Email|Email');
  result.contactPhone = findField('Contact Phone|Phone');
  result.positionTitle = findField('Position Title');
  result.positionType = findField('Position Type');
  result.fullPartTime = findField('Full.Time|Part.Time|Full/Part');
  result.minimumStipend = findField('Minimum Stipend|Min.*Stipend|Minimum Salary|Compensation Min');
  result.maximumStipend = findField('Maximum Stipend|Max.*Stipend|Maximum Salary|Compensation Max');
  result.housingType = findField('Housing Type|Housing');
  result.avgSundayAttendance = findField('Average Sunday|Sunday Attendance|ASA');
  result.worshipStyle = findField('Worship Style');
  result.websiteUrl = findField('Website|Web Site|URL');

  // Try to get longer text sections
  // Look for specific tab content sections
  var sections = document.querySelectorAll('[class*="content"], [class*="panel"], [class*="tab"]');
  var sectionTexts = [];
  for (var s = 0; s < sections.length; s++) {
    if (sections[s].offsetHeight > 0 && sections[s].innerText.length > 50) {
      sectionTexts.push(sections[s].innerText);
    }
  }
  result.sectionTexts = sectionTexts;

  return result;
})()`;

/**
 * Scrape position details by visiting each profile page directly.
 * Stores results in the database as they are scraped.
 */
export async function scrapePositionDetails(
  page: Page,
  positionIds: number[],
  baseUrl: string,
  timeBudgetMs: number
): Promise<number> {
  const startTime = Date.now();
  let scraped = 0;

  for (let i = 0; i < positionIds.length; i++) {
    // Check time budget
    const elapsed = Date.now() - startTime;
    if (elapsed > timeBudgetMs) {
      logger.warn('Time budget exceeded for detail scraping', {
        scraped,
        remaining: positionIds.length - i,
      });
      break;
    }

    const id = positionIds[i];
    logger.info('Scraping position detail', {
      id,
      progress: `${i + 1}/${positionIds.length}`,
    });

    try {
      const profileUrl = `${baseUrl}/PositionView/${id}`;
      await page.goto(profileUrl, { waitUntil: 'load', timeout: 30_000 });
      await sleep(3000); // Wait for Blazor

      // Check if this is a valid profile
      const title = await page.title();
      if (!title.includes('Position') && !title.includes('Vocation')) {
        logger.warn('Invalid profile page', { id, title });
        continue;
      }

      // Click through all tabs to load their content
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
          if (await tab.isVisible({ timeout: 1000 }).catch(() => false)) {
            await tab.click();
            await sleep(800);
          }
        } catch {
          // Tab might not exist for this profile
        }
      }

      // Now extract all content from the page
      const rawData = (await page.evaluate(EXTRACT_PROFILE_SCRIPT)) as Record<string, string>;

      const details: PositionDetails = {
        positionId: id,
        profileUrl,
        communityName: rawData.communityName || '',
        diocese: rawData.diocese || '',
        address: rawData.address || '',
        city: rawData.city || '',
        stateProvince: rawData.stateProvince || '',
        postalCode: rawData.postalCode || '',
        contactName: rawData.contactName || '',
        contactEmail: rawData.contactEmail || '',
        contactPhone: rawData.contactPhone || '',
        positionTitle: rawData.positionTitle || '',
        positionType: rawData.positionType || '',
        fullPartTime: rawData.fullPartTime || '',
        positionDescription: '', // populated from raw content
        minimumStipend: rawData.minimumStipend || '',
        maximumStipend: rawData.maximumStipend || '',
        housingType: rawData.housingType || '',
        housingDescription: '',
        benefits: '',
        communityDescription: '',
        worshipStyle: rawData.worshipStyle || '',
        avgSundayAttendance: rawData.avgSundayAttendance || '',
        churchSchoolSize: '',
        desiredSkills: '',
        challenges: '',
        websiteUrl: rawData.websiteUrl || '',
        socialMediaLinks: '',
        narrativeReflections: '',
        scrapedAt: new Date().toISOString(),
        rawContent: rawData.rawContent || '',
      };

      // Save to database
      upsertPositionDetails(details);
      scraped++;

      logger.info('Position detail saved', { id, name: details.communityName });
    } catch (err) {
      logger.warn('Failed to scrape position detail', { id, error: String(err) });
    }

    // Small delay between requests
    await sleep(500);
  }

  logger.info('Detail scraping complete', { scraped, total: positionIds.length });
  return scraped;
}
