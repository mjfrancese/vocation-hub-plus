import { Page } from 'playwright';
import { logger } from './logger.js';
import { takeScreenshot } from './browser.js';
import { sleep } from './navigate.js';
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

// Plain JS string for extracting profile page content (avoids tsx __name issue)
const EXTRACT_PROFILE_SCRIPT = `(function() {
  var result = { tabs: {} };

  // Get full page text
  var body = document.body || document.documentElement;
  result.fullText = body.innerText || '';
  result.fullHtml = body.innerHTML || '';

  // Check if this is a valid profile page
  var h1 = document.querySelector('h1, h2');
  result.pageTitle = h1 ? h1.textContent.trim() : '';
  result.isProfile = result.fullText.indexOf('Basic Information') >= 0 ||
                     result.fullText.indexOf('Position Profile') >= 0;

  // Try to get content from visible panels/sections
  var panels = document.querySelectorAll('.k-content, [role="tabpanel"], .tab-content, .card-body');
  result.panelCount = panels.length;
  var visiblePanels = [];
  for (var i = 0; i < panels.length; i++) {
    if (panels[i].offsetHeight > 0) {
      visiblePanels.push(panels[i].innerText || '');
    }
  }
  result.visiblePanelTexts = visiblePanels;

  return result;
})()`;

/**
 * Scan a range of position IDs by directly visiting /PositionView/{id}.
 * This avoids the fragile row-clicking approach entirely.
 *
 * Strategy:
 * - Scan from a starting ID upward
 * - Valid profiles contain "Basic Information" or "Position Profile" text
 * - Stop after hitting several consecutive 404s/empty pages
 * - Store the max known ID for future runs
 */
export async function scanAndScrapeProfiles(
  page: Page,
  baseUrl: string,
  startId: number,
  timeBudgetMs: number
): Promise<{ scraped: number; maxId: number; ids: number[] }> {
  const startTime = Date.now();
  let scraped = 0;
  let maxId = startId;
  let consecutiveMisses = 0;
  const maxConsecutiveMisses = 20; // Stop after 20 misses in a row
  const foundIds: number[] = [];
  let currentId = startId;

  logger.info('Starting profile ID scan', { startId, timeBudgetMs });

  while (consecutiveMisses < maxConsecutiveMisses) {
    // Check time budget
    if (Date.now() - startTime > timeBudgetMs) {
      logger.warn('Time budget exceeded for profile scanning', { scraped, currentId });
      break;
    }

    const profileUrl = `${baseUrl}/PositionView/${currentId}`;

    try {
      const response = await page.goto(profileUrl, {
        waitUntil: 'load',
        timeout: 15_000,
      });

      // Quick check: if the page redirected or is clearly not a profile, skip
      const finalUrl = page.url();
      if (!finalUrl.includes('PositionView')) {
        consecutiveMisses++;
        currentId++;
        continue;
      }

      // Wait for Blazor to render
      await sleep(2000);

      // Check if this is a valid profile page
      const pageData = await page.evaluate(EXTRACT_PROFILE_SCRIPT) as {
        isProfile: boolean;
        pageTitle: string;
        fullText: string;
        panelCount: number;
        visiblePanelTexts: string[];
      };

      if (!pageData.isProfile) {
        consecutiveMisses++;
        currentId++;
        continue;
      }

      // Valid profile found!
      consecutiveMisses = 0;
      foundIds.push(currentId);
      maxId = Math.max(maxId, currentId);

      logger.info('Found valid profile', {
        id: currentId,
        title: pageData.pageTitle,
        panels: pageData.panelCount,
      });

      // Now click through all 6 tabs to load their content
      const tabNames = [
        'Basic Information',
        'Position Details',
        'Stipend, Housing, and Benefits',
        'Ministry Context and Desired Skills',
        'Ministry Media and Links',
        'Optional Narrative Reflections',
      ];

      for (var t = 0; t < tabNames.length; t++) {
        try {
          var tabLocator = page.locator('text="' + tabNames[t] + '"').first();
          if (await tabLocator.isVisible({ timeout: 1000 }).catch(() => false)) {
            await tabLocator.click();
            await sleep(800);
          }
        } catch {
          // Tab might not exist
        }
      }

      // Extract all content after clicking all tabs
      const allContent = await page.evaluate(`(function() {
        return (document.body || document.documentElement).innerText || '';
      })()`) as string;

      // Parse fields from the full text
      const details = parseProfileText(allContent, currentId, profileUrl);

      // Save to database
      upsertPositionDetails(details);
      scraped++;

      if (scraped <= 3 || scraped % 10 === 0) {
        await takeScreenshot(page, 'profile-' + currentId);
      }

      logger.info('Profile scraped', {
        id: currentId,
        name: details.communityName,
        diocese: details.diocese,
        stipend: details.minimumStipend || 'not listed',
        progress: scraped + ' scraped, ' + foundIds.length + ' found',
      });

    } catch (err) {
      consecutiveMisses++;
      logger.debug('Profile not found or error', {
        id: currentId,
        error: String(err).substring(0, 100),
      });
    }

    currentId++;
    await sleep(300); // Be respectful between requests
  }

  logger.info('Profile scan complete', {
    scanned: currentId - startId,
    found: foundIds.length,
    scraped,
    maxId,
    consecutiveMisses,
  });

  return { scraped, maxId, ids: foundIds };
}

/**
 * Parse structured fields from the full text content of a profile page.
 * Uses line-by-line pattern matching to find label: value pairs.
 */
function parseProfileText(
  text: string,
  positionId: number,
  profileUrl: string
): PositionDetails {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Helper: find the line after a label line
  const after = (label: string): string => {
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].toLowerCase().includes(label.toLowerCase())) {
        // If same line has a colon, take text after colon
        const colonIdx = lines[i].indexOf(':');
        if (colonIdx >= 0) {
          const val = lines[i].substring(colonIdx + 1).trim();
          if (val) return val;
        }
        // Otherwise return next non-empty line
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          if (lines[j] && !lines[j].endsWith(':')) return lines[j];
        }
      }
    }
    return '';
  };

  // Helper: find a longer block of text after a label
  const blockAfter = (label: string): string => {
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].toLowerCase().includes(label.toLowerCase())) {
        const result: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          // Stop at what looks like a new section label
          if (lines[j].length < 50 && (lines[j].endsWith(':') || lines[j].endsWith('?'))) break;
          if (lines[j].length < 30 && lines[j] === lines[j].toUpperCase()) break;
          result.push(lines[j]);
          if (result.length > 20) break; // Safety limit
        }
        return result.join('\n').trim();
      }
    }
    return '';
  };

  return {
    positionId,
    profileUrl,
    communityName: after('Community Name') || after('Name of Community') || after('Congregation'),
    diocese: after('Diocese'),
    address: after('Mailing Address') || after('Street Address') || after('Address'),
    city: after('City'),
    stateProvince: after('State') || after('Province'),
    postalCode: after('Zip') || after('Postal Code'),
    contactName: after('Contact Name') || after('Contact Person'),
    contactEmail: after('Contact Email') || after('Email Address'),
    contactPhone: after('Contact Phone') || after('Phone'),
    positionTitle: after('Position Title'),
    positionType: after('Position Type'),
    fullPartTime: after('Full Time') || after('Part Time') || after('Full/Part'),
    positionDescription: blockAfter('Position Description') || blockAfter('Description of Position'),
    minimumStipend: after('Minimum Stipend') || after('Compensation Minimum') || after('Salary Minimum'),
    maximumStipend: after('Maximum Stipend') || after('Compensation Maximum') || after('Salary Maximum'),
    housingType: after('Housing Type') || after('Type of Housing'),
    housingDescription: blockAfter('Housing Description') || blockAfter('Housing Detail'),
    benefits: blockAfter('Benefits'),
    communityDescription: blockAfter('Community Description') || blockAfter('About the Community'),
    worshipStyle: after('Worship Style') || after('Style of Worship'),
    avgSundayAttendance: after('Average Sunday Attendance') || after('ASA') || after('Sunday Attendance'),
    churchSchoolSize: after('Church School') || after('Sunday School'),
    desiredSkills: blockAfter('Desired Skills') || blockAfter('Skills and Competencies'),
    challenges: blockAfter('Challenges') || blockAfter('Opportunities'),
    websiteUrl: after('Website') || after('Web Site'),
    socialMediaLinks: after('Social Media') || after('Facebook') || after('Instagram'),
    narrativeReflections: blockAfter('Narrative') || blockAfter('Reflection'),
    scrapedAt: new Date().toISOString(),
    rawContent: text,
  };
}

// Keep the old function signature for backwards compatibility but now unused
export async function discoverIdsFromSearchResults(
  page: Page,
  expectedCount: number
): Promise<number[]> {
  logger.info('ID discovery via row clicking is disabled, using range scan instead');
  return [];
}
