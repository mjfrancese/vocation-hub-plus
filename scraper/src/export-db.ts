import Database from 'better-sqlite3';
import { logger } from './logger.js';

/**
 * Export scraper data into the main vocationhub.db alongside the JSON export.
 * Only positions that have a resolved vh_id are written to scraped_positions
 * (positions without a vh_id are not yet linkable by the downstream pipeline).
 *
 * @param dbPath - Path to the main vocationhub.db
 * @param positions - Full positions array from getAllPositionsWithDetails()
 * @param changes - Recent changes array from getRecentChanges()
 * @param meta - Metadata object from exportJson (lastUpdated, counts, etc.)
 * @param profileFields - Profile fields map (vh_id -> fields[]) from profile-fields.json
 * @param allProfiles - Raw profiles array from discoverAndScrapePositions
 */
export function exportToDb(
  dbPath: string,
  positions: Record<string, unknown>[],
  changes: Record<string, unknown>[],
  meta: Record<string, unknown>,
  profileFields: Record<number, Array<{ label: string; value: string }>>,
  allProfiles: Array<{ id: number; fields: Array<{ label: string; value: string }> }>
): void {
  const db = new Database(dbPath);

  try {
    db.pragma('journal_mode = WAL');

    // Ensure tables exist (the release DB may predate these tables)
    db.exec(`
      CREATE TABLE IF NOT EXISTS scraped_positions (
        vh_id TEXT PRIMARY KEY,
        name TEXT,
        diocese TEXT,
        state TEXT,
        organization TEXT,
        position_type TEXT,
        receiving_from TEXT,
        receiving_to TEXT,
        updated_on_hub TEXT,
        status TEXT DEFAULT 'active',
        scraped_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS scraper_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Upsert positions that have a vh_id into scraped_positions
    const upsertPosition = db.prepare(`
      INSERT INTO scraped_positions (
        vh_id, name, diocese, state, organization, position_type,
        receiving_from, receiving_to, updated_on_hub, status, scraped_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(vh_id) DO UPDATE SET
        name = excluded.name,
        diocese = excluded.diocese,
        state = excluded.state,
        organization = excluded.organization,
        position_type = excluded.position_type,
        receiving_from = excluded.receiving_from,
        receiving_to = excluded.receiving_to,
        updated_on_hub = excluded.updated_on_hub,
        status = excluded.status,
        scraped_at = excluded.scraped_at
    `);

    let exported = 0;
    let skipped = 0;

    const insertAll = db.transaction(() => {
      for (const pos of positions) {
        const vhId = pos.vh_id;
        if (!vhId) {
          skipped++;
          continue;
        }

        upsertPosition.run(
          String(vhId),
          (pos.name as string) || null,
          (pos.diocese as string) || null,
          (pos.state as string) || null,
          // organization_type in scraper positions -> organization in scraped_positions
          (pos.organization_type as string) || null,
          (pos.position_type as string) || null,
          // receiving_names_from -> receiving_from
          (pos.receiving_names_from as string) || null,
          // receiving_names_to -> receiving_to
          (pos.receiving_names_to as string) || null,
          (pos.updated_on_hub as string) || null,
          (pos.status as string) || 'active'
        );
        exported++;
      }
    });

    insertAll();

    // Upsert metadata blobs into scraper_meta
    const upsertMeta = db.prepare(`
      INSERT INTO scraper_meta (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    upsertMeta.run('changes', JSON.stringify(changes));
    upsertMeta.run('meta', JSON.stringify(meta));
    upsertMeta.run('profile_fields', JSON.stringify(profileFields));
    upsertMeta.run('all_profiles', JSON.stringify(allProfiles));

    logger.info('DB export complete', {
      exported,
      skipped,
      metaKeys: 4,
    });
  } finally {
    db.close();
  }
}
