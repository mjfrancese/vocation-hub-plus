/**
 * Enrichment Stage: Match Parishes
 *
 * Matches raw positions to parishes in the DB using multiple strategies:
 *   1. Website domain match
 *   2. Email domain match
 *   3. Phone match (within same diocese)
 *   4. Name + diocese via aliases (with city disambiguation)
 *   4b. Name + city match without diocese
 *   4c. Name-only match via aliases
 *   5. City-based fallback for multi-congregation positions
 *   6. Word-as-city fallback
 *
 * Extracted from enrich-positions-v2.js.
 */

'use strict';

const {
  normalizeChurchName,
  normalizePhone,
  normalizeDomain,
} = require('../lib/normalization');

// ---------------------------------------------------------------------------
// Manual NID overrides
// ---------------------------------------------------------------------------
// When the automatic matcher picks the wrong parish (e.g. a school instead of
// the church at the same address), add an entry here keyed by vh_id mapping to
// the correct nid.  The override is applied before any automatic strategy runs.

const NID_OVERRIDES = {
  // St. David's (Austin) -- matcher picked nid 8304 (school); correct is 5609 (church)
  10668: 5609,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractCity(name) {
  const m = (name || '').match(/\(([^)]+)\)$/);
  if (m) return m[1].trim();
  return '';
}

const extractCityHint = extractCity;

/**
 * Normalize diocese name for comparison.
 * Position data uses short form ("North Carolina"), DB uses long form
 * ("Diocese Of North Carolina" or "Episcopal Diocese Of North Carolina").
 * Strip common prefixes so both resolve to the same core name.
 */
function normalizeDioceseName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/^(the\s+)?episcopal\s+(church\s+in\s+|diocese\s+of\s+(the\s+)?)/i, '')
    .replace(/^(the\s+)?diocese\s+of\s+(the\s+)?/i, '')
    .replace(/^trustees and council of the episcopal diocese of\s*/i, '')
    .replace(/\s+(inc|corp|llc|foundation)\.?$/i, '')
    .trim();
}

function isGenericDomain(domain) {
  if (!domain) return true;
  if (/^(gmail|yahoo|outlook|hotmail|aol|comcast|verizon|att|icloud|live|msn|sbcglobal|bellsouth|frontier|frontiernet|earthlink|embarq|embarqmail|windstream|centurytel|centurylink|charter|suddenlink|suddenlinkmail|optonline|tampabay\.rr|cablelynx|ptd|snet|cableone|tds|midconetwork|juno|mac|me|mail)\b/i.test(domain)) {
    return true;
  }
  if (/^(dio|edo|edio|edin|edomi|ednin)/i.test(domain)) return true;
  if (/^episcopal/i.test(domain)) return true;
  if (/diocese/i.test(domain)) return true;
  if (/^(nuom|dwtx|ladiocese|episwtn|upepiscopal|mdi-episcopal)\./i.test(domain)) return true;
  return false;
}

/**
 * Build church_info object from a parish DB row.
 */
function buildChurchInfo(parish) {
  if (!parish) return null;
  return {
    id: parish.id,
    nid: parish.nid,
    name: parish.name,
    street: parish.address,
    city: parish.city,
    state: parish.state,
    zip: parish.zip,
    phone: parish.phone,
    email: parish.email,
    website: parish.website,
    type: parish.type,
    lat: parish.lat,
    lng: parish.lng,
  };
}

// ---------------------------------------------------------------------------
// Identity enrichment
// ---------------------------------------------------------------------------

/**
 * Enrich a match result with data from linked parishes via parish_identity.
 *
 * - If matched parish is ECDPlus (has ecdplus_id but no coords), pull coords
 *   from the linked Asset Map parish.
 * - If matched parish is Asset Map (has nid but no ecdplus_id), pull ecdplus_id
 *   from the linked ECDPlus parish.
 */
function enrichMatchWithIdentity(match, db) {
  if (!match || !match.parish) return match;
  const parish = match.parish;

  // If matched parish is ECDPlus (has ecdplus_id but no coords), look up linked Asset Map parish
  if (parish.ecdplus_id && (!parish.lat || !parish.lng)) {
    const linked = db.prepare(
      `SELECT p.* FROM parish_identity pi
       JOIN parishes p ON p.nid = pi.nid
       WHERE pi.ecdplus_id = ? AND p.lat IS NOT NULL`
    ).get(parish.ecdplus_id);
    if (linked) {
      return {
        ...match,
        parish: { ...parish, lat: linked.lat, lng: linked.lng },
      };
    }
  }

  // If matched parish is Asset Map (has nid but no ecdplus_id), get ecdplus_id from linked parish
  if (parish.nid && (!parish.ecdplus_id)) {
    const linked = db.prepare(
      `SELECT p.* FROM parish_identity pi
       JOIN parishes p ON p.ecdplus_id = pi.ecdplus_id
       WHERE pi.nid = ?`
    ).get(parish.nid);
    if (linked) {
      return {
        ...match,
        parish: { ...parish, ecdplus_id: linked.ecdplus_id },
      };
    }
  }

  return match;
}

// ---------------------------------------------------------------------------
// Single-parish matching
// ---------------------------------------------------------------------------

function matchPositionToParish(position, db, lookups) {
  // Strategy 1: Website match
  if (position.website_url) {
    const domain = normalizeDomain(position.website_url);
    if (domain && !isGenericDomain(domain)) {
      const matches = lookups.parishesByWebDomain.get(domain) || [];
      if (matches.length > 0) {
        return { parish: matches[0], confidence: 'exact', method: 'website' };
      }
    }
  }

  // Strategy 2: Email domain match
  if (position.contact_email) {
    const emailDomain = position.contact_email.split('@')[1];
    if (emailDomain && !isGenericDomain(emailDomain)) {
      const matches = lookups.parishesByEmailDomain.get(emailDomain.toLowerCase()) || [];
      if (matches.length > 0) {
        return { parish: matches[0], confidence: 'exact', method: 'email' };
      }
    }
  }

  // Strategy 3: Phone match (within same diocese)
  const posNormDiocese = normalizeDioceseName(position.diocese);
  if (position.contact_phone) {
    const normalizedPhone = normalizePhone(position.contact_phone);
    if (normalizedPhone && normalizedPhone.length >= 10) {
      const matches = lookups.parishesByPhone.get(normalizedPhone) || [];
      for (const p of matches) {
        if (normalizeDioceseName(p.diocese) === posNormDiocese) {
          return { parish: p, confidence: 'exact', method: 'phone' };
        }
      }
    }
  }

  // Strategy 4: Name + diocese match via aliases (with normalized diocese comparison)
  const posNormalized = normalizeChurchName(position.name);
  if (posNormalized && position.diocese) {
    const allMatches = db.prepare(`
      SELECT p.* FROM parishes p
      JOIN parish_aliases pa ON pa.parish_id = p.id
      WHERE pa.alias_normalized = ?
    `).all(posNormalized).filter(p => normalizeDioceseName(p.diocese) === posNormDiocese);

    // Deduplicate by parish id (DB has duplicate entries)
    const seen = new Set();
    const matches = allMatches.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    if (matches.length === 1) {
      return { parish: matches[0], confidence: 'high', method: 'name_diocese' };
    }

    if (matches.length > 1) {
      const cityHint = extractCityHint(position.name);
      if (cityHint) {
        const cityMatch = matches.find(m =>
          m.city && m.city.toLowerCase() === cityHint.toLowerCase()
        );
        if (cityMatch) {
          return { parish: cityMatch, confidence: 'high', method: 'name_diocese_city' };
        }
      }
      // If still ambiguous, pick best name match against original position name
      const posLower = position.name.toLowerCase();
      const exactName = matches.find(m => m.name && posLower.includes(m.name.toLowerCase()));
      if (exactName) {
        return { parish: exactName, confidence: 'medium', method: 'name_diocese_best' };
      }
      // Last resort: return first match at lower confidence
      return { parish: matches[0], confidence: 'low', method: 'name_diocese_ambiguous' };
    }
  }

  // Strategy 4b: Name + city match WITHOUT diocese
  const cityHint = extractCityHint(position.name);
  if (posNormalized && cityHint && !position.diocese) {
    const allMatches = db.prepare(`
      SELECT p.* FROM parishes p
      JOIN parish_aliases pa ON pa.parish_id = p.id
      WHERE pa.alias_normalized = ? AND LOWER(p.city) = LOWER(?)
    `).all(posNormalized, cityHint);

    const seen = new Set();
    const matches = allMatches.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    if (matches.length >= 1) {
      return { parish: matches[0], confidence: 'medium', method: 'name_city' };
    }
  }

  // Strategy 4c: Name-only match via aliases (when diocese is missing and no city hint)
  if (posNormalized && !position.diocese && !cityHint) {
    const allMatches = db.prepare(`
      SELECT p.* FROM parishes p
      JOIN parish_aliases pa ON pa.parish_id = p.id
      WHERE pa.alias_normalized = ?
    `).all(posNormalized);

    const seen = new Set();
    const matches = allMatches.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    if (matches.length === 1) {
      return { parish: matches[0], confidence: 'medium', method: 'name_only' };
    }

    if (matches.length > 1) {
      // Try to narrow by website domain
      if (position.website_url) {
        const posDomain = normalizeDomain(position.website_url);
        if (posDomain && !isGenericDomain(posDomain)) {
          const domainMatch = matches.find(m => normalizeDomain(m.website) === posDomain);
          if (domainMatch) {
            return { parish: domainMatch, confidence: 'medium', method: 'name_website' };
          }
        }
      }
      // Try to narrow by phone
      if (position.contact_phone) {
        const posPhone = normalizePhone(position.contact_phone);
        if (posPhone) {
          const phoneMatch = matches.find(m => normalizePhone(m.phone) === posPhone);
          if (phoneMatch) {
            return { parish: phoneMatch, confidence: 'medium', method: 'name_phone' };
          }
        }
      }
    }
  }

  // Strategy 5: City-based fallback for multi-congregation positions
  if (position.diocese) {
    if (cityHint) {
      const cityMatches = db.prepare(
        "SELECT * FROM parishes WHERE LOWER(city) = LOWER(?)"
      ).all(cityHint).filter(p => normalizeDioceseName(p.diocese) === posNormDiocese);
      // Deduplicate
      const seenCity = new Set();
      const uniqueCity = cityMatches.filter(p => { if (seenCity.has(p.id)) return false; seenCity.add(p.id); return true; });
      if (uniqueCity.length === 1) {
        return { parish: uniqueCity[0], confidence: 'medium', method: 'city_diocese' };
      }
      if (uniqueCity.length > 1) {
        // Try to narrow by any word in the position name
        const posWords = position.name.toLowerCase().replace(/\(.*?\)/g, '').split(/[\s,]+/).filter(w => w.length >= 4);
        const nameHit = uniqueCity.find(p => posWords.some(w => p.name.toLowerCase().includes(w)));
        if (nameHit) {
          return { parish: nameHit, confidence: 'medium', method: 'city_name_hint' };
        }
      }
    }

    // Try matching town/city names embedded in the position name (not in parens)
    const cleanedName = position.name.replace(/,\s*Diocese of.*/i, '');
    const nameParts = cleanedName.split(/\s+and\s+/i);
    for (const part of nameParts) {
      const stripped = part.trim().replace(/\(.*?\)/, '').trim();
      const candidates = [stripped];
      const words = stripped.split(/\s+/);
      if (words.length > 1) {
        candidates.push(...words.filter(w => w.length >= 4));
      }
      for (const candidate of candidates) {
        const townMatches = db.prepare(
          "SELECT * FROM parishes WHERE LOWER(city) = LOWER(?)"
        ).all(candidate).filter(p => normalizeDioceseName(p.diocese) === posNormDiocese);
        const seenTown = new Set();
        const uniqueTown = townMatches.filter(p => { if (seenTown.has(p.id)) return false; seenTown.add(p.id); return true; });
        if (uniqueTown.length >= 1) {
          return { parish: uniqueTown[0], confidence: 'medium', method: 'town_in_name' };
        }
      }
    }

    // Strategy 6: Try each significant word in the position name as a city
    const cleanedName2 = position.name.replace(/,\s*Diocese of.*/i, '');
    const allWords = cleanedName2.split(/[\s,]+/).filter(w => w.length >= 4 && !/^(episcopal|church|parish|mission|diocese|west|east|north|south|the|and)$/i.test(w));
    for (const word of allWords) {
      const wordMatches = db.prepare(
        "SELECT * FROM parishes WHERE LOWER(city) = LOWER(?)"
      ).all(word).filter(p => normalizeDioceseName(p.diocese) === posNormDiocese);
      const seenW = new Set();
      const uniqueW = wordMatches.filter(p => { if (seenW.has(p.id)) return false; seenW.add(p.id); return true; });
      if (uniqueW.length >= 1) {
        return { parish: uniqueW[0], confidence: 'low', method: 'word_as_city' };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Multi-parish matching orchestrator
// ---------------------------------------------------------------------------

/**
 * Splits position names on \n and " and ", matches each part independently,
 * and returns the set that produces the most matches.
 */
function matchPositionToParishes(position, db, lookups) {
  // Try unsplit match first
  const unsplitMatch = enrichMatchWithIdentity(matchPositionToParish(position, db, lookups), db);
  const unsplitResults = unsplitMatch ? [unsplitMatch] : [];

  // Split name into candidate parts
  const rawName = (position.name || '').replace(/,\s*Diocese of.*/i, '');
  let parts = rawName.split(/\n/).map(s => s.trim()).filter(Boolean);

  // Further split each part on " and " (but not if part looks like "Saints X and Y")
  const expandedParts = [];
  for (const part of parts) {
    if (/^(saints?|ss\.?|sts\.?)\s/i.test(part)) {
      expandedParts.push(part);
    } else {
      const subParts = part.split(/\s+and\s+/i).map(s => s.trim()).filter(Boolean);
      expandedParts.push(...subParts);
    }
  }

  // If we only got 1 part (no splitting happened), return the unsplit result
  if (expandedParts.length <= 1) {
    return unsplitResults;
  }

  // Match each part independently
  const splitResults = [];
  const seenParishIds = new Set();

  for (const part of expandedParts) {
    const syntheticPosition = {
      name: part,
      diocese: position.diocese,
      website_url: '',
      contact_email: '',
      contact_phone: '',
    };

    const match = enrichMatchWithIdentity(matchPositionToParish(syntheticPosition, db, lookups), db);
    if (match && !seenParishIds.has(match.parish.id)) {
      seenParishIds.add(match.parish.id);
      splitResults.push(match);
    }
  }

  // Use split results if they produced more distinct matches
  if (splitResults.length > unsplitResults.length) {
    return splitResults;
  }

  return unsplitResults;
}

// ---------------------------------------------------------------------------
// Stage entry point
// ---------------------------------------------------------------------------

/**
 * Match parishes stage.
 *
 * For each position, runs matching strategies and attaches:
 *   - church_infos: array of ChurchInfo objects
 *   - match_confidence: best confidence level
 *   - match_method: best match method
 *   - _parish_ids: internal array of DB IDs for later stages
 *
 * @param {Array} positions - raw positions
 * @param {object} db - better-sqlite3 database instance
 * @returns {Array} positions with parish matching fields added
 */
function matchParishes(positions, db) {
  // Pre-load all parishes once to avoid repeated full table scans.
  // Strategies 1-3 in matchPositionToParish were each doing SELECT * per position.
  const allParishes = db.prepare('SELECT * FROM parishes').all();

  const parishesByWebDomain = new Map();
  const parishesByEmailDomain = new Map();
  const parishesByPhone = new Map();

  for (const p of allParishes) {
    if (p.website) {
      const d = normalizeDomain(p.website);
      if (d) {
        if (!parishesByWebDomain.has(d)) parishesByWebDomain.set(d, []);
        parishesByWebDomain.get(d).push(p);
      }
    }
    if (p.email) {
      const ed = (p.email || '').split('@')[1];
      if (ed) {
        const key = ed.toLowerCase();
        if (!parishesByEmailDomain.has(key)) parishesByEmailDomain.set(key, []);
        parishesByEmailDomain.get(key).push(p);
      }
    }
    if (p.phone) {
      const np = normalizePhone(p.phone);
      if (np && np.length >= 10) {
        if (!parishesByPhone.has(np)) parishesByPhone.set(np, []);
        parishesByPhone.get(np).push(p);
      }
    }
  }

  const lookups = { parishesByWebDomain, parishesByEmailDomain, parishesByPhone };

  for (const pos of positions) {
    // Check for manual NID override before running automatic matching
    const overrideNid = NID_OVERRIDES[pos.vh_id];
    if (overrideNid) {
      const parish = db.prepare('SELECT * FROM parishes WHERE nid = ?').get(String(overrideNid));
      if (parish) {
        pos.church_infos = [buildChurchInfo(parish)];
        pos.match_confidence = 'exact';
        pos.match_method = 'manual_override';
        pos._parish_ids = [parish.id];
        continue;
      }
    }

    const matches = matchPositionToParishes(pos, db, lookups);

    if (matches.length > 0) {
      pos.church_infos = matches.map(m => buildChurchInfo(m.parish));
      pos.match_confidence = matches[0].confidence;
      pos.match_method = matches[0].method;
      pos._parish_ids = matches.map(m => m.parish.id);
    } else {
      pos.church_infos = [];
      pos.match_confidence = null;
      pos.match_method = null;
      pos._parish_ids = [];
    }
  }

  return positions;
}

module.exports = matchParishes;

// Also export internals for testing
module.exports.matchPositionToParish = matchPositionToParish;
module.exports.matchPositionToParishes = matchPositionToParishes;
module.exports.buildChurchInfo = buildChurchInfo;
module.exports.normalizeDioceseName = normalizeDioceseName;
module.exports.isGenericDomain = isGenericDomain;
module.exports.extractCity = extractCity;
module.exports.enrichMatchWithIdentity = enrichMatchWithIdentity;
module.exports.NID_OVERRIDES = NID_OVERRIDES;
