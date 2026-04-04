#!/usr/bin/env node
/**
 * Sync production data from GitHub Pages to local dev.
 *
 * Downloads all data JSON files from the deployed site so local development
 * uses the same data as production. Data flows one way: production -> local.
 *
 * Usage:
 *   node scripts/sync-data.js          # download all data files
 *   npm run sync-data                  # via package.json script
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_URL = 'https://vocationhub.plus/data';
const DATA_DIR = path.resolve(__dirname, '../public/data');

// Files produced by the enrichment pipeline and deployed to GitHub Pages.
// Manual/reference files (manual-mappings, manual-diocese-overrides, manual-vh-ids)
// are checked into git and should NOT be overwritten from production.
const DATA_FILES = [
  'enriched-positions.json',
  'enriched-extended.json',
  'positions.json',
  'changes.json',
  'meta.json',
  'all-profiles.json',
  'profile-fields.json',
  'position-church-map.json',
  'parochial-data.json',
  'church-registry.json',
  'clergy-tokens.json',
  'clergy-search-index.json',
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode === 404) {
        resolve(null); // File doesn't exist on production, skip
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  console.log('Syncing production data from vocationhub.plus...\n');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of DATA_FILES) {
    const url = `${BASE_URL}/${file}`;
    const dest = path.join(DATA_DIR, file);

    process.stdout.write(`  ${file} ... `);

    try {
      const data = await fetch(url);
      if (data === null) {
        console.log('not found (skipped)');
        skipped++;
        continue;
      }

      fs.writeFileSync(dest, data);
      console.log(`${formatSize(data.length)}`);
      downloaded++;
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed`);

  // Show meta info
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'meta.json'), 'utf8'));
    console.log(`\nProduction data: ${meta.totalPositions} positions, last scraped ${meta.lastScrape?.scraped_at || 'unknown'}`);
  } catch { /* ignore */ }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
