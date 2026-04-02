const { getDb, closeDb } = require('./db.js');

function seedFromExistingMerges(db) {
  const bothParishes = db.prepare(
    `SELECT nid, ecdplus_id FROM parishes
     WHERE source = 'both' AND nid IS NOT NULL AND ecdplus_id IS NOT NULL`
  ).all();

  const checkExisting = db.prepare(
    'SELECT 1 FROM parish_identity WHERE nid = ? AND ecdplus_id = ?'
  );
  const insertIdentity = db.prepare(
    `INSERT INTO parish_identity (nid, ecdplus_id, confidence, match_method, confirmed_at)
     VALUES (?, ?, 'confirmed', 'existing_merge', datetime('now'))`
  );

  let seeded = 0;
  let skipped = 0;

  const run = db.transaction(() => {
    for (const { nid, ecdplus_id } of bothParishes) {
      if (checkExisting.get(nid, ecdplus_id)) {
        skipped++;
        continue;
      }
      insertIdentity.run(nid, ecdplus_id);
      seeded++;
    }
  });

  run();
  console.log(`Seeded ${seeded} identity records from existing merges (${skipped} already existed)`);
  return { seeded, skipped };
}

module.exports = { seedFromExistingMerges };

if (require.main === module) {
  const db = getDb();
  seedFromExistingMerges(db);
  closeDb();
}
