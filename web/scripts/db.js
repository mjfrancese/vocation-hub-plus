/**
 * Database module for vocationhub.db
 *
 * Provides a singleton better-sqlite3 connection with full schema
 * initialization. All data-pipeline scripts import from here.
 *
 * DB path: VOCATIONHUB_DB_PATH env var, or ../data/vocationhub.db
 * relative to cwd.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;
let resolvedPath = null;

/**
 * Returns (or creates) a singleton better-sqlite3 Database instance.
 * Sets WAL mode, foreign_keys ON, and initializes the schema.
 */
function getDb() {
  if (db) return db;

  const raw = process.env.VOCATIONHUB_DB_PATH || path.resolve(process.cwd(), '../data/vocationhub.db');
  resolvedPath = path.resolve(raw);

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  return db;
}

/** Closes the DB and resets the singleton so getDb() creates a fresh one. */
function closeDb() {
  if (db) {
    db.close();
    db = null;
    resolvedPath = null;
  }
}

/** Returns the resolved DB file path. */
function getDbPath() {
  return resolvedPath;
}

/**
 * Insert a row into fetch_log to record the outcome of a data fetch.
 * @param {string} source - identifier for the data source (e.g. 'asset-map', 'ecdplus')
 * @param {object} stats
 */
function logFetch(source, stats) {
  const d = getDb();
  d.prepare(
    `INSERT INTO fetch_log (source, records_total, records_new, records_updated, duration_ms, status, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    source,
    stats.records_total ?? 0,
    stats.records_new ?? 0,
    stats.records_updated ?? 0,
    stats.duration_ms ?? 0,
    stats.status ?? 'success',
    stats.error ?? null
  );
}

/**
 * Create all tables and indexes using CREATE IF NOT EXISTS.
 * @param {import('better-sqlite3').Database} database
 */
function initSchema(database) {
  database.exec(`
    -- ============================================================
    -- Parishes
    -- ============================================================
    CREATE TABLE IF NOT EXISTS parishes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ecdplus_id TEXT,
      nid TEXT,
      name TEXT NOT NULL,
      diocese TEXT NOT NULL,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      phone TEXT,
      email TEXT,
      website TEXT,
      type TEXT,
      lat REAL,
      lng REAL,
      ecdplus_clergy_count INTEGER,
      maps_link TEXT,
      source TEXT NOT NULL,
      field_sources TEXT,
      asset_map_updated_at DATETIME,
      ecdplus_updated_at DATETIME,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_parishes_ecdplus_id
      ON parishes(ecdplus_id) WHERE ecdplus_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_parishes_nid
      ON parishes(nid) WHERE nid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_parishes_diocese ON parishes(diocese);
    CREATE INDEX IF NOT EXISTS idx_parishes_state ON parishes(state);
    CREATE INDEX IF NOT EXISTS idx_parishes_name_diocese ON parishes(name, diocese);

    -- ============================================================
    -- Parish aliases (for fuzzy matching across sources)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS parish_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parish_id INTEGER NOT NULL,
      alias TEXT,
      alias_normalized TEXT,
      source TEXT,
      FOREIGN KEY (parish_id) REFERENCES parishes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_parish_aliases_normalized ON parish_aliases(alias_normalized);

    -- ============================================================
    -- Clergy
    -- ============================================================
    CREATE TABLE IF NOT EXISTS clergy (
      guid TEXT PRIMARY KEY,
      first_name TEXT,
      middle_name TEXT,
      last_name TEXT,
      suffix TEXT,
      email TEXT,
      canonical_residence TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      country TEXT,
      diaconate_date TEXT,
      diaconate_bishop TEXT,
      diaconate_diocese TEXT,
      priesting_date TEXT,
      priesting_bishop TEXT,
      priesting_diocese TEXT,
      bishop_consecration_date TEXT,
      bishop_consecration_diocese TEXT,
      fetched_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_clergy_canonical_residence ON clergy(canonical_residence);
    CREATE INDEX IF NOT EXISTS idx_clergy_last_name ON clergy(last_name);

    -- ============================================================
    -- Clergy positions
    -- ============================================================
    CREATE TABLE IF NOT EXISTS clergy_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clergy_guid TEXT NOT NULL,
      parish_id INTEGER,
      position_title TEXT,
      employer_name TEXT,
      employer_id TEXT,
      employer_address TEXT,
      employer_phone TEXT,
      start_date TEXT,
      end_date TEXT,
      is_current INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (clergy_guid) REFERENCES clergy(guid),
      FOREIGN KEY (parish_id) REFERENCES parishes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_clergy_positions_clergy ON clergy_positions(clergy_guid);
    CREATE INDEX IF NOT EXISTS idx_clergy_positions_parish ON clergy_positions(parish_id);
    CREATE INDEX IF NOT EXISTS idx_clergy_positions_current ON clergy_positions(is_current) WHERE is_current = 1;

    -- ============================================================
    -- Compensation data (CPG)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS compensation_diocesan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER,
      diocese TEXT,
      province TEXT,
      female_median REAL,
      female_count INTEGER,
      male_median REAL,
      male_count INTEGER,
      all_median REAL,
      all_count INTEGER,
      UNIQUE(year, diocese)
    );

    CREATE INDEX IF NOT EXISTS idx_comp_diocesan_year ON compensation_diocesan(year);
    CREATE INDEX IF NOT EXISTS idx_comp_diocesan_diocese ON compensation_diocesan(diocese);

    CREATE TABLE IF NOT EXISTS compensation_by_asa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER,
      gender TEXT,
      asa_category TEXT,
      median REAL,
      count INTEGER,
      UNIQUE(year, gender, asa_category)
    );

    CREATE TABLE IF NOT EXISTS compensation_by_position (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER,
      gender TEXT,
      position_type TEXT,
      median REAL,
      count INTEGER,
      UNIQUE(year, gender, position_type)
    );

    CREATE TABLE IF NOT EXISTS compensation_by_experience (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER,
      gender TEXT,
      service_bracket TEXT,
      median REAL,
      count INTEGER,
      UNIQUE(year, gender, service_bracket)
    );

    CREATE TABLE IF NOT EXISTS compensation_by_revenue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER,
      gender TEXT,
      revenue_bracket TEXT,
      median REAL,
      count INTEGER,
      UNIQUE(year, gender, revenue_bracket)
    );

    -- ============================================================
    -- Parochial report data
    -- ============================================================
    CREATE TABLE IF NOT EXISTS parochial_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parish_nid TEXT,
      year INTEGER,
      average_attendance INTEGER,
      plate_and_pledge REAL,
      membership INTEGER,
      operating_revenue REAL,
      UNIQUE(parish_nid, year)
    );

    CREATE INDEX IF NOT EXISTS idx_parochial_parish ON parochial_data(parish_nid);

    -- ============================================================
    -- Fetch log (audit trail for data pipeline runs)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS fetch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT,
      fetched_at DATETIME DEFAULT (datetime('now')),
      records_total INTEGER,
      records_new INTEGER,
      records_updated INTEGER,
      duration_ms INTEGER,
      status TEXT DEFAULT 'success',
      error TEXT
    );

    -- ============================================================
    -- Clergy tokens (HMAC tokens for personal benchmarking)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS clergy_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      clergy_guid TEXT NOT NULL REFERENCES clergy(guid),
      claimed_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_clergy_tokens_guid ON clergy_tokens(clergy_guid);

    -- ============================================================
    -- Scraped positions (raw data from VocationHub scraper)
    -- ============================================================
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
      status TEXT,
      scraped_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- Scraper metadata (key/value store for scraper state)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS scraper_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- Parish identity (links nid to ecdplus_id)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS parish_identity (
      nid TEXT NOT NULL,
      ecdplus_id TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'auto',
      match_method TEXT NOT NULL,
      confirmed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (nid, ecdplus_id)
    );

    CREATE INDEX IF NOT EXISTS idx_parish_identity_nid ON parish_identity(nid);
    CREATE INDEX IF NOT EXISTS idx_parish_identity_ecdplus ON parish_identity(ecdplus_id);

    -- ============================================================
    -- Census data (ZIP-level demographic data)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS census_data (
      zip TEXT PRIMARY KEY,
      median_income INTEGER,
      population INTEGER,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

module.exports = { getDb, closeDb, getDbPath, logFetch };
