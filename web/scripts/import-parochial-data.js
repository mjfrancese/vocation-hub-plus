/**
 * Imports parochial-data.json into the parochial_data table.
 *
 * Usage:
 *   node scripts/import-parochial-data.js
 *
 * Reads public/data/parochial-data.json and upserts every
 * congregation/year combination into parochial_data.
 */

const path = require('path');
const fs = require('fs');
const { getDb, closeDb, logFetch } = require('./db.js');

/**
 * Import parochial report data into the database.
 * @param {object} data - parochial-data.json-shaped object
 * @returns {{ total: number, new: number, updated: number, duration_ms: number, status: string }}
 */
function importParochialData(data) {
  const start = Date.now();
  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO parochial_data (parish_nid, year, average_attendance, plate_and_pledge, membership, operating_revenue)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(parish_nid, year) DO UPDATE SET
      average_attendance = excluded.average_attendance,
      plate_and_pledge = excluded.plate_and_pledge,
      membership = excluded.membership,
      operating_revenue = excluded.operating_revenue
  `);

  // Grab existing keys to distinguish new vs updated
  const existingKeys = new Set(
    db.prepare('SELECT parish_nid || \'|\' || year AS k FROM parochial_data').all().map(r => r.k)
  );

  let total = 0;
  let newCount = 0;
  let updated = 0;

  const runAll = db.transaction(() => {
    for (const congregation of (data.congregations || [])) {
      const nid = congregation.congregationCity;
      if (!nid) continue;

      for (const [yearStr, yearData] of Object.entries(congregation.years || {})) {
        const year = parseInt(yearStr, 10);
        const key = `${nid}|${year}`;

        upsert.run(
          nid,
          year,
          yearData.averageAttendance ?? null,
          yearData.plateAndPledge ?? null,
          yearData.membership ?? null,
          yearData.operatingRevenue ?? null
        );

        if (existingKeys.has(key)) {
          updated++;
        } else {
          newCount++;
        }
        total++;
      }
    }
  });

  runAll();

  const duration_ms = Date.now() - start;
  const stats = {
    total,
    new: newCount,
    updated,
    duration_ms,
    status: 'success',
  };

  logFetch('parochial_data', {
    records_total: stats.total,
    records_new: stats.new,
    records_updated: stats.updated,
    duration_ms: stats.duration_ms,
    status: stats.status,
  });

  return stats;
}

// CLI entry point
if (require.main === module) {
  const jsonPath = path.resolve(__dirname, '../public/data/parochial-data.json');
  if (!fs.existsSync(jsonPath)) {
    console.log(`${jsonPath} not found -- skipping parochial import (run parochial scraper first)`);
    process.exit(0);
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`Importing ${data.congregations?.length ?? 0} congregations...`);

  const stats = importParochialData(data);
  console.log('Import complete:', stats);

  closeDb();
}

module.exports = { importParochialData };
