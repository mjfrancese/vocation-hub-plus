import { launchBrowser, takeScreenshot, closeBrowser } from './browser.js';
import { navigateToSearch } from './navigate.js';
import { searchAllPositions } from './select-states.js';
import { clickSearchAndExtract, RawPosition } from './scrape-results.js';
import { applyDiff } from './diff.js';
import { logScrape, closeDb, getDb, recordDiscoveryAttempt, getDiscoveryStats, seedFirstSeenFromJson, getAllPositionsWithDetails, getRecentChanges, getScrapeStats } from './db.js';
import { exportJson } from './export-json.js';
import { exportToDb } from './export-db.js';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { sleep } from './navigate.js';
import { discoverAndScrapePositions, type DiscoveredId, type DiscoveryTarget } from './discover-ids-from-search.js';
import { runBackfill } from './backfill.js';
import { refreshKnownProfiles } from './refresh-profiles.js';
import { checkQuality } from './quality-check.js';

import fs from 'fs';
import path from 'path';

/** Mutable state used by the heartbeat logger. */
interface ScrapeState {
  phase: 'init' | 'phase1' | 'phase2b-refresh' | 'phase2a-discover' | 'phase3-backfill' | 'export' | 'done';
  rowsProcessed: number;
  totalRows: number;
}

const scrapeState: ScrapeState = {
  phase: 'init',
  rowsProcessed: 0,
  totalRows: 0,
};

async function main(): Promise<void> {
  const startTime = Date.now();

  logger.info('Vocation Hub+ scraper starting', {
    dryRun: CONFIG.dryRun,
    url: CONFIG.url,
    maxRuntime: CONFIG.maxRuntime,
  });

  // Cooperative abort: when the runtime budget is spent we flip the
  // signal and each phase checks it between iterations. No process.exit.
  const abort = new AbortController();
  const runtimeTimer = setTimeout(() => {
    logger.error('Maximum runtime exceeded, signalling abort', {
      elapsed: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      budget: `${(CONFIG.maxRuntime / 1000).toFixed(0)}s`,
    });
    abort.abort();
  }, CONFIG.maxRuntime);

  // Heartbeat: logs phase + progress every 30s so timeouts become debuggable.
  const heartbeat = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const budgetLeft = Math.max(0, CONFIG.maxRuntime - elapsed);
    logger.info('heartbeat', {
      phase: scrapeState.phase,
      rowsProcessed: scrapeState.rowsProcessed,
      totalRows: scrapeState.totalRows,
      elapsedSec: Math.round(elapsed / 1000),
      budgetLeftSec: Math.round(budgetLeft / 1000),
      aborted: abort.signal.aborted,
    });
  }, 30_000);

  // Seed first_seen from existing JSON when DB is fresh (preserves historical dates)
  seedFirstSeenFromJson();

  const { browser, page } = await launchBrowser();

  let phase2Success = true;
  let phase3Success = true;
  let phase1Positions: RawPosition[] = [];
  let diff: { newCount: number; updatedCount: number; expiredCount: number } | null = null;

  try {
    // Phase 1: Search table scrape (fast, ~30s)
    scrapeState.phase = 'phase1';

    // Retry up to 3 times if the result count is suspiciously low,
    // which indicates a Blazor timing issue rather than real data change.
    const MIN_EXPECTED_POSITIONS = 8;
    const MAX_PHASE1_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_PHASE1_ATTEMPTS; attempt++) {
      if (abort.signal.aborted) {
        logger.warn('Phase 1 aborted before completion');
        break;
      }
      await navigateToSearch(page);
      await searchAllPositions(page);
      phase1Positions = await clickSearchAndExtract(page);
      logger.info('Search scrape complete', {
        positionsFound: phase1Positions.length,
        attempt,
      });

      if (phase1Positions.length >= MIN_EXPECTED_POSITIONS) {
        break;
      }

      if (attempt < MAX_PHASE1_ATTEMPTS) {
        logger.warn('Suspiciously low result count, retrying', {
          found: phase1Positions.length,
          threshold: MIN_EXPECTED_POSITIONS,
          attempt,
          nextAttemptIn: '10s',
        });
        await sleep(10_000);
      }
    }

    if (phase1Positions.length === 0) {
      throw new Error('Scrape returned 0 positions after all retry attempts.');
    }

    scrapeState.totalRows = phase1Positions.length;

    if (!CONFIG.dryRun) {
      diff = applyDiff(phase1Positions);
      logger.info('Search results saved', {
        new: diff.newCount,
        updated: diff.updatedCount,
        expired: diff.expiredCount,
      });

      // Split Phase 1 positions into two groups based on existing VH ID mapping.
      const { withVhIds, withoutVhIds } = splitByVhIdStatus(phase1Positions);
      logger.info('Phase 2 split', {
        knownProfiles: withVhIds.length,
        needDiscovery: withoutVhIds.length,
      });

      // --- Phase 2b: refresh known profiles via parallel direct URL ---
      // Runs first because it's fast and handles the majority of positions.
      // If the run aborts here, we still have fresh profile data for all
      // previously-mapped positions (the bulk of the dataset).
      const knownVhIds = withVhIds.map((x) => x.vhId);
      let phase2bProfiles: Array<{ id: number; fields: Array<{ label: string; value: string }> }> = [];
      try {
        scrapeState.phase = 'phase2b-refresh';
        scrapeState.rowsProcessed = 0;
        scrapeState.totalRows = knownVhIds.length;

        if (knownVhIds.length > 0 && !abort.signal.aborted) {
          const result = await refreshKnownProfiles(browser, knownVhIds, {
            signal: abort.signal,
            concurrency: 5,
            onProgress: (processed) => {
              scrapeState.rowsProcessed = processed;
            },
          });
          phase2bProfiles = result.profiles;
          if (result.aborted) phase2Success = false;
        } else if (knownVhIds.length === 0) {
          logger.info('Phase 2b skipped: no known VH IDs yet');
        }
      } catch (err) {
        phase2Success = false;
        logger.warn('Phase 2b failed (non-fatal)', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // --- Phase 2a: discover VH IDs for unmapped positions (click-through) ---
      let phase2aProfiles: Array<{ id: number; fields: Array<{ label: string; value: string }> }> = [];
      let phase2aIds: DiscoveredId[] = [];
      try {
        scrapeState.phase = 'phase2a-discover';
        scrapeState.rowsProcessed = 0;
        scrapeState.totalRows = withoutVhIds.length;

        const elapsed = Date.now() - startTime;
        const timeLeft = CONFIG.maxRuntime - elapsed - 120_000;

        if (abort.signal.aborted) {
          logger.warn('Phase 2a skipped: run already aborted');
          phase2Success = false;
        } else if (withoutVhIds.length === 0) {
          logger.info('Phase 2a skipped: all Phase 1 positions already mapped');
        } else if (timeLeft <= 60_000) {
          logger.warn('Phase 2a skipped: not enough time left', { elapsed, timeLeft });
          phase2Success = false;
        } else {
          const targets: DiscoveryTarget[] = withoutVhIds.map((p) => ({
            positionId: p.id,
            name: p.name,
            diocese: p.diocese,
          }));

          logger.info('Phase 2a: discovering new VH IDs via search grid', {
            targets: targets.length,
          });

          await navigateToSearch(page);
          await searchAllPositions(page);
          await sleep(3000);

          const pagerText = await page.locator('.k-pager-info').textContent().catch(() => '');
          if (pagerText && !pagerText.includes('0 - 0 of 0')) {
            const result = await discoverAndScrapePositions(page, CONFIG.url, {
              targets,
              signal: abort.signal,
            });
            phase2aIds = result.ids;
            phase2aProfiles = result.profiles;

            if (result.aborted) phase2Success = false;

            // Save the new ID mapping for discovered positions.
            saveIdMapping(phase1Positions, result.ids);

            // Track failures for targets that discovery missed.
            const resolvedPositionIds = new Set(
              result.ids
                .map((d) => findPositionByNameDiocese(phase1Positions, d.name, d.diocese))
                .filter((id): id is string => id !== null),
            );
            for (const pos of withoutVhIds) {
              if (!resolvedPositionIds.has(pos.id)) {
                recordDiscoveryAttempt(pos.id, pos.name, pos.diocese, 'not_found_in_phase2');
              }
            }
          } else {
            logger.warn('Phase 2a: grid returned 0 rows, skipping');
            phase2Success = false;
          }
        }
      } catch (err) {
        phase2Success = false;
        logger.warn('Phase 2a failed (non-fatal)', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Merge profiles from 2b and 2a (2a wins for any overlapping vh_id as it's freshest).
      const mergedProfiles = mergeProfiles(phase2bProfiles, phase2aProfiles);
      saveProfileFields(mergedProfiles);

      // --- Phase 3: targeted backfill for Phase 2a misses ---
      try {
        scrapeState.phase = 'phase3-backfill';
        const elapsed3 = Date.now() - startTime;
        const timeLeft3 = CONFIG.maxRuntime - elapsed3 - 60_000;

        if (abort.signal.aborted) {
          logger.warn('Phase 3 skipped: run already aborted');
          phase3Success = false;
        } else if (timeLeft3 <= 60_000) {
          logger.info('Not enough time for Phase 3 backfill', { timeLeft: timeLeft3 });
          phase3Success = false;
        } else {
          const backfillResult = await runBackfill(page, CONFIG.url, 10, {
            signal: abort.signal,
          });

          if (backfillResult.aborted) phase3Success = false;

          if (backfillResult.succeeded > 0) {
            const d = getDb();
            for (const prof of backfillResult.profiles) {
              d.prepare(
                'INSERT OR REPLACE INTO position_vh_ids (position_id, vh_id, name, diocese) ' +
                'SELECT da.position_id, ?, da.name, da.diocese FROM discovery_attempts da WHERE da.resolved_vh_id = ?'
              ).run(prof.id, prof.id);
            }

            // Merge backfill profiles on top of what we already saved.
            saveProfileFields(mergeProfiles(mergedProfiles, backfillResult.profiles));
          }
        }
      } catch (backfillErr) {
        phase3Success = false;
        logger.warn('Phase 3 backfill failed (non-fatal)', {
          error: backfillErr instanceof Error ? backfillErr.message : String(backfillErr),
        });
      }

      const discoveryStats = getDiscoveryStats();
      if (discoveryStats.pending > 0 || discoveryStats.failed > 0) {
        logger.info('Discovery tracking', discoveryStats);
      }

      // --- Export phase ---
      scrapeState.phase = 'export';
      const durationMs = Date.now() - startTime;

      const qualityReport = checkQuality({
        totalPositions: phase1Positions.length,
        newCount: diff.newCount,
        expiredCount: diff.expiredCount,
        phase2Success,
        phase3Success,
      });

      // Informational phase checks should not block exports. Log them if failing.
      const nonBlockingFails = qualityReport.checks.filter((c) => !c.pass && !c.blocking);
      if (nonBlockingFails.length > 0) {
        logger.warn('Quality check: non-blocking issues', {
          issues: nonBlockingFails.map((c) => ({ name: c.name, message: c.message })),
        });
      }

      if (!qualityReport.pass) {
        logger.error('Data quality check failed -- skipping exports to prevent bad data', {
          blockingFailures: qualityReport.checks.filter((c) => !c.pass && c.blocking),
        });
        logScrape(phase1Positions.length, diff.newCount, diff.expiredCount, durationMs, 'failed', 'quality-check-failed');
        process.exitCode = 1;
        return;
      }

      const status = abort.signal.aborted ? 'partial' : 'success';
      logScrape(phase1Positions.length, diff.newCount, diff.expiredCount, durationMs, status);
      exportJson();

      // Also export to the main vocationhub.db if it exists (additive).
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

          const profileFieldsPath = path.join(path.resolve(__dirname, '../output'), 'profile-fields.json');
          const profileFields: Record<number, Array<{ label: string; value: string }>> = fs.existsSync(profileFieldsPath)
            ? JSON.parse(fs.readFileSync(profileFieldsPath, 'utf8'))
            : {};

          const allProfiles = Object.entries(profileFields).map(([id, fields]) => ({
            id: parseInt(id, 10),
            fields,
          }));

          exportToDb(mainDbPath, allPositions, allChanges, exportMeta, profileFields, allProfiles);
        } catch (dbExportErr) {
          logger.warn('DB export to vocationhub.db failed (non-fatal)', {
            error: dbExportErr instanceof Error ? dbExportErr.message : String(dbExportErr),
          });
        }
      } else {
        logger.info('vocationhub.db not found, skipping DB export', { path: mainDbPath });
      }

      scrapeState.phase = 'done';
      logger.info('Scrape completed', {
        status,
        duration: `${(durationMs / 1000).toFixed(1)}s`,
        found: phase1Positions.length,
        new: diff.newCount,
        updated: diff.updatedCount,
        expired: diff.expiredCount,
        phase2Success,
        phase3Success,
        aborted: abort.signal.aborted,
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
      logScrape(
        phase1Positions.length,
        diff?.newCount ?? 0,
        diff?.expiredCount ?? 0,
        durationMs,
        'failed',
        errorMessage,
      );
    }

    process.exitCode = 1;
  } finally {
    clearTimeout(runtimeTimer);
    clearInterval(heartbeat);
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
  let matched = 0;
  const usedPositions = new Set<string>();

  for (const disc of discovered) {
    const dName = disc.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dDiocese = disc.diocese.toLowerCase().replace(/[^a-z0-9]/g, '');

    let bestMatch: RawPosition | null = null;
    let bestScore = 0;

    for (const pos of positions) {
      if (usedPositions.has(pos.id)) continue;
      const pName = pos.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const pDiocese = pos.diocese.toLowerCase().replace(/[^a-z0-9]/g, '');

      if (pDiocese !== dDiocese) continue;

      let score = 0;
      if (pName === dName) {
        score = 100;
      } else if (pName.includes(dName) || dName.includes(pName)) {
        score = 80;
      } else {
        const pWords = pName.match(/[a-z]{3,}/g) || ([] as string[]);
        const dWords = dName.match(/[a-z]{3,}/g) || ([] as string[]);
        const overlap = pWords.filter((w) => dWords.includes(w)).length;
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

/** Best-effort lookup of a Phase-1 position id by name+diocese. */
function findPositionByNameDiocese(
  positions: RawPosition[],
  name: string,
  diocese: string,
): string | null {
  const targetDiocese = diocese.toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const p of positions) {
    const pDiocese = p.diocese.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (pDiocese !== targetDiocese) continue;
    const pName = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (pName === targetName || pName.includes(targetName) || targetName.includes(pName)) {
      return p.id;
    }
  }
  return null;
}

/** Merge profile arrays keyed by VH id. Right side wins on conflict. */
function mergeProfiles(
  left: Array<{ id: number; fields: Array<{ label: string; value: string }> }>,
  right: Array<{ id: number; fields: Array<{ label: string; value: string }> }>,
): Array<{ id: number; fields: Array<{ label: string; value: string }> }> {
  const byId = new Map<number, { id: number; fields: Array<{ label: string; value: string }> }>();
  for (const p of left) byId.set(p.id, p);
  for (const p of right) byId.set(p.id, p);
  return Array.from(byId.values());
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

/**
 * Split Phase 1 positions into two groups: those that already have a
 * VH ID mapping (fast parallel refresh path) and those that don't
 * (slow click-through discovery path).
 */
function splitByVhIdStatus(
  positions: RawPosition[],
): {
  withVhIds: Array<{ position: RawPosition; vhId: number }>;
  withoutVhIds: RawPosition[];
} {
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

  const lookup = d.prepare('SELECT vh_id FROM position_vh_ids WHERE position_id = ?');
  const withVhIds: Array<{ position: RawPosition; vhId: number }> = [];
  const withoutVhIds: RawPosition[] = [];

  for (const pos of positions) {
    const row = lookup.get(pos.id) as { vh_id: number } | undefined;
    if (row && typeof row.vh_id === 'number') {
      withVhIds.push({ position: pos, vhId: row.vh_id });
    } else {
      withoutVhIds.push(pos);
    }
  }

  return { withVhIds, withoutVhIds };
}

main();
