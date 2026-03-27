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

    CREATE TABLE IF NOT EXISTS position_details (
      position_id TEXT PRIMARY KEY,
      vh_id INTEGER,
      profile_url TEXT NOT NULL DEFAULT '',
      community_name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      state_province TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      contact_phone TEXT NOT NULL DEFAULT '',
      position_title TEXT NOT NULL DEFAULT '',
      full_part_time TEXT NOT NULL DEFAULT '',
      position_description TEXT NOT NULL DEFAULT '',
      minimum_stipend TEXT NOT NULL DEFAULT '',
      maximum_stipend TEXT NOT NULL DEFAULT '',
      housing_type TEXT NOT NULL DEFAULT '',
      housing_description TEXT NOT NULL DEFAULT '',
      benefits TEXT NOT NULL DEFAULT '',
      community_description TEXT NOT NULL DEFAULT '',
      worship_style TEXT NOT NULL DEFAULT '',
      avg_sunday_attendance TEXT NOT NULL DEFAULT '',
      church_school_size TEXT NOT NULL DEFAULT '',
      desired_skills TEXT NOT NULL DEFAULT '',
      challenges TEXT NOT NULL DEFAULT '',
      website_url TEXT NOT NULL DEFAULT '',
      social_media_links TEXT NOT NULL DEFAULT '',
      narrative_reflections TEXT NOT NULL DEFAULT '',
      raw_content TEXT NOT NULL DEFAULT '',
      scraped_at DATETIME NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_details_vh_id ON position_details(vh_id);

    CREATE TABLE IF NOT EXISTS position_detail_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id TEXT NOT NULL,
      vh_id INTEGER,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_detail_history_position ON position_detail_history(position_id);
    CREATE INDEX IF NOT EXISTS idx_detail_history_date ON position_detail_history(changed_at);
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

export function upsertPositionDetails(details: import('./position-details.js').PositionDetails): void {
  const d = getDb();

  // Match this profile to a position in the positions table by name + diocese.
  let positionId = '';
  const match = d.prepare(
    `SELECT id FROM positions
     WHERE (name LIKE ? OR name LIKE ?)
     AND diocese LIKE ?
     LIMIT 1`
  ).get(
    `%${details.communityName}%`,
    `%${details.communityName.split('(')[0].trim()}%`,
    `%${details.diocese}%`
  ) as { id: string } | undefined;

  if (match) {
    positionId = match.id;
  } else {
    positionId = `vh_${details.positionId}`;
  }

  // Check for existing detail data to detect changes
  const existing = d.prepare(
    'SELECT * FROM position_details WHERE position_id = ?'
  ).get(positionId) as Record<string, unknown> | undefined;

  if (existing) {
    // Compare fields and record any changes
    const fieldsToTrack: Array<[string, string, unknown]> = [
      ['minimum_stipend', 'Minimum Stipend', details.minimumStipend],
      ['maximum_stipend', 'Maximum Stipend', details.maximumStipend],
      ['housing_type', 'Housing Type', details.housingType],
      ['position_title', 'Position Title', details.positionTitle],
      ['full_part_time', 'Full/Part Time', details.fullPartTime],
      ['contact_name', 'Contact Name', details.contactName],
      ['contact_email', 'Contact Email', details.contactEmail],
      ['avg_sunday_attendance', 'Avg Sunday Attendance', details.avgSundayAttendance],
      ['community_name', 'Community Name', details.communityName],
      ['position_description', 'Position Description', details.positionDescription],
      ['desired_skills', 'Desired Skills', details.desiredSkills],
      ['benefits', 'Benefits', details.benefits],
    ];

    for (const [dbCol, label, newVal] of fieldsToTrack) {
      const oldVal = (existing[dbCol] as string) || '';
      const newStr = (newVal as string) || '';
      if (oldVal && newStr && oldVal !== newStr) {
        d.prepare(
          `INSERT INTO position_detail_history
           (position_id, vh_id, field_name, old_value, new_value)
           VALUES (?, ?, ?, ?, ?)`
        ).run(positionId, details.positionId, label, oldVal, newStr);
      }
    }
  }

  d.prepare(`
    INSERT INTO position_details (
      position_id, vh_id, profile_url, community_name, address, city,
      state_province, postal_code, contact_name, contact_email, contact_phone,
      position_title, full_part_time, position_description,
      minimum_stipend, maximum_stipend, housing_type, housing_description, benefits,
      community_description, worship_style, avg_sunday_attendance, church_school_size,
      desired_skills, challenges, website_url, social_media_links,
      narrative_reflections, raw_content, scraped_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(position_id) DO UPDATE SET
      vh_id = excluded.vh_id,
      profile_url = excluded.profile_url,
      community_name = excluded.community_name,
      address = excluded.address,
      city = excluded.city,
      state_province = excluded.state_province,
      postal_code = excluded.postal_code,
      contact_name = excluded.contact_name,
      contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone,
      position_title = excluded.position_title,
      full_part_time = excluded.full_part_time,
      position_description = excluded.position_description,
      minimum_stipend = excluded.minimum_stipend,
      maximum_stipend = excluded.maximum_stipend,
      housing_type = excluded.housing_type,
      housing_description = excluded.housing_description,
      benefits = excluded.benefits,
      community_description = excluded.community_description,
      worship_style = excluded.worship_style,
      avg_sunday_attendance = excluded.avg_sunday_attendance,
      church_school_size = excluded.church_school_size,
      desired_skills = excluded.desired_skills,
      challenges = excluded.challenges,
      website_url = excluded.website_url,
      social_media_links = excluded.social_media_links,
      narrative_reflections = excluded.narrative_reflections,
      raw_content = excluded.raw_content,
      scraped_at = excluded.scraped_at
  `).run(
    positionId,
    details.positionId,
    details.profileUrl,
    details.communityName,
    details.address,
    details.city,
    details.stateProvince,
    details.postalCode,
    details.contactName,
    details.contactEmail,
    details.contactPhone,
    details.positionTitle,
    details.fullPartTime,
    details.positionDescription,
    details.minimumStipend,
    details.maximumStipend,
    details.housingType,
    details.housingDescription,
    details.benefits,
    details.communityDescription,
    details.worshipStyle,
    details.avgSundayAttendance,
    details.churchSchoolSize,
    details.desiredSkills,
    details.challenges,
    details.websiteUrl,
    details.socialMediaLinks,
    details.narrativeReflections,
    details.rawContent,
    details.scrapedAt
  );
}

export function getAllPositionsWithDetails(): Record<string, unknown>[] {
  return getDb().prepare(`
    SELECT p.*, d.vh_id, d.profile_url, d.community_name as detail_name,
           d.address, d.city, d.state_province, d.postal_code,
           d.contact_name, d.contact_email, d.contact_phone,
           d.position_title, d.full_part_time, d.position_description,
           d.minimum_stipend, d.maximum_stipend, d.housing_type,
           d.housing_description, d.benefits, d.community_description,
           d.worship_style, d.avg_sunday_attendance, d.church_school_size,
           d.desired_skills, d.challenges, d.website_url, d.social_media_links,
           d.narrative_reflections, d.raw_content
    FROM positions p
    LEFT JOIN position_details d ON p.id = d.position_id
    ORDER BY p.last_seen DESC
  `).all() as Record<string, unknown>[];
}

export function getDetailHistory(limit: number = 500): Record<string, unknown>[] {
  return getDb().prepare(`
    SELECT h.*, p.name, p.diocese
    FROM position_detail_history h
    LEFT JOIN positions p ON h.position_id = p.id
    ORDER BY h.changed_at DESC
    LIMIT ?
  `).all(limit) as Record<string, unknown>[];
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database closed');
  }
}
