import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const CONFIG = {
  /** Vocation Hub position search URL */
  url: process.env.VOCATIONHUB_URL || 'https://vocationhub.episcopalchurch.org/PositionSearch',

  /** Delay between UI interactions (ms) */
  scrapeDelay: parseInt(process.env.SCRAPE_DELAY_MS || '250', 10),

  /** Time to wait for popup to appear (ms) */
  popupWait: parseInt(process.env.POPUP_WAIT_MS || '600', 10),

  /** SQLite database path */
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../../data/positions.db'),

  /** JSON output directory */
  outputPath: process.env.OUTPUT_PATH || path.resolve(__dirname, '../output'),

  /** Save screenshots on failure */
  screenshotOnFailure: process.env.SCREENSHOT_ON_FAILURE !== 'false',

  /**
   * Maximum runtime before the cooperative abort signal fires (ms).
   * The scraper checks the signal between rows/batches and finalises
   * with partial results — it does NOT hard-kill the process.
   * Workflow step timeout-minutes: 30 gives 5 min of headroom over
   * this default for browser close + DB writes.
   */
  maxRuntime: parseInt(process.env.MAX_RUNTIME_MS || '1500000', 10),

  /** Screenshot directory */
  screenshotDir: path.resolve(__dirname, '../../screenshots'),

  /** Max retries for dropdown opening */
  maxDropdownRetries: 5,

  /** Whether this is a dry run */
  dryRun: process.argv.includes('--dry-run'),
} as const;
