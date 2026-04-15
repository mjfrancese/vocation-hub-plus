/**
 * Parallel, direct-URL profile refresh.
 *
 * For positions that already have a VH ID mapped in position_vh_ids
 * (the vast majority on any given daily run), we don't need to re-drive
 * the Kendo search grid. We can hit /PositionView/{id} directly with
 * N parallel pages, exactly like the weekly deep-scrape does.
 *
 * This is the single largest runtime win in the reliability fix:
 * ~45 positions × 13s serial ≈ 10 min collapses to
 * ~45/5 × 3s parallel ≈ 30 s.
 */
import { Browser } from 'playwright';
import { logger } from './logger.js';
import { openProfileAndExtract } from './extractors/profile.js';

export interface ProfileResult {
  id: number;
  fields: Array<{ label: string; value: string }>;
}

export interface RefreshProfilesOptions {
  /** If set and aborted, stop between batches. Current in-flight batch completes. */
  signal?: AbortSignal;
  /** Parallel page count. Default 5 (matches deep-scrape). */
  concurrency?: number;
  /** Called after each batch completes. */
  onProgress?: (processed: number, total: number, succeeded: number) => void;
}

export interface RefreshProfilesResult {
  profiles: ProfileResult[];
  processed: number;
  succeeded: number;
  failed: number;
  aborted: boolean;
}

/**
 * Refresh profile data for a set of known VH IDs.
 *
 * Opens a fresh BrowserContext with N parallel pages, iterates `vhIds`
 * in chunks of N, and uses openProfileAndExtract on each. Profiles
 * that fail to load (network error, <6 tabs, etc.) are skipped and
 * counted in the result's `failed` count.
 *
 * Safe to call with an empty array (returns empty result immediately).
 */
export async function refreshKnownProfiles(
  browser: Browser,
  vhIds: number[],
  opts: RefreshProfilesOptions = {}
): Promise<RefreshProfilesResult> {
  if (vhIds.length === 0) {
    return { profiles: [], processed: 0, succeeded: 0, failed: 0, aborted: false };
  }

  const concurrency = opts.concurrency ?? 5;
  const profiles: ProfileResult[] = [];
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let aborted = false;

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  try {
    const pages = await Promise.all(
      Array.from({ length: concurrency }, () => context.newPage())
    );

    const startTime = Date.now();
    logger.info('Profile refresh starting (parallel direct-URL)', {
      total: vhIds.length,
      concurrency,
    });

    for (let batchStart = 0; batchStart < vhIds.length; batchStart += concurrency) {
      if (opts.signal?.aborted) {
        aborted = true;
        logger.warn('Profile refresh aborted between batches', {
          processed,
          remaining: vhIds.length - batchStart,
        });
        break;
      }

      const batch = vhIds.slice(batchStart, batchStart + concurrency);

      const batchResults = await Promise.allSettled(
        batch.map((id, idx) =>
          openProfileAndExtract(pages[idx], id, { signal: opts.signal })
        )
      );

      for (let i = 0; i < batchResults.length; i++) {
        const r = batchResults[i];
        processed++;
        if (r.status === 'fulfilled' && r.value) {
          profiles.push({ id: r.value.id, fields: r.value.fields });
          succeeded++;
        } else {
          failed++;
          if (r.status === 'rejected') {
            logger.warn('Profile refresh error', {
              id: batch[i],
              error: String(r.reason).substring(0, 200),
            });
          }
        }
      }

      if (opts.onProgress) opts.onProgress(processed, vhIds.length, succeeded);

      if (processed % 20 === 0 || processed >= vhIds.length) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / Math.max(elapsed, 0.001);
        logger.info('Profile refresh progress', {
          processed,
          total: vhIds.length,
          succeeded,
          failed,
          ratePerSec: rate.toFixed(2),
        });
      }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    logger.info('Profile refresh complete', {
      total: vhIds.length,
      processed,
      succeeded,
      failed,
      aborted,
      elapsedSec: elapsed.toFixed(1),
    });
  } finally {
    await context.close().catch((err) => {
      logger.warn('Failed to close refresh context', { error: String(err) });
    });
  }

  return { profiles, processed, succeeded, failed, aborted };
}
