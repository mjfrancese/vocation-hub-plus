/**
 * confirm-parish-matches.js
 *
 * CLI tool for reviewing and confirming auto-matched parish identities.
 * Exports core functions for use in tests and other scripts.
 *
 * Usage:
 *   node confirm-parish-matches.js list
 *   node confirm-parish-matches.js stats
 *   node confirm-parish-matches.js confirm <nid> <ecdplus_id>
 *   node confirm-parish-matches.js reject <nid> <ecdplus_id>
 *   node confirm-parish-matches.js confirm-all
 */

const { getDb, closeDb } = require('./db.js');

/**
 * Returns unconfirmed (confidence='auto') parish identity matches,
 * joined with parish details from both sources.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} limit
 * @returns {Array}
 */
function getUnconfirmedMatches(db, limit = 50) {
  return db.prepare(`
    SELECT pi.nid, pi.ecdplus_id, pi.match_method, pi.created_at,
      am.name as asset_map_name, am.city as am_city, am.state as am_state,
      am.phone as am_phone, am.website as am_website,
      ec.name as ecdplus_name, ec.city as ec_city, ec.state as ec_state,
      ec.phone as ec_phone, ec.website as ec_website
    FROM parish_identity pi
    LEFT JOIN parishes am ON am.nid = pi.nid
    LEFT JOIN parishes ec ON ec.ecdplus_id = pi.ecdplus_id
    WHERE pi.confidence = 'auto'
    ORDER BY pi.created_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Marks a parish identity match as confirmed.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} nid
 * @param {string} ecdplusId
 */
function confirmMatch(db, nid, ecdplusId) {
  db.prepare(
    `UPDATE parish_identity SET confidence = 'confirmed', confirmed_at = datetime('now')
     WHERE nid = ? AND ecdplus_id = ?`
  ).run(nid, ecdplusId);
}

/**
 * Rejects a parish identity match by deleting the row.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} nid
 * @param {string} ecdplusId
 */
function rejectMatch(db, nid, ecdplusId) {
  db.prepare(
    'DELETE FROM parish_identity WHERE nid = ? AND ecdplus_id = ?'
  ).run(nid, ecdplusId);
}

/**
 * Returns counts of parish identity rows by confidence level.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ auto: number, confirmed: number, total: number }}
 */
function getStats(db) {
  const rows = db.prepare(
    'SELECT confidence, COUNT(*) as count FROM parish_identity GROUP BY confidence'
  ).all();
  const stats = { auto: 0, confirmed: 0, total: 0 };
  for (const row of rows) {
    stats[row.confidence] = row.count;
    stats.total += row.count;
  }
  return stats;
}

module.exports = { getUnconfirmedMatches, confirmMatch, rejectMatch, getStats };

if (require.main === module) {
  const db = getDb();
  const args = process.argv.slice(2);
  const command = args[0] || 'list';

  if (command === 'stats') {
    const stats = getStats(db);
    console.log('Parish identity stats:');
    console.log(`  Confirmed: ${stats.confirmed}`);
    console.log(`  Auto (unconfirmed): ${stats.auto}`);
    console.log(`  Total: ${stats.total}`);
  } else if (command === 'list') {
    const matches = getUnconfirmedMatches(db);
    if (matches.length === 0) {
      console.log('No unconfirmed matches to review.');
    } else {
      console.log(`${matches.length} unconfirmed matches:\n`);
      for (const m of matches) {
        console.log(`  NID ${m.nid}: ${m.asset_map_name} (${m.am_city}, ${m.am_state})`);
        console.log(`    phone: ${m.am_phone || 'N/A'}  website: ${m.am_website || 'N/A'}`);
        console.log(`  ECD ${m.ecdplus_id}: ${m.ecdplus_name} (${m.ec_city}, ${m.ec_state})`);
        console.log(`    phone: ${m.ec_phone || 'N/A'}  website: ${m.ec_website || 'N/A'}`);
        console.log(`  Matched by: ${m.match_method}  on: ${m.created_at}`);
        console.log();
      }
    }
  } else if (command === 'confirm' && args[1] && args[2]) {
    confirmMatch(db, args[1], args[2]);
    console.log(`Confirmed: NID ${args[1]} = ECDPlus ${args[2]}`);
  } else if (command === 'reject' && args[1] && args[2]) {
    rejectMatch(db, args[1], args[2]);
    console.log(`Rejected: NID ${args[1]} / ECDPlus ${args[2]}`);
  } else if (command === 'confirm-all') {
    const matches = getUnconfirmedMatches(db, 10000);
    const run = db.transaction(() => {
      for (const m of matches) confirmMatch(db, m.nid, m.ecdplus_id);
    });
    run();
    console.log(`Confirmed ${matches.length} matches.`);
  } else {
    console.log('Usage:');
    console.log('  node confirm-parish-matches.js list         # Show unconfirmed matches');
    console.log('  node confirm-parish-matches.js stats        # Show counts');
    console.log('  node confirm-parish-matches.js confirm <nid> <ecdplus_id>');
    console.log('  node confirm-parish-matches.js reject <nid> <ecdplus_id>');
    console.log('  node confirm-parish-matches.js confirm-all  # Confirm all auto matches');
  }

  closeDb();
}
