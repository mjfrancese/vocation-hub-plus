/**
 * Enrichment Stage: Attach Parochial
 *
 * For each position with matched parishes (church_infos), looks up parochial
 * report data (attendance, giving, membership, operating revenue) from the DB.
 *
 * Extracted from enrich-positions-v2.js.
 */

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a church name for fuzzy matching against parochial_data keys.
 *
 * Parochial data uses canonical names like "St Thomas Episcopal Church (Reidsville)"
 * while enriched church_infos may say "Saint Thomas Episcopal Church" or just
 * "Trinity Church". This function normalizes both sides so they can meet in the
 * middle.
 *
 *   - Lowercases
 *   - Strips punctuation (apostrophes, periods, commas, hyphens)
 *   - Normalizes "saint" / "st" to "st"
 *   - Collapses whitespace
 */
function normalizeChurchName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[''`.,-]/g, '')       // strip punctuation
    .replace(/\bsaint\b/g, 'st')   // saint -> st
    .replace(/\s+/g, ' ')          // collapse whitespace
    .trim();
}

/**
 * Query parochial_data rows for a given key (either a NID or a name string).
 * Returns { years: { '<year>': { ... } } } or null if no rows found.
 */
function lookupParochial(db, key) {
  if (!key) return null;
  const rows = db.prepare(
    'SELECT * FROM parochial_data WHERE parish_nid = ? ORDER BY year'
  ).all(String(key));

  if (rows.length === 0) return null;

  const years = {};
  for (const r of rows) {
    years[String(r.year)] = {
      averageAttendance: r.average_attendance,
      plateAndPledge: r.plate_and_pledge,
      membership: r.membership,
      operatingRevenue: r.operating_revenue,
    };
  }
  return { years };
}

/**
 * Build a normalized lookup index for fuzzy parochial matching.
 * Maps normalizedKey -> original parish_nid, grouped by city.
 *
 * Lazily initialized once per pipeline run and cached on the db object.
 */
function getParochialIndex(db) {
  if (db._parochialIndex) return db._parochialIndex;

  const nids = db.prepare(
    'SELECT DISTINCT parish_nid FROM parochial_data'
  ).all().map(r => r.parish_nid);

  // Two indexes: one for "name (city)" entries, one for name-only
  const byNormCity = new Map();   // "normalized_name|normalized_city" -> parish_nid
  const byNormName = new Map();   // "normalized_name" -> parish_nid[]

  const cityRe = /^(.+?)\s*\(([^)]+)\)\s*$/;

  for (const nid of nids) {
    const m = nid.match(cityRe);
    if (m) {
      const normName = normalizeChurchName(m[1]);
      const normCity = normalizeChurchName(m[2]);
      byNormCity.set(`${normName}|${normCity}`, nid);

      // Also index by name alone (first match wins for ambiguous names)
      if (!byNormName.has(normName)) byNormName.set(normName, []);
      byNormName.get(normName).push(nid);
    } else {
      const normName = normalizeChurchName(nid);
      if (!byNormName.has(normName)) byNormName.set(normName, []);
      byNormName.get(normName).push(nid);
    }
  }

  db._parochialIndex = { byNormCity, byNormName };
  return db._parochialIndex;
}

/**
 * Fuzzy lookup: try normalized name+city, then normalized name alone.
 * Falls back to the original exact-match lookup for NID-based keys.
 */
function fuzzyLookupParochial(db, name, city) {
  const idx = getParochialIndex(db);
  const normName = normalizeChurchName(name);

  // Strategy 1: normalized name + city (most precise)
  if (city) {
    const normCity = normalizeChurchName(city);
    const key = `${normName}|${normCity}`;
    const nid = idx.byNormCity.get(key);
    if (nid) return lookupParochial(db, nid);

    // Strategy 2: try adding common suffixes the enriched data may lack
    // e.g. "Trinity Church" -> "Trinity Episcopal Church"
    if (!normName.includes('episcopal')) {
      const withEpiscopal = normName.replace(/\bchurch\b/, 'episcopal church');
      const key2 = `${withEpiscopal}|${normCity}`;
      const nid2 = idx.byNormCity.get(key2);
      if (nid2) return lookupParochial(db, nid2);
    }
  }

  // Strategy 3: name-only (if there's exactly one match, use it)
  const nameMatches = idx.byNormName.get(normName);
  if (nameMatches && nameMatches.length === 1) {
    return lookupParochial(db, nameMatches[0]);
  }

  // Strategy 4: name with "episcopal" suffix, name-only
  if (!normName.includes('episcopal')) {
    const withEpiscopal = normName.replace(/\bchurch\b/, 'episcopal church');
    const matches2 = idx.byNormName.get(withEpiscopal);
    if (matches2 && matches2.length === 1) {
      return lookupParochial(db, matches2[0]);
    }
    // Also try with city
    if (city) {
      const normCity = normalizeChurchName(city);
      const key2 = `${withEpiscopal}|${normCity}`;
      const nid2 = idx.byNormCity.get(key2);
      if (nid2) return lookupParochial(db, nid2);
    }
  }

  // Strategy 5: "Parish" -> "Episcopal Church" and "Parish" -> "Episcopal Parish"
  if (normName.includes('parish') && !normName.includes('episcopal')) {
    const variants = [
      normName.replace(/\bparish\b/, 'episcopal church'),
      normName.replace(/\bparish\b/, 'episcopal parish'),
    ];
    for (const variant of variants) {
      if (city) {
        const normCity = normalizeChurchName(city);
        const nid = idx.byNormCity.get(`${variant}|${normCity}`);
        if (nid) return lookupParochial(db, nid);
      }
      const matches = idx.byNormName.get(variant);
      if (matches && matches.length === 1) {
        return lookupParochial(db, matches[0]);
      }
    }
  }

  // Strategy 6: "Church" -> "Episcopal Parish"
  if (normName.includes('church') && !normName.includes('episcopal')) {
    const asParish = normName.replace(/\bchurch\b/, 'episcopal parish');
    if (city) {
      const normCity = normalizeChurchName(city);
      const nid = idx.byNormCity.get(`${asParish}|${normCity}`);
      if (nid) return lookupParochial(db, nid);
    }
    const matches = idx.byNormName.get(asParish);
    if (matches && matches.length === 1) {
      return lookupParochial(db, matches[0]);
    }
  }

  // Strategy 7: try dropping/adding trailing 's' on saint names
  // e.g. "St Peters" -> "St Peter" or "St John" -> "St Johns"
  if (city) {
    const normCity = normalizeChurchName(city);
    const saintVariant = /\bst (\w+?)s\b/.test(normName)
      ? normName.replace(/\bst (\w+?)s\b/, 'st $1')   // drop trailing s
      : normName.replace(/\bst (\w+)\b/, 'st $1s');    // add trailing s

    if (saintVariant !== normName) {
      // Try all the same Church/Episcopal Church/Parish combos
      const variants = [saintVariant];
      if (!saintVariant.includes('episcopal')) {
        variants.push(saintVariant.replace(/\bchurch\b/, 'episcopal church'));
        variants.push(saintVariant.replace(/\bchurch\b/, 'episcopal parish'));
        if (saintVariant.includes('parish'))
          variants.push(saintVariant.replace(/\bparish\b/, 'episcopal church'));
      }
      for (const v of variants) {
        const nid = idx.byNormCity.get(`${v}|${normCity}`);
        if (nid) return lookupParochial(db, nid);
      }
    }
  }

  // Strategy 8: drop "episcopal" from the name and retry
  // e.g. "St Michaels Episcopal Church" -> "St Michaels Church"
  if (normName.includes('episcopal') && city) {
    const normCity = normalizeChurchName(city);
    const stripped = normName.replace(/\s*episcopal\s*/, ' ').replace(/\s+/g, ' ').trim();
    const nid = idx.byNormCity.get(`${stripped}|${normCity}`);
    if (nid) return lookupParochial(db, nid);
    // Also try "Parish Church" variant
    const asParish = stripped.replace(/\bchurch\b/, 'parish church');
    const nid2 = idx.byNormCity.get(`${asParish}|${normCity}`);
    if (nid2) return lookupParochial(db, nid2);
  }

  // Strategy 9: substring match within the same city (handles
  // "Trinity Parish" matching "Trinity Parish & Old Swedes Church")
  if (city && normName.length >= 8) {
    const normCity = normalizeChurchName(city);
    for (const [key, nid] of idx.byNormCity) {
      const [candidateName, candidateCity] = key.split('|');
      if (candidateCity === normCity && candidateName.includes(normName)) {
        return lookupParochial(db, nid);
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Stage entry point
// ---------------------------------------------------------------------------

/**
 * Attach parochial data stage.
 *
 * For each position with matched parishes, looks up parochial data using
 * a multi-strategy approach:
 *   1. Exact match: "Name (City)" key against parish_nid
 *   2. Exact match: name alone
 *   3. Exact match: NID
 *   4. Fuzzy match: normalized name+city (handles St/Saint, punctuation, etc.)
 *   5. Fuzzy match: with "Episcopal Church" suffix expansion
 *
 * Attaches:
 *   - position.parochials: array of { years: { '<year>': { averageAttendance,
 *       plateAndPledge, membership, operatingRevenue } } }, one entry per
 *       church_info with data found.
 *
 * Positions with no matched parishes receive an empty parochials array.
 *
 * @param {Array} positions - positions already processed by match-parishes stage
 * @param {object} db - better-sqlite3 database instance
 * @returns {Array} positions with parochials field attached
 */
function attachParochial(positions, db) {
  let exactHits = 0;
  let fuzzyHits = 0;
  let misses = 0;

  for (const pos of positions) {
    const churchInfos = pos.church_infos || [];

    if (churchInfos.length === 0) {
      pos.parochials = [];
      continue;
    }

    const parochials = [];
    for (const info of churchInfos) {
      const nameWithCity = info.city
        ? `${info.name} (${info.city})`
        : info.name;

      // Try exact matches first (fast path)
      let parochial =
        lookupParochial(db, nameWithCity) ||
        lookupParochial(db, info.name) ||
        lookupParochial(db, info.nid);

      if (parochial) {
        exactHits++;
      } else {
        // Fall back to fuzzy matching
        parochial = fuzzyLookupParochial(db, info.name, info.city);
        if (parochial) fuzzyHits++;
        else misses++;
      }

      if (parochial) {
        parochials.push(parochial);
      }
    }

    pos.parochials = parochials;
  }

  console.log(`  Parochial matches: ${exactHits} exact, ${fuzzyHits} fuzzy, ${misses} unmatched`);

  return positions;
}

module.exports = attachParochial;

// Also export internals for testing
module.exports.lookupParochial = lookupParochial;
module.exports.normalizeChurchName = normalizeChurchName;
module.exports.fuzzyLookupParochial = fuzzyLookupParochial;
