import { launchBrowser, takeScreenshot, closeBrowser } from './browser.js';
import { navigateToSearch } from './navigate.js';
import { searchAllPositions } from './select-states.js';
import { clickSearchAndExtract, RawPosition } from './scrape-results.js';
import { applyDiff } from './diff.js';
import { logScrape, closeDb, getDb } from './db.js';
import { exportJson } from './export-json.js';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { sleep } from './navigate.js';
import { scrapePositionDetails } from './position-details.js';
import { discoverPositionIds } from './discover-ids-from-search.js';
import fs from 'fs';
import path from 'path';

async function main(): Promise<void> {
  const startTime = Date.now();

  logger.info('Vocation Hub+ scraper starting', {
    dryRun: CONFIG.dryRun,
    url: CONFIG.url,
    maxRuntime: CONFIG.maxRuntime,
  });

  const timeout = setTimeout(() => {
    logger.error('Maximum runtime exceeded, aborting');
    process.exit(1);
  }, CONFIG.maxRuntime);

  const { browser, context, page } = await launchBrowser();

  try {
    // Phase 1: Search table scrape (fast, ~30s)
    await navigateToSearch(page);
    await searchAllPositions(page);
    const positions = await clickSearchAndExtract(page);
    logger.info('Search scrape complete', { positionsFound: positions.length });

    if (positions.length === 0) {
      throw new Error('Scrape returned 0 positions.');
    }

    if (!CONFIG.dryRun) {
      const diff = applyDiff(positions);
      logger.info('Search results saved', {
        new: diff.newCount,
        updated: diff.updatedCount,
        expired: diff.expiredCount,
      });

      // Phase 2: Discover VH IDs for positions that don't have them yet,
      // then scrape their detail data.
      try {
        const elapsed = Date.now() - startTime;
        const timeLeft = CONFIG.maxRuntime - elapsed - 120_000;

        if (timeLeft > 120_000) {
          // Check which positions need IDs
          const positionsNeedingIds = getPositionsWithoutVhId();

          if (positionsNeedingIds.length > 0) {
            logger.info('Discovering VH IDs for positions', { count: positionsNeedingIds.length });

            // Re-navigate and search to get a clickable results page
            await navigateToSearch(page);
            await searchAllPositions(page);
            await sleep(3000);

            const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
            if (pagerText && !pagerText.includes('0 - 0 of 0')) {
              const discoveredIds = await discoverPositionIds(page, CONFIG.url);
              logger.info('Discovered VH IDs', { count: discoveredIds.length, ids: discoveredIds });

              // Save the ID mapping: match discovered IDs to positions by row order
              // The search results are in alphabetical order, same as our positions
              const sortedPositions = [...positions].sort((a, b) => a.name.localeCompare(b.name));
              saveIdMapping(sortedPositions, discoveredIds);

              // Now scrape details for newly discovered IDs
              if (discoveredIds.length > 0) {
                const elapsed2 = Date.now() - startTime;
                const timeLeft2 = CONFIG.maxRuntime - elapsed2 - 120_000;
                if (timeLeft2 > 30_000) {
                  const baseUrl = CONFIG.url.replace('/PositionSearch', '');
                  await scrapePositionDetails(context, discoveredIds, baseUrl, timeLeft2);
                }
              }
            }
          } else {
            logger.info('All active positions have VH IDs');

            // Scrape details for any positions missing detail data
            const idsToScrape = getIdsNeedingDetails();
            if (idsToScrape.length > 0) {
              const elapsed2 = Date.now() - startTime;
              const timeLeft2 = CONFIG.maxRuntime - elapsed2 - 120_000;
              if (timeLeft2 > 30_000) {
                const baseUrl = CONFIG.url.replace('/PositionSearch', '');
                await scrapePositionDetails(context, idsToScrape, baseUrl, timeLeft2);
              }
            }
          }
        } else {
          logger.warn('Not enough time for Phase 2', { elapsed, timeLeft });
        }
      } catch (detailErr) {
        logger.warn('Phase 2 failed (non-fatal)', {
          error: detailErr instanceof Error ? detailErr.message : String(detailErr),
        });
      }

      const durationMs = Date.now() - startTime;
      logScrape(positions.length, diff.newCount, diff.expiredCount, durationMs, 'success');
      exportJson();

      logger.info('Scrape completed successfully', {
        duration: `${(durationMs / 1000).toFixed(1)}s`,
        found: positions.length,
        new: diff.newCount,
        updated: diff.updatedCount,
        expired: diff.expiredCount,
      });
    } else {
      logger.info('Dry run mode: skipping database writes');
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error('Scrape failed', { error: errorMessage });
    await takeScreenshot(page, 'error');

    if (!CONFIG.dryRun) {
      logScrape(0, 0, 0, durationMs, 'failed', errorMessage);
    }

    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await closeBrowser(browser);
    if (!CONFIG.dryRun) {
      closeDb();
    }
  }
}

/**
 * Save the mapping from position names to VH IDs.
 * The search results and the clicked rows are in the same order,
 * so we can map them by index.
 */
function saveIdMapping(positions: RawPosition[], vhIds: number[]): void {
  const d = getDb();

  // Create mapping table if needed
  d.exec(`
    CREATE TABLE IF NOT EXISTS position_vh_ids (
      position_id TEXT PRIMARY KEY,
      vh_id INTEGER NOT NULL,
      name TEXT,
      diocese TEXT,
      mapped_at DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const insert = d.prepare(
    'INSERT OR REPLACE INTO position_vh_ids (position_id, vh_id, name, diocese) VALUES (?, ?, ?, ?)'
  );

  let mapped = 0;
  for (let i = 0; i < Math.min(positions.length, vhIds.length); i++) {
    insert.run(positions[i].id, vhIds[i], positions[i].name, positions[i].diocese);
    mapped++;
  }

  logger.info('Saved ID mapping', { mapped });
}

function getPositionsWithoutVhId(): string[] {
  const d = getDb();

  // Ensure the table exists
  d.exec(`
    CREATE TABLE IF NOT EXISTS position_vh_ids (
      position_id TEXT PRIMARY KEY,
      vh_id INTEGER NOT NULL,
      name TEXT,
      diocese TEXT,
      mapped_at DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const result = d.prepare(`
    SELECT p.id FROM positions p
    LEFT JOIN position_vh_ids m ON p.id = m.position_id
    WHERE p.status IN ('active', 'new')
    AND m.position_id IS NULL
  `).all() as Array<{ id: string }>;

  return result.map(r => r.id);
}

function getIdsNeedingDetails(): number[] {
  const d = getDb();

  const result = d.prepare(`
    SELECT m.vh_id FROM position_vh_ids m
    JOIN positions p ON m.position_id = p.id
    LEFT JOIN position_details d ON m.position_id = d.position_id
    WHERE p.status IN ('active', 'new')
    AND d.position_id IS NULL
  `).all() as Array<{ vh_id: number }>;

  return result.map(r => r.vh_id);
}

main();
