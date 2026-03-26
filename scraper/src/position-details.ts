import { Page, BrowserContext } from 'playwright';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';
import { sleep } from './navigate.js';
import { upsertPositionDetails } from './db.js';

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
 * Discover position IDs by clicking rows in the search results.
 * Uses a listener on page navigation to capture the /PositionView/{id} URL
 * without needing to wait for the profile page to fully load.
 */
export async function discoverPositionIds(
  page: Page,
  totalPositions: number
): Promise<number[]> {
  const ids: number[] = [];

  // Process all visible pages of results
  let pageNum = 1;

  while (true) {
    const rows = page.locator('.k-grid tbody tr');
    const rowCount = await rows.count();
    logger.info('Discovering IDs from search results page', { page: pageNum, rows: rowCount });

    for (let i = 0; i < rowCount; i++) {
      try {
        // Click the row - Blazor will navigate to /PositionView/{id}
        const row = page.locator('.k-grid tbody tr').nth(i);
        await row.click();
        await sleep(1500);

        // Capture the URL
        const url = page.url();
        const match = url.match(/PositionView\/(\d+)/);

        if (match) {
          const id = parseInt(match[1], 10);
          if (!ids.includes(id)) {
            ids.push(id);
            logger.info('Discovered ID', { id, index: i, page: pageNum, total: ids.length });
          }
        }

        // Go back to search results
        await page.goBack({ waitUntil: 'load', timeout: 15_000 });
        await sleep(2000);

        // Verify we're back on the search page with results
        const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
        if (!pagerText || pagerText.includes('0 - 0 of 0')) {
          logger.warn('Search results lost after goBack, stopping ID discovery', {
            discovered: ids.length,
          });
          return ids;
        }
      } catch (err) {
        logger.warn('Error discovering ID for row', { index: i, error: String(err).substring(0, 100) });
        // Try to get back to search
        try {
          await page.goBack({ waitUntil: 'load', timeout: 10_000 }).catch(() => {});
          await sleep(2000);
        } catch {
          return ids;
        }
      }
    }

    // Try to go to next page of results
    const currentPageNum = await page.evaluate(`(function() {
      var selected = document.querySelector('.k-pager .k-selected');
      return selected ? parseInt(selected.textContent) : 0;
    })()`) as number;

    const nextPageNum = currentPageNum + 1;
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

    // Verify pagination worked
    const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
    if (!pagerText || pagerText.includes('0 - 0 of 0')) break;
  }

  logger.info('ID discovery complete', { total: ids.length });
  return ids;
}

/**
 * Scrape position details by visiting each profile URL in a separate page.
 * This avoids interfering with the search results page.
 */
export async function scrapePositionDetails(
  context: BrowserContext,
  positionIds: number[],
  baseUrl: string,
  timeBudgetMs: number
): Promise<number> {
  const startTime = Date.now();
  let scraped = 0;

  // Open a dedicated page for profile scraping
  const profilePage = await context.newPage();
  profilePage.setDefaultTimeout(15_000);

  try {
    for (let i = 0; i < positionIds.length; i++) {
      if (Date.now() - startTime > timeBudgetMs) {
        logger.warn('Time budget exceeded', { scraped, remaining: positionIds.length - i });
        break;
      }

      const id = positionIds[i];
      const profileUrl = `${baseUrl}/PositionView/${id}`;

      logger.info('Scraping profile', { id, progress: `${i + 1}/${positionIds.length}` });

      try {
        await profilePage.goto(profileUrl, { waitUntil: 'load', timeout: 20_000 });
        await sleep(3000); // Wait for Blazor

        // Check if valid profile
        const hasProfile = await profilePage.evaluate(`(function() {
          var text = document.body.innerText || '';
          return text.indexOf('Basic Information') >= 0 || text.indexOf('Position Profile') >= 0;
        })()`) as boolean;

        if (!hasProfile) {
          logger.warn('Not a valid profile page', { id });
          continue;
        }

        // Click through each tab to load content
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
            const tab = profilePage.locator(`text="${tabName}"`).first();
            if (await tab.isVisible({ timeout: 1000 }).catch(() => false)) {
              await tab.click();
              await sleep(1000);
            }
          } catch { /* tab may not exist */ }
        }

        // Take screenshot of first few profiles for debugging
        if (scraped < 3) {
          await takeScreenshot(profilePage, `profile-${id}`);
        }

        // Extract all page text
        const rawContent = await profilePage.evaluate(`(function() {
          return (document.body || document.documentElement).innerText || '';
        })()`) as string;

        // Parse and save
        const details = parseProfileText(rawContent, id, profileUrl);
        upsertPositionDetails(details);
        scraped++;

        logger.info('Profile saved', {
          id,
          name: details.communityName || '(unknown)',
          stipend: details.minimumStipend || 'not listed',
        });
      } catch (err) {
        logger.warn('Failed to scrape profile', { id, error: String(err).substring(0, 100) });
      }

      await sleep(500);
    }
  } finally {
    await profilePage.close();
  }

  logger.info('Detail scraping complete', { scraped, total: positionIds.length });
  return scraped;
}

/**
 * Parse structured fields from profile page text.
 * The profile page text has labeled fields like:
 *   Label
 *   Value
 * or
 *   Label: Value
 */
function parseProfileText(
  text: string,
  positionId: number,
  profileUrl: string
): PositionDetails {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Find value after a label line
  const after = (... labels: string[]): string => {
    for (const label of labels) {
      const lower = label.toLowerCase();
      for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].toLowerCase() === lower || lines[i].toLowerCase().startsWith(lower + ':')) {
          // If line has "Label: Value", return the value part
          const colonIdx = lines[i].indexOf(':');
          if (colonIdx >= 0) {
            const val = lines[i].substring(colonIdx + 1).trim();
            if (val) return val;
          }
          // Return the next line as the value
          if (i + 1 < lines.length) return lines[i + 1];
        }
      }
    }
    return '';
  };

  // Find a block of text after a label (for descriptions, etc.)
  const blockAfter = (... labels: string[]): string => {
    for (const label of labels) {
      const lower = label.toLowerCase();
      for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].toLowerCase() === lower || lines[i].toLowerCase().startsWith(lower)) {
          const result: string[] = [];
          for (let j = i + 1; j < lines.length && result.length < 30; j++) {
            const line = lines[j];
            // Stop at tab names or section headers
            if (['Basic Information', 'Position Details', 'Stipend, Housing, and Benefits',
                 'Ministry Context and Desired Skills', 'Ministry Media and Links',
                 'Optional Narrative Reflections'].includes(line)) break;
            result.push(line);
          }
          if (result.length > 0) return result.join('\n').trim();
        }
      }
    }
    return '';
  };

  return {
    positionId,
    profileUrl,
    communityName: after('Community Name', 'Name of Community', 'Congregation/Organization Name'),
    diocese: after('Diocese', 'Diocesan Affiliation'),
    address: after('Mailing Address', 'Street Address', 'Address'),
    city: after('City'),
    stateProvince: after('State', 'Province', 'State/Province'),
    postalCode: after('Zip Code', 'Postal Code', 'Zip'),
    contactName: after('Contact Name', 'Contact Person', 'Search Chair'),
    contactEmail: after('Contact Email', 'Email Address', 'Email'),
    contactPhone: after('Contact Phone', 'Phone Number', 'Phone'),
    positionTitle: after('Position Title', 'Title'),
    positionType: after('Position Type', 'Type of Position'),
    fullPartTime: after('Full-Time/Part-Time', 'Full Time/Part Time', 'Employment Type'),
    positionDescription: blockAfter('Position Description', 'Description of Position', 'About the Position'),
    minimumStipend: after('Minimum Stipend', 'Compensation Minimum', 'Salary Minimum', 'Minimum Compensation'),
    maximumStipend: after('Maximum Stipend', 'Compensation Maximum', 'Salary Maximum', 'Maximum Compensation'),
    housingType: after('Housing Type', 'Type of Housing', 'Housing'),
    housingDescription: blockAfter('Housing Description', 'Housing Details'),
    benefits: blockAfter('Benefits', 'Benefits Description'),
    communityDescription: blockAfter('Community Description', 'About the Community', 'About the Congregation'),
    worshipStyle: after('Worship Style', 'Style of Worship'),
    avgSundayAttendance: after('Average Sunday Attendance', 'ASA', 'Sunday Attendance'),
    churchSchoolSize: after('Church School', 'Sunday School'),
    desiredSkills: blockAfter('Desired Skills', 'Skills and Competencies', 'Qualities Sought'),
    challenges: blockAfter('Challenges', 'Opportunities and Challenges'),
    websiteUrl: after('Website', 'Web Site', 'Website URL'),
    socialMediaLinks: after('Social Media', 'Facebook', 'Instagram'),
    narrativeReflections: blockAfter('Narrative', 'Reflection'),
    scrapedAt: new Date().toISOString(),
    rawContent: text,
  };
}

// Backwards compat stub
export async function discoverIdsFromSearchResults(
  page: Page,
  expectedCount: number
): Promise<number[]> {
  return [];
}
