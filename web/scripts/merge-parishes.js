/**
 * merge-parishes.js
 *
 * Matches Asset Map parishes to ECDPlus parishes by phone, website, or
 * name+diocese. Merges matched records onto the Asset Map row, links
 * clergy_positions to the correct parish IDs, and flags uncertain matches.
 *
 * CommonJS module -- run directly or import mergeParishes(db).
 */

'use strict';

const { getDb, logFetch } = require('./db.js');
const {
  normalizeChurchName,
  normalizePhone,
  normalizeDomain,
} = require('./lib/normalization.js');

/**
 * Find a matching Asset Map parish for the given ECDPlus parish.
 *
 * Strategies tried in order:
 *   1. Phone match (same normalized phone + same diocese)
 *   2. Website match (same normalized domain)
 *   3. Name + diocese (via parish_aliases normalized names)
 *      - Single match = high confidence
 *      - Multiple matches = disambiguate by city
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} ecdParish - row from parishes table (source='ecdplus')
 * @returns {{ parish: object, method: string, confidence: string } | null}
 */
function findMatch(db, ecdParish) {
  // Strategy 1: Phone match
  const ecdPhone = normalizePhone(ecdParish.phone);
  if (ecdPhone) {
    const match = db.prepare(`
      SELECT * FROM parishes
      WHERE source IN ('asset_map', 'both')
        AND diocese = ?
        AND id != ?
    `).all(ecdParish.diocese, ecdParish.id);

    for (const row of match) {
      if (normalizePhone(row.phone) === ecdPhone) {
        return { parish: row, method: 'phone', confidence: 'exact' };
      }
    }
  }

  // Strategy 2: Website match
  const ecdDomain = normalizeDomain(ecdParish.website || '');
  if (ecdDomain) {
    const candidates = db.prepare(`
      SELECT * FROM parishes
      WHERE source IN ('asset_map', 'both')
        AND website IS NOT NULL AND website != ''
        AND id != ?
    `).all(ecdParish.id);

    for (const row of candidates) {
      if (normalizeDomain(row.website || '') === ecdDomain) {
        return { parish: row, method: 'website', confidence: 'exact' };
      }
    }
  }

  // Strategy 3: Name + diocese via parish_aliases
  const ecdNormalized = normalizeChurchName(ecdParish.name);
  if (ecdNormalized) {
    const aliasMatches = db.prepare(`
      SELECT p.* FROM parish_aliases pa
      JOIN parishes p ON p.id = pa.parish_id
      WHERE pa.alias_normalized = ?
        AND p.diocese = ?
        AND p.source IN ('asset_map', 'both')
        AND p.id != ?
    `).all(ecdNormalized, ecdParish.diocese, ecdParish.id);

    if (aliasMatches.length === 1) {
      return { parish: aliasMatches[0], method: 'name_diocese', confidence: 'high' };
    }

    if (aliasMatches.length > 1 && ecdParish.city) {
      const cityLower = ecdParish.city.toLowerCase();
      const cityMatch = aliasMatches.find(
        r => r.city && r.city.toLowerCase() === cityLower
      );
      if (cityMatch) {
        return { parish: cityMatch, method: 'name_diocese_city', confidence: 'high' };
      }
    }
  }

  return null;
}

/**
 * Run the full parish merge pipeline.
 *
 * 1. Find all ECDPlus-only parishes
 * 2. Attempt to match each to an Asset Map parish
 * 3. Merge matched records (update AM row, delete ECD row, reassign clergy)
 * 4. Link unlinked clergy_positions by employer_id -> ecdplus_id
 * 5. Log results
 *
 * @param {import('better-sqlite3').Database} [database]
 * @returns {{ merged: number, unmatched: number, linked: number }}
 */
function mergeParishes(database) {
  const db = database || getDb();
  const start = Date.now();

  let merged = 0;
  let unmatched = 0;

  // Get all ECDPlus-only parishes
  const ecdParishes = db.prepare("SELECT * FROM parishes WHERE source = 'ecdplus'").all();

  const updateAM = db.prepare(`
    UPDATE parishes SET
      ecdplus_id = ?,
      phone = COALESCE(NULLIF(?, ''), phone),
      email = COALESCE(NULLIF(?, ''), email),
      website = COALESCE(NULLIF(?, ''), website),
      address = COALESCE(NULLIF(?, ''), address),
      city = COALESCE(NULLIF(?, ''), city),
      state = COALESCE(NULLIF(?, ''), state),
      zip = COALESCE(NULLIF(?, ''), zip),
      ecdplus_clergy_count = ?,
      source = 'both',
      ecdplus_updated_at = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  const deleteEcd = db.prepare('DELETE FROM parishes WHERE id = ?');
  const deleteEcdAliases = db.prepare('DELETE FROM parish_aliases WHERE parish_id = ?');
  const reassignPositions = db.prepare('UPDATE clergy_positions SET parish_id = ? WHERE parish_id = ?');
  const insertAlias = db.prepare(`
    INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
    VALUES (?, ?, ?, 'ecdplus')
  `);

  const mergeOne = db.transaction((ecdRow, amRow) => {
    // Reassign clergy_positions from the old ECDPlus parish to the merged row
    // (must happen before deleting the ECDPlus row due to FK constraint)
    reassignPositions.run(amRow.id, ecdRow.id);

    // Delete ECDPlus aliases and the ECDPlus row itself
    // (must happen before updating AM row due to unique index on ecdplus_id)
    deleteEcdAliases.run(ecdRow.id);
    deleteEcd.run(ecdRow.id);

    // Update the Asset Map row with ECDPlus data (COALESCE preserves existing values)
    updateAM.run(
      ecdRow.ecdplus_id,
      ecdRow.phone || '',
      ecdRow.email || '',
      ecdRow.website || '',
      ecdRow.address || '',
      ecdRow.city || '',
      ecdRow.state || '',
      ecdRow.zip || '',
      ecdRow.ecdplus_clergy_count,
      ecdRow.ecdplus_updated_at,
      amRow.id
    );

    // Add ECDPlus name as an alias on the merged row
    const existingAlias = db.prepare(`
      SELECT 1 FROM parish_aliases WHERE parish_id = ? AND alias = ?
    `).get(amRow.id, ecdRow.name);
    if (!existingAlias) {
      insertAlias.run(amRow.id, ecdRow.name, normalizeChurchName(ecdRow.name));
    }
  });

  for (const ecdRow of ecdParishes) {
    const match = findMatch(db, ecdRow);
    if (match) {
      mergeOne(ecdRow, match.parish);
      merged++;
    } else {
      unmatched++;
    }
  }

  // Link unlinked clergy_positions by employer_id -> ecdplus_id
  const linked = db.prepare(`
    UPDATE clergy_positions SET parish_id = (
      SELECT p.id FROM parishes p WHERE p.ecdplus_id = clergy_positions.employer_id
    )
    WHERE parish_id IS NULL
      AND employer_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM parishes p WHERE p.ecdplus_id = clergy_positions.employer_id)
  `).run().changes;

  // Also link positions that have a parish_id but the employer_id maps to a different
  // (merged) parish -- this catches positions that were on non-merged ECDPlus parishes
  // but whose employer_id now points to a merged row.
  // (Already handled above in reassignPositions for merged parishes.)

  logFetch('merge_parishes', {
    records_total: ecdParishes.length,
    records_new: merged,
    records_updated: linked,
    duration_ms: Date.now() - start,
    status: 'success',
  });

  return { merged, unmatched, linked };
}

module.exports = { mergeParishes, findMatch };

// Run directly
if (require.main === module) {
  const stats = mergeParishes();
  console.log(`Merge complete: ${stats.merged} merged, ${stats.unmatched} unmatched, ${stats.linked} linked`);
}
