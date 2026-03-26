-- Vocation Hub+ Database Schema
-- SQLite database for tracking Episcopal Church positions

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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_state ON positions(state);
CREATE INDEX IF NOT EXISTS idx_positions_diocese ON positions(diocese);
CREATE INDEX IF NOT EXISTS idx_positions_first_seen ON positions(first_seen);
CREATE INDEX IF NOT EXISTS idx_positions_last_seen ON positions(last_seen);
CREATE INDEX IF NOT EXISTS idx_changes_type ON position_changes(change_type);
