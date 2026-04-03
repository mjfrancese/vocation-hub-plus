/**
 * Import deep-scrape profile data into scraper_meta in vocationhub.db.
 *
 * The deep scrape workflow produces chunk JSON files in data/profiles/ and
 * merge-profiles.ts writes a flattened all-profiles.json. This script reads
 * the raw chunk files (preserving the {id, fields} format that
 * run-enrichment.js knows how to flatten) and upserts them into the
 * scraper_meta table so the enrichment pipeline can build extended positions.
 *
 * It also builds a profile_fields map (vh_id -> fields[]) used by the
 * frontend for per-position field display.
 *
 * Usage: node web/scripts/import-deep-scrape-profiles.js
 */

const fs = require('fs');
const path = require('path');
const { getDb, closeDb } = require('./db');

const PROFILES_DIR = path.resolve(__dirname, '../../data/profiles');

function importProfiles() {
  const db = getDb();

  try {
    if (!fs.existsSync(PROFILES_DIR)) {
      console.log('No profiles directory found at', PROFILES_DIR);
      return;
    }

    // Load all profile chunks (raw format: {id, url, fields, fullText})
    const allProfiles = [];
    const seen = new Set();

    const chunkFiles = fs.readdirSync(PROFILES_DIR)
      .filter(f => f.startsWith('chunk-') && f.endsWith('.json'))
      .sort();

    for (const file of chunkFiles) {
      const data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), 'utf-8'));
      for (const profile of data.profiles) {
        if (!seen.has(profile.id)) {
          seen.add(profile.id);
          allProfiles.push(profile);
        }
      }
    }

    console.log(`Loaded ${allProfiles.length} profiles from ${chunkFiles.length} chunks`);

    if (allProfiles.length === 0) {
      console.log('No profiles to import.');
      return;
    }

    // Build profile_fields map: vh_id -> fields[]
    const profileFields = {};
    for (const p of allProfiles) {
      if (p.id && p.fields) {
        profileFields[p.id] = p.fields;
      }
    }

    // Upsert into scraper_meta
    const upsert = db.prepare(`
      INSERT INTO scraper_meta (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    db.transaction(() => {
      upsert.run('all_profiles', JSON.stringify(allProfiles));
      upsert.run('profile_fields', JSON.stringify(profileFields));
    })();

    console.log(`Imported ${allProfiles.length} profiles and ${Object.keys(profileFields).length} profile field maps into scraper_meta`);
  } finally {
    closeDb();
  }
}

importProfiles();
