import { Page } from 'playwright';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';
import { sleep } from './navigate.js';

/**
 * Detailed position data extracted from the Position Profile page.
 * Each profile has 6 tabs of information.
 */
export interface PositionDetails {
  positionId: number;
  profileUrl: string;

  // Basic Information tab
  communityName: string;
  diocese: string;
  address: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;

  // Position Details tab
  positionTitle: string;
  positionType: string;
  fullPartTime: string;
  positionDescription: string;

  // Stipend, Housing, and Benefits tab
  minimumStipend: string;
  maximumStipend: string;
  housingType: string;
  housingDescription: string;
  benefits: string;

  // Ministry Context and Desired Skills tab
  communityDescription: string;
  worshipStyle: string;
  avgSundayAttendance: string;
  churchSchoolSize: string;
  desiredSkills: string;
  challenges: string;

  // Ministry Media and Links tab
  websiteUrl: string;
  socialMediaLinks: string;

  // Optional Narrative Reflections tab
  narrativeReflections: string;

  // Metadata
  scrapedAt: string;
  rawContent: string;
}

// Tab names as they appear on the profile page
const TAB_NAMES = [
  'Basic Information',
  'Position Details',
  'Stipend, Housing, and Benefits',
  'Ministry Context and Desired Skills',
  'Ministry Media and Links',
  'Optional Narrative Reflections',
];

/**
 * Extract all data from a position profile page.
 * The page should already be navigated to /PositionView/{id}.
 */
export async function extractPositionProfile(
  page: Page,
  positionId: number
): Promise<PositionDetails | null> {
  const profileUrl = page.url();
  logger.info('Extracting position profile', { positionId, url: profileUrl });

  // Check if this is a valid profile page
  const hasProfile = await page.locator('text=Position Profile').count().catch(() => 0);
  if (hasProfile === 0) {
    logger.warn('Not a valid profile page', { positionId });
    return null;
  }

  const allTabData: Record<string, string> = {};

  // Click through each tab and extract its content
  for (const tabName of TAB_NAMES) {
    try {
      const tabButton = page.locator(`text="${tabName}"`).first();
      if (await tabButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await tabButton.click();
        await sleep(1000);

        // Extract all visible text content from the active tab panel
        const tabContent = await page.evaluate(`(function() {
          // Find the active/visible tab panel content
          var panels = document.querySelectorAll('.k-tabstrip-content, .k-content, [role="tabpanel"]');
          for (var i = 0; i < panels.length; i++) {
            if (panels[i].offsetHeight > 0 && panels[i].offsetWidth > 0) {
              return panels[i].innerText || '';
            }
          }
          // Fallback: get content below the tabs
          var main = document.querySelector('main, .content, [class*="content"]');
          return main ? main.innerText : '';
        })()`);

        allTabData[tabName] = (tabContent as string) || '';
        logger.debug('Extracted tab', { tab: tabName, length: allTabData[tabName].length });
      }
    } catch (err) {
      logger.warn('Failed to extract tab', { tab: tabName, error: String(err) });
      allTabData[tabName] = '';
    }
  }

  // Capture full page content for raw storage
  const rawContent = await page.evaluate(`(function() {
    var main = document.querySelector('main') || document.body;
    return main.innerText || '';
  })()`) as string;

  // Parse structured fields from tab content
  const details = parseTabData(allTabData, positionId, profileUrl, rawContent);

  await takeScreenshot(page, `profile-${positionId}`);
  logger.info('Profile extraction complete', { positionId });

  return details;
}

/**
 * Parse structured fields from raw tab text content.
 * The tab content is plain text with labels and values.
 */
function parseTabData(
  tabs: Record<string, string>,
  positionId: number,
  profileUrl: string,
  rawContent: string
): PositionDetails {
  const basic = tabs['Basic Information'] || '';
  const details = tabs['Position Details'] || '';
  const stipend = tabs['Stipend, Housing, and Benefits'] || '';
  const ministry = tabs['Ministry Context and Desired Skills'] || '';
  const media = tabs['Ministry Media and Links'] || '';
  const narrative = tabs['Optional Narrative Reflections'] || '';

  return {
    positionId,
    profileUrl,

    // Basic Information
    communityName: extractField(basic, 'Community Name', 'Name'),
    diocese: extractField(basic, 'Diocese'),
    address: extractField(basic, 'Address', 'Street'),
    city: extractField(basic, 'City'),
    stateProvince: extractField(basic, 'State', 'Province'),
    postalCode: extractField(basic, 'Zip', 'Postal'),
    contactName: extractField(basic, 'Contact Name', 'Contact Person'),
    contactEmail: extractField(basic, 'Email'),
    contactPhone: extractField(basic, 'Phone'),

    // Position Details
    positionTitle: extractField(details, 'Position Title', 'Title'),
    positionType: extractField(details, 'Position Type', 'Type'),
    fullPartTime: extractField(details, 'Full', 'Part'),
    positionDescription: extractLongField(details, 'Description', 'Position Description'),

    // Stipend, Housing, and Benefits
    minimumStipend: extractField(stipend, 'Minimum', 'Min'),
    maximumStipend: extractField(stipend, 'Maximum', 'Max'),
    housingType: extractField(stipend, 'Housing Type', 'Housing'),
    housingDescription: extractLongField(stipend, 'Housing Description', 'Housing Detail'),
    benefits: extractLongField(stipend, 'Benefits', 'Benefit'),

    // Ministry Context
    communityDescription: extractLongField(ministry, 'Community', 'Congregation'),
    worshipStyle: extractField(ministry, 'Worship Style', 'Worship'),
    avgSundayAttendance: extractField(ministry, 'Attendance', 'Sunday'),
    churchSchoolSize: extractField(ministry, 'School', 'Church School'),
    desiredSkills: extractLongField(ministry, 'Skills', 'Desired'),
    challenges: extractLongField(ministry, 'Challenge', 'Opportunities'),

    // Media
    websiteUrl: extractField(media, 'Website', 'URL', 'http'),
    socialMediaLinks: extractLongField(media, 'Social', 'Media', 'Facebook', 'Instagram'),

    // Narrative
    narrativeReflections: narrative.trim(),

    scrapedAt: new Date().toISOString(),
    rawContent,
  };
}

/**
 * Extract a field value from tab text by searching for label keywords.
 * Looks for patterns like "Label: Value" or "Label\nValue".
 */
function extractField(text: string, ...keywords: string[]): string {
  if (!text) return '';

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const keyword of keywords) {
    const lower = keyword.toLowerCase();

    // Try "Label: Value" pattern
    for (const line of lines) {
      const lineLower = line.toLowerCase();
      if (lineLower.includes(lower)) {
        const colonIdx = line.indexOf(':');
        if (colonIdx >= 0) {
          return line.substring(colonIdx + 1).trim();
        }
        // Check next line as the value
        const lineIdx = lines.indexOf(line);
        if (lineIdx >= 0 && lineIdx + 1 < lines.length) {
          return lines[lineIdx + 1].trim();
        }
      }
    }
  }

  return '';
}

/**
 * Extract a long-form field (description, narrative) from tab text.
 * Returns everything after the keyword line until the next section header.
 */
function extractLongField(text: string, ...keywords: string[]): string {
  if (!text) return '';

  const lines = text.split('\n').map((l) => l.trim());

  for (const keyword of keywords) {
    const lower = keyword.toLowerCase();

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lower)) {
        // Collect lines after this one until empty line or next section
        const result: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (!lines[j]) continue;
          // Stop at what looks like a new section header (short, title-case line)
          if (lines[j].length < 40 && lines[j].match(/^[A-Z]/) && lines[j].endsWith(':')) {
            break;
          }
          result.push(lines[j]);
        }
        if (result.length > 0) {
          return result.join('\n');
        }
      }
    }
  }

  return '';
}

/**
 * Scrape position details for a list of position IDs.
 * Visits each /PositionView/{id} page and extracts all tabs.
 */
export async function scrapePositionDetails(
  page: Page,
  positionIds: number[],
  baseUrl: string
): Promise<PositionDetails[]> {
  const results: PositionDetails[] = [];

  for (let i = 0; i < positionIds.length; i++) {
    const id = positionIds[i];
    logger.info('Scraping position detail', { id, progress: `${i + 1}/${positionIds.length}` });

    try {
      await page.goto(`${baseUrl.replace('/PositionSearch', '')}/PositionView/${id}`, {
        waitUntil: 'load',
        timeout: 30_000,
      });
      await sleep(3000); // Wait for Blazor to render

      const details = await extractPositionProfile(page, id);
      if (details) {
        results.push(details);
      }
    } catch (err) {
      logger.warn('Failed to scrape position', { id, error: String(err) });
    }

    // Small delay between requests to be respectful
    await sleep(500);
  }

  logger.info('Position detail scraping complete', {
    total: positionIds.length,
    successful: results.length,
  });

  return results;
}

/**
 * Discover position IDs by clicking rows in the search results.
 * Returns an array of numeric IDs extracted from the profile URLs.
 */
export async function discoverPositionIds(page: Page): Promise<number[]> {
  const ids: number[] = [];

  // Use JavaScript to find all clickable rows and extract any data attributes
  // that might contain the position ID
  const rowData = await page.evaluate(`(function() {
    var grid = document.querySelector('.k-grid');
    if (!grid) return [];
    var rows = grid.querySelectorAll('tbody tr');
    var data = [];
    for (var i = 0; i < rows.length; i++) {
      // Check for data attributes
      var id = rows[i].getAttribute('data-id') ||
               rows[i].getAttribute('data-uid') ||
               rows[i].dataset.id || '';
      data.push({ index: i, dataId: id });
    }
    return data;
  })()`) as Array<{ index: number; dataId: string }>;

  logger.info('Found rows for ID discovery', { count: rowData.length });

  // Try clicking each row to discover its profile URL
  for (let i = 0; i < rowData.length; i++) {
    try {
      // Click the row
      const rows = page.locator('.k-grid tbody tr');
      await rows.nth(i).click();
      await sleep(2000);

      // Check if we navigated to a profile page
      const url = page.url();
      const match = url.match(/PositionView\/(\d+)/);
      if (match) {
        const id = parseInt(match[1], 10);
        ids.push(id);
        logger.info('Discovered position ID', { id, index: i });
      }

      // Navigate back
      await page.goBack({ waitUntil: 'load' });
      await sleep(2000);
    } catch (err) {
      logger.warn('Failed to discover ID for row', { index: i, error: String(err) });
    }
  }

  logger.info('ID discovery complete', { found: ids.length });
  return ids;
}
