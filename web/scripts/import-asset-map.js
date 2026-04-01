/**
 * Import Asset Map churches.json data into the parishes table.
 *
 * Usage:
 *   node import-asset-map.js            (reads public/data/churches.json)
 *
 * Or import and call programmatically:
 *   const { importAssetMap } = require('./import-asset-map');
 *   const stats = importAssetMap(jsonData);
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { getDb, logFetch } = require('./db');
const { normalizeChurchName } = require('./lib/normalization');

/**
 * Import churches.json-shaped data into the parishes table.
 * Performs upsert by nid (check-then-insert/update).
 *
 * @param {{ meta: object, churches: object[] }} data
 * @returns {{ total: number, new: number, updated: number, duration_ms: number, status: string }}
 */
function importAssetMap(data) {
  const start = Date.now();
  const db = getDb();

  const churches = (data.churches || []).filter(
    (c) => c.name && c.name.trim() !== ''
  );

  const insertParish = db.prepare(`
    INSERT INTO parishes (nid, name, diocese, address, city, state, zip, phone, email, website, type, lat, lng, source, asset_map_updated_at)
    VALUES (@nid, @name, @diocese, @address, @city, @state, @zip, @phone, @email, @website, @type, @lat, @lng, 'asset_map', datetime('now'))
  `);

  const updateParish = db.prepare(`
    UPDATE parishes SET
      name = @name,
      diocese = @diocese,
      address = @address,
      city = @city,
      state = @state,
      zip = @zip,
      phone = @phone,
      email = @email,
      website = @website,
      type = @type,
      lat = @lat,
      lng = @lng,
      asset_map_updated_at = datetime('now'),
      updated_at = datetime('now')
    WHERE nid = @nid
  `);

  const insertAlias = db.prepare(`
    INSERT INTO parish_aliases (parish_id, alias, alias_normalized, source)
    VALUES (?, ?, ?, 'asset_map')
  `);

  const deleteAliases = db.prepare(`
    DELETE FROM parish_aliases WHERE parish_id = ? AND source = 'asset_map'
  `);

  const findParish = db.prepare(`SELECT id FROM parishes WHERE nid = ?`);

  // Check which nids already exist before the transaction
  const existingNids = new Set();
  for (const c of churches) {
    const nid = String(c.nid);
    if (findParish.get(nid)) {
      existingNids.add(nid);
    }
  }

  let newCount = 0;
  let updatedCount = 0;

  const importAll = db.transaction(() => {
    for (const c of churches) {
      const nid = String(c.nid);
      const wasExisting = existingNids.has(nid);

      const params = {
        nid,
        name: c.name,
        diocese: c.diocese || '',
        address: c.street || null,
        city: c.city || null,
        state: c.state || null,
        zip: c.zip || null,
        phone: c.phone || null,
        email: c.email || null,
        website: c.website || null,
        type: c.type || null,
        lat: c.lat || null,
        lng: c.lng || null,
      };

      if (wasExisting) {
        updateParish.run(params);
        updatedCount++;
      } else {
        insertParish.run(params);
        newCount++;
      }

      // Get parish id for alias
      const parish = findParish.get(nid);
      // Remove old asset_map aliases and re-create
      deleteAliases.run(parish.id);
      insertAlias.run(
        parish.id,
        c.name,
        normalizeChurchName(c.name),
      );
    }
  });

  importAll();

  const duration_ms = Date.now() - start;
  const stats = {
    total: churches.length,
    new: newCount,
    updated: updatedCount,
    duration_ms,
    status: 'success',
  };

  logFetch('asset_map', {
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
  const filePath = path.resolve(__dirname, '../public/data/churches.json');
  if (!fs.existsSync(filePath)) {
    console.log(`${filePath} not found -- skipping Asset Map import (run church-directory scraper first)`);
    process.exit(0);
  }
  console.log(`Reading ${filePath}...`);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  console.log(`Found ${data.churches.length} churches in file.`);

  const stats = importAssetMap(data);
  console.log('Import complete:', stats);
  const { closeDb } = require('./db');
  closeDb();
}

module.exports = { importAssetMap };
