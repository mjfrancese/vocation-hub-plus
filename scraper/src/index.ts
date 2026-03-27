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
import { discoverAndScrapePositions } from './discover-ids-from-search.js';
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

      // Phase 2: Discover VH IDs AND extract detail data in ONE pass.
      // Clicks each row, captures URL, extracts profile data while
      // on the profile page, then goes back. No second pass needed.
      try {
        const elapsed = Date.now() - startTime;
        const timeLeft = CONFIG.maxRuntime - elapsed - 120_000;

        if (timeLeft > 120_000) {
          const positionsNeedingIds = getPositionsWithoutVhId();

          if (positionsNeedingIds.length > 0) {
            logger.info('Discovering IDs + scraping details in one pass', {
              needIds: positionsNeedingIds.length,
            });

            await navigateToSearch(page);
            await searchAllPositions(page);
            await sleep(3000);

            const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
            if (pagerText && !pagerText.includes('0 - 0 of 0')) {
              const result = await discoverAndScrapePositions(page, CONFIG.url);

              // Save ID mapping
              const sortedPositions = [...positions].sort((a, b) => a.name.localeCompare(b.name));
              saveIdMapping(sortedPositions, result.ids);

              // Save profile fields for the frontend
              saveProfileFields(result.profiles);
            }
          } else {
            logger.info('All active positions already have VH IDs');
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

function saveIdMapping(positions: RawPosition[], vhIds: number[]): void {
  const d = getDb();
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

  for (let i = 0; i < Math.min(positions.length, vhIds.length); i++) {
    insert.run(positions[i].id, vhIds[i], positions[i].name, positions[i].diocese);
  }
  logger.info('Saved ID mapping', { count: Math.min(positions.length, vhIds.length) });
}

/**
 * Save the extracted profile fields as a JSON file for the frontend.
 * The frontend uses VH ID to look up fields for each position.
 */
function saveProfileFields(
  profiles: Array<{ id: number; fields: Array<{ label: string; value: string }> }>
): void {
  const mapping: Record<number, Array<{ label: string; value: string }>> = {};
  for (const p of profiles) {
    mapping[p.id] = p.fields;
  }

  const outputDirs = [
    path.resolve(__dirname, '../output'),
    path.resolve(__dirname, '../../web/public/data'),
  ];

  for (const dir of outputDirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'profile-fields.json'),
      JSON.stringify(mapping, null, 2)
    );
  }

  logger.info('Saved profile fields', { profiles: profiles.length });
}

function getPositionsWithoutVhId(): string[] {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS position_vh_ids (
      position_id TEXT PRIMARY KEY,
      vh_id INTEGER NOT NULL,
      name TEXT,
      diocese TEXT,
      mapped_at DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return (d.prepare(`
    SELECT p.id FROM positions p
    LEFT JOIN position_vh_ids m ON p.id = m.position_id
    WHERE p.status IN ('active', 'new')
    AND m.position_id IS NULL
  `).all() as Array<{ id: string }>).map(r => r.id);
}

main();
