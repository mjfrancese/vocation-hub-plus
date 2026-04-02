import { launchBrowser, takeScreenshot, closeBrowser } from './browser.js';
import { navigateToSearch } from './navigate.js';
import { searchAllPositions } from './select-states.js';
import { clickSearchAndExtract, RawPosition } from './scrape-results.js';
import { applyDiff } from './diff.js';
import { logScrape, closeDb, getDb, recordDiscoveryAttempt, recordDiscoverySuccess, getDiscoveryStats, seedFirstSeenFromJson, getAllPositionsWithDetails, getRecentChanges, getScrapeStats } from './db.js';
import { exportJson } from './export-json.js';
import { exportToDb } from './export-db.js';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { sleep } from './navigate.js';
import { discoverAndScrapePositions, type DiscoveredId } from './discover-ids-from-search.js';
import { runBackfill } from './backfill.js';
import { checkQuality } from './quality-check.js';

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

  // Seed first_seen from existing JSON when DB is fresh (preserves historical dates)
  seedFirstSeenFromJson();

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
      let phase2Success = true;
      let phase3Success = true;
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
              saveIdMapping(positions, result.ids);

              // Save profile fields for the frontend
              saveProfileFields(result.profiles);

              // Layer 3: Track failures for positions that weren't discovered
              const discoveredVhIds = new Set(result.ids.map(d => d.id));
              const unmappedAfterPhase2 = getPositionsWithoutVhId();
              for (const posId of unmappedAfterPhase2) {
                const pos = positions.find(p => p.id === posId);
                if (pos) {
                  recordDiscoveryAttempt(posId, pos.name, pos.diocese, 'not_found_in_phase2');
                }
              }
            }
          } else {
            logger.info('All active positions already have VH IDs');
          }
        } else {
          logger.warn('Not enough time for Phase 2', { elapsed, timeLeft });
        }
      } catch (detailErr) {
        phase2Success = false;
        logger.warn('Phase 2 failed (non-fatal)', {
          error: detailErr instanceof Error ? detailErr.message : String(detailErr),
        });
      }

      // Phase 3: Targeted backfill for positions that Phase 2 missed.
      // Uses name-based search instead of row clicking for better reliability.
      try {
        const elapsed3 = Date.now() - startTime;
        const timeLeft3 = CONFIG.maxRuntime - elapsed3 - 60_000;

        if (timeLeft3 > 60_000) {
          const backfillResult = await runBackfill(page, CONFIG.url, 10);

          if (backfillResult.succeeded > 0) {
            // Save the newly discovered ID mappings
            for (const prof of backfillResult.profiles) {
              // Find the position to create the mapping
              const d = getDb();
              d.prepare(
                'INSERT OR REPLACE INTO position_vh_ids (position_id, vh_id, name, diocese) ' +
                'SELECT da.position_id, ?, da.name, da.diocese FROM discovery_attempts da WHERE da.resolved_vh_id = ?'
              ).run(prof.id, prof.id);
            }

            // Save profile fields
            saveProfileFields(backfillResult.profiles);
          }
        } else {
          logger.info('Not enough time for Phase 3 backfill', { timeLeft: timeLeft3 });
        }
      } catch (backfillErr) {
        phase3Success = false;
        logger.warn('Phase 3 backfill failed (non-fatal)', {
          error: backfillErr instanceof Error ? backfillErr.message : String(backfillErr),
        });
      }

      // Log discovery stats
      const discoveryStats = getDiscoveryStats();
      if (discoveryStats.pending > 0 || discoveryStats.failed > 0) {
        logger.info('Discovery tracking', discoveryStats);
      }

      const durationMs = Date.now() - startTime;
      logScrape(positions.length, diff.newCount, diff.expiredCount, durationMs, 'success');
      exportJson();

      // Also export to the main vocationhub.db if it exists (additive -- JSON export above is unchanged)
      const mainDbPath = process.env.VOCATIONHUB_DB_PATH ||
        path.resolve(__dirname, '../../data/vocationhub.db');
      if (fs.existsSync(mainDbPath)) {
        try {
          const allPositions = getAllPositionsWithDetails();
          const allChanges = getRecentChanges(500);
          const scrapeStats = getScrapeStats();
          const exportMeta = {
            lastUpdated: new Date().toISOString(),
            totalPositions: allPositions.length,
            activeCount: allPositions.filter((p) => p.status === 'active' || p.status === 'new').length,
            expiredCount: allPositions.filter((p) => p.status === 'expired').length,
            newCount: allPositions.filter((p) => p.status === 'new').length,
            lastScrape: scrapeStats || null,
          };
          exportToDb(mainDbPath, allPositions, allChanges, exportMeta, {}, []);
        } catch (dbExportErr) {
          logger.warn('DB export to vocationhub.db failed (non-fatal)', {
            error: dbExportErr instanceof Error ? dbExportErr.message : String(dbExportErr),
          });
        }
      } else {
        logger.info('vocationhub.db not found, skipping DB export', { path: mainDbPath });
      }

      const qualityReport = checkQuality({
        totalPositions: positions.length,
        newCount: diff.newCount,
        expiredCount: diff.expiredCount,
        phase2Success,
        phase3Success,
      });

      if (!qualityReport.pass) {
        logger.warn('Data quality check failed', {
          checks: qualityReport.checks.filter(c => !c.pass),
        });
      }

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

function saveIdMapping(positions: RawPosition[], discovered: DiscoveredId[]): void {
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

  // Match discovered IDs to positions by name+diocese instead of array index.
  // This prevents misalignment when search result order differs between scrapes.
  let matched = 0;
  const usedPositions = new Set<string>();

  for (const disc of discovered) {
    // Normalize for matching
    const dName = disc.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dDiocese = disc.diocese.toLowerCase().replace(/[^a-z0-9]/g, '');

    let bestMatch: RawPosition | null = null;
    let bestScore = 0;

    for (const pos of positions) {
      if (usedPositions.has(pos.id)) continue;
      const pName = pos.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const pDiocese = pos.diocese.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Require diocese match
      if (pDiocese !== dDiocese) continue;

      // Score name similarity
      let score = 0;
      if (pName === dName) {
        score = 100;
      } else if (pName.includes(dName) || dName.includes(pName)) {
        score = 80;
      } else {
        // Word overlap
        const pWords = pName.match(/[a-z]{3,}/g) || ([] as string[]);
        const dWords = dName.match(/[a-z]{3,}/g) || ([] as string[]);
        const overlap = pWords.filter(w => dWords.includes(w)).length;
        if (overlap > 0) score = 50 + overlap * 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = pos;
      }
    }

    if (bestMatch && bestScore >= 50) {
      insert.run(bestMatch.id, disc.id, disc.name, disc.diocese);
      usedPositions.add(bestMatch.id);
      matched++;
    } else {
      // Fallback: create a standalone entry for this VH ID
      insert.run(`vh_${disc.id}`, disc.id, disc.name, disc.diocese);
      matched++;
      logger.warn('No position match for discovered ID', {
        vhId: disc.id,
        name: disc.name,
        diocese: disc.diocese,
      });
    }
  }

  logger.info('Saved ID mapping', { matched, total: discovered.length });
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
