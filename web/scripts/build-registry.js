#!/usr/bin/env node
/**
 * Build the canonical church registry by merging church directory data
 * (from Episcopal Asset Map) with parochial report data (from General Convention).
 *
 * Output: web/public/data/church-registry.json
 * Keyed by Asset Map NID for O(1) lookup.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../public/data');

function load(name) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// --- Diocese normalization ---

function normalizeDiocese(diocese) {
  return diocese
    .toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/^episcopal\s+church\s+(in\s+)?/i, '')
    .replace(/^episcopal\s+diocese\s+(of\s+)?/i, '')
    .replace(/^diocese\s+of\s+/i, '')
    .replace(/^diocesis\s+de\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Church name normalization ---

function normalizeChurchName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\bsaints?\b/g, 'st')
    .replace(/\bsts\.?\s/g, 'st ')
    .replace(/\bst\.\s*/g, 'st ')
    .replace(/\bmount\b/g, 'mt')
    .replace(/\bmt\.\s*/g, 'mt ')
    .replace(/\s*\/.*$/, '')
    .replace(/['\u2018\u2019`]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/,.*$/, '')
    .replace(/-/g, ' ')
    .replace(/\b(the|of|and|in|at|for|a|an|be)\b/g, '')
    .replace(/\b(episcopal|church|parish|community|chapel|cathedral|mission|memorial)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/([a-z]{4,})s\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Parochial name parsing ---
// Parochial records use format: "Church Name (City)"

function parseParochialName(congregationCity) {
  const m = congregationCity.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) return { name: m[1].trim(), city: m[2].trim() };
  return { name: congregationCity.trim(), city: '' };
}

// --- Build parochial index by diocese ---

function buildParochialIndex(congregations) {
  const index = new Map();
  for (const cong of congregations) {
    const key = normalizeDiocese(cong.diocese);
    const list = index.get(key) || [];
    list.push(cong);
    index.set(key, list);
  }
  return index;
}

// --- Match a church to its parochial record ---
// Uses strict matching only: exact normalized name + city match

function matchParochialForChurch(church, parochialIdx) {
  const dioceseKey = normalizeDiocese(church.diocese);
  const candidates = parochialIdx.get(dioceseKey) || [];
  if (candidates.length === 0) return null;

  const churchNorm = normalizeChurchName(church.name);
  const churchCity = (church.city || '').toLowerCase().trim();

  // Strategy 1: Exact normalized name + city match
  for (const cong of candidates) {
    const { name: congName, city: congCity } = parseParochialName(cong.congregationCity);
    const congNorm = normalizeChurchName(congName);
    const congCityLower = congCity.toLowerCase().trim();

    if (churchNorm === congNorm && churchCity && congCityLower && churchCity === congCityLower) {
      return cong;
    }
  }

  // Strategy 2: Exact normalized name match (no city required, but only if unique)
  const nameMatches = [];
  for (const cong of candidates) {
    const { name: congName } = parseParochialName(cong.congregationCity);
    if (normalizeChurchName(congName) === churchNorm) {
      nameMatches.push(cong);
    }
  }
  if (nameMatches.length === 1) return nameMatches[0];

  // Strategy 3: Name match with city contained in church name or address
  if (nameMatches.length > 1 && churchCity) {
    const cityFiltered = nameMatches.filter(cong => {
      const { city: congCity } = parseParochialName(cong.congregationCity);
      return congCity.toLowerCase().trim() === churchCity;
    });
    if (cityFiltered.length === 1) return cityFiltered[0];
  }

  return null;
}

// --- Main ---

function main() {
  const churchesData = load('churches.json');
  const parochialData = load('parochial-data.json');

  if (!churchesData) {
    console.error('No churches.json found');
    process.exit(1);
  }

  const churches = churchesData.churches;
  console.log(`Loaded ${churches.length} churches from directory`);

  const parochialIdx = parochialData
    ? buildParochialIndex(parochialData.congregations)
    : new Map();
  console.log(`Loaded ${parochialData ? parochialData.congregations.length : 0} parochial records`);

  // Build registry keyed by NID
  const registry = {};
  let parochialMatched = 0;
  let parochialUsed = new Set();

  for (const church of churches) {
    const parochial = matchParochialForChurch(church, parochialIdx);
    if (parochial) {
      parochialMatched++;
      parochialUsed.add(parochial.congregationCity + '|' + parochial.diocese);
    }

    registry[String(church.nid)] = {
      nid: church.nid,
      name: church.name,
      diocese: church.diocese,
      street: church.street,
      city: church.city,
      state: church.state,
      zip: church.zip,
      phone: church.phone,
      email: church.email,
      website: church.website,
      type: church.type,
      lat: church.lat,
      lng: church.lng,
      parochial: parochial
        ? { congregationCity: parochial.congregationCity, years: parochial.years }
        : null,
    };
  }

  // Stats
  const unmatchedParochial = parochialData
    ? parochialData.congregations.filter(c => !parochialUsed.has(c.congregationCity + '|' + c.diocese)).length
    : 0;

  console.log(`\nRegistry built: ${Object.keys(registry).length} entries`);
  console.log(`  Parochial matched: ${parochialMatched} of ${churches.length} churches`);
  console.log(`  Unmatched parochial records: ${unmatchedParochial} of ${parochialData ? parochialData.congregations.length : 0}`);

  // Write registry
  const output = {
    meta: {
      lastUpdated: new Date().toISOString(),
      totalChurches: Object.keys(registry).length,
      withParochial: parochialMatched,
    },
    churches: registry,
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'church-registry.json'),
    JSON.stringify(output, null, 2)
  );

  console.log(`\nWritten to church-registry.json`);
}

main();
