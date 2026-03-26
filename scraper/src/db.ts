import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { RawPosition } from './scrape-results.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dir = path.dirname(CONFIG.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(CONFIG.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  logger.info('Database initialized', { path: CONFIG.dbPath });
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      diocese TEXT NOT NULL,
      state TEXT NOT NULL,
      organization_type TEXT NOT NULL DEFAULT '',
      position_type TEXT NOT NULL DEFAULT '',
      receiving_names_from TEXT NOT NULL DEFAULT '',
      receiving_names_to TEXT NOT NULL DEFAULT '',
      updated_on_hub TEXT NOT NULL DEFAULT '',
      first_seen DATETIME NOT NULL DEFAULT (datetime('now')),
      last_seen DATETIME NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'new',
      details_url TEXT NOT NULL DEFAULT '',
      raw_html TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS scrape_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scraped_at DATETIME NOT NULL DEFAULT (datetime('now')),
      total_found INTEGER NOT NULL DEFAULT 0,
      new_count INTEGER NOT NULL DEFAULT 0,
      expired_count INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success',
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS position_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      changed_at DATETIME NOT NULL DEFAULT (datetime('now')),
      details TEXT,
      FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
    CREATE INDEX IF NOT EXISTS idx_positions_state ON positions(state);
    CREATE INDEX IF NOT EXISTS idx_positions_diocese ON positions(diocese);
    CREATE INDEX IF NOT EXISTS idx_positions_first_seen ON positions(first_seen);
    CREATE INDEX IF NOT EXISTS idx_positions_last_seen ON positions(last_seen);
    CREATE INDEX IF NOT EXISTS idx_changes_type ON position_changes(change_type);
  `);
}

export function upsertPosition(position: RawPosition): 'new' | 'updated' | 'unchanged' {
  const d = getDb();
  const now = new Date().toISOString();

  const existing = d.prepare('SELECT * FROM positions WHERE id = ?').get(position.id) as
    | Record<string, unknown>
    | undefined;

  if (!existing) {
    d.prepare(
      `INSERT INTO positions (id, name, diocese, state, organization_type, position_type,
        receiving_names_from, receiving_names_to, updated_on_hub, first_seen, last_seen,
        status, details_url, raw_html)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`
    ).run(
      position.id,
      position.name,
      position.diocese,
      position.state,
      position.organizationType,
      position.positionType,
      position.receivingNamesFrom,
      position.receivingNamesTo,
      position.updatedOnHub,
      now,
      now,
      position.detailsUrl,
      position.rawHtml
    );
    return 'new';
  }

  // Check for changes
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const fields: Array<[string, string, unknown]> = [
    ['name', 'name', position.name],
    ['diocese', 'diocese', position.diocese],
    ['state', 'state', position.state],
    ['organization_type', 'organizationType', position.organizationType],
    ['position_type', 'positionType', position.positionType],
    ['receiving_names_from', 'receivingNamesFrom', position.receivingNamesFrom],
    ['receiving_names_to', 'receivingNamesTo', position.receivingNamesTo],
    ['updated_on_hub', 'updatedOnHub', position.updatedOnHub],
  ];

  for (const [dbCol, , newVal] of fields) {
    if (existing[dbCol] !== newVal) {
      changes[dbCol] = { before: existing[dbCol], after: newVal };
    }
  }

  const hasChanges = Object.keys(changes).length > 0;
  const wasExpired = existing.status === 'expired';

  d.prepare(
    `UPDATE positions SET
      name = ?, diocese = ?, state = ?, organization_type = ?, position_type = ?,
      receiving_names_from = ?, receiving_names_to = ?, updated_on_hub = ?,
      last_seen = ?, status = ?, details_url = ?, raw_html = ?
     WHERE id = ?`
  ).run(
    position.name,
    position.diocese,
    position.state,
    position.organizationType,
    position.positionType,
    position.receivingNamesFrom,
    position.receivingNamesTo,
    position.updatedOnHub,
    now,
    wasExpired ? 'active' : (existing.status as string),
    position.detailsUrl,
    position.rawHtml,
    position.id
  );

  if (wasExpired) {
    recordChange(position.id, 'reappeared', null);
  }
  if (hasChanges) {
    recordChange(position.id, 'updated', JSON.stringify(changes));
    return 'updated';
  }

  return 'unchanged';
}

export function markExpired(currentIds: Set<string>): number {
  const d = getDb();
  const activePositions = d
    .prepare("SELECT id FROM positions WHERE status IN ('active', 'new')")
    .all() as Array<{ id: string }>;

  let expiredCount = 0;

  for (const pos of activePositions) {
    if (!currentIds.has(pos.id)) {
      d.prepare("UPDATE positions SET status = 'expired' WHERE id = ?").run(pos.id);
      recordChange(pos.id, 'expired', null);
      expiredCount++;
    }
  }

  return expiredCount;
}

export function promoteNewToActive(): void {
  const d = getDb();
  // Positions that have been seen more than once are no longer "new"
  d.prepare(
    "UPDATE positions SET status = 'active' WHERE status = 'new' AND first_seen != last_seen"
  ).run();
}

function recordChange(positionId: string, changeType: string, details: string | null): void {
  const d = getDb();
  d.prepare(
    'INSERT INTO position_changes (position_id, change_type, details) VALUES (?, ?, ?)'
  ).run(positionId, changeType, details);
}

export function logScrape(
  totalFound: number,
  newCount: number,
  expiredCount: number,
  durationMs: number,
  status: string,
  error?: string
): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO scrape_log (total_found, new_count, expired_count, duration_ms, status, error)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(totalFound, newCount, expiredCount, durationMs, status, error || null);
}

export function getAllPositions(): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM positions ORDER BY last_seen DESC').all() as Record<
    string,
    unknown
  >[];
}

export function getRecentChanges(limit: number = 100): Record<string, unknown>[] {
  return getDb()
    .prepare(
      `SELECT c.*, p.name, p.diocese, p.position_type
       FROM position_changes c
       JOIN positions p ON c.position_id = p.id
       ORDER BY c.changed_at DESC
       LIMIT ?`
    )
    .all(limit) as Record<string, unknown>[];
}

export function getScrapeStats(): Record<string, unknown> | undefined {
  return getDb()
    .prepare('SELECT * FROM scrape_log ORDER BY scraped_at DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database closed');
  }
}
