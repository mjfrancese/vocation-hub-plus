#!/usr/bin/env node
/**
 * Build position-to-church mapping by linking every VH position (profiles + search results)
 * to a church in the canonical registry.
 *
 * Uses strict matching rules. Uncertain matches are flagged for human review.
 *
 * Output: web/public/data/position-church-map.json
 * Input:  church-registry.json, positions.json, all-profiles.json, profile-fields.json,
 *         manual-mappings.json (human overrides)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../public/data');

function load(name) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// --- Normalization ---

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

function normalizeChurchName(name) {
  return name
    .toLowerCase()
    .replace(/\bthe\b/g, '')
    .replace(/\bepiscopal\b/g, '')
    .replace(/\bchurch\b/g, '')
    .replace(/\bparish\b/g, '')
    .replace(/\bof\b/g, '')
    .replace(/\band\b/g, '')
    .replace(/\bcommunity\b/g, '')
    .replace(/saint\b/g, 'st')
    .replace(/st\.\s*/g, 'st ')
    .replace(/[''`]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/,.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Common church name tokens that don't help distinguish churches
const COMMON_TOKENS = new Set([
  'st', 'trinity', 'grace', 'christ', 'holy', 'all', 'saints',
  'john', 'james', 'paul', 'mark', 'luke', 'matthew', 'peter',
  'andrew', 'stephen', 'thomas', 'george', 'michael', 'david',
  'mary', 'martin', 'cross', 'good', 'shepherd', 'spirit',
  'redeemer', 'savior', 'nativity', 'resurrection', 'ascension',
  'advent', 'annunciation', 'transfiguration', 'emmanuel', 'immanuel',
  'cathedral', 'chapel', 'memorial', 'mission',
]);

// --- Build indexes from registry ---

function normUrl(u) {
  if (!u) return '';
  return u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').toLowerCase();
}

function buildRegistryIndexes(registry) {
  const emailIndex = new Map();   // domain -> [{ nid, church }]
  const dioceseIndex = new Map(); // normDiocese -> [{ nid, church }]
  const websiteIndex = new Map(); // normUrl -> { nid, church }

  for (const [nid, church] of Object.entries(registry)) {
    // Email index
    if (church.email) {
      const domain = church.email.split('@')[1]?.toLowerCase();
      if (domain) {
        const list = emailIndex.get(domain) || [];
        list.push({ nid: parseInt(nid), church });
        emailIndex.set(domain, list);
      }
    }

    // Diocese index
    if (church.diocese) {
      const key = normalizeDiocese(church.diocese);
      const list = dioceseIndex.get(key) || [];
      list.push({ nid: parseInt(nid), church });
      dioceseIndex.set(key, list);
    }

    // Website index
    const w = normUrl(church.website);
    if (w) {
      websiteIndex.set(w, { nid: parseInt(nid), church });
    }
  }

  return { emailIndex, dioceseIndex, websiteIndex };
}

// --- Diocesan/generic domain detection ---
// Domains that belong to dioceses or ISPs, not individual churches.
// Even if only one church uses the domain, a profile email on this domain
// likely belongs to the diocese, not that specific church.

function isDiocesanOrGenericDomain(domain) {
  // Common ISP/webmail domains
  if (/^(gmail|yahoo|outlook|hotmail|aol|comcast|verizon|att|icloud|live|msn|sbcglobal|bellsouth|frontier|frontiernet|earthlink|embarq|embarqmail|windstream|centurytel|centurylink|charter|suddenlink|suddenlinkmail|optonline|tampabay\.rr|cablelynx|ptd|snet|cableone|tds|midconetwork|juno|mac|me|mail)\b/i.test(domain)) {
    return true;
  }
  // Diocesan patterns: e.g., edod.org, dioala.org, diomass.org, episcopalpr.org
  if (/^(dio|edo|edio|edin|edomi|ednin)/i.test(domain)) return true;
  if (/^episcopal/i.test(domain)) return true;
  if (/diocese/i.test(domain)) return true;
  // Known diocesan domains that don't match patterns above
  if (/^(nuom|dwtx|ladiocese|episwtn|upepiscopal|mdi-episcopal)\./i.test(domain)) return true;
  return false;
}

// --- Extract emails from profile fields ---

function extractEmails(fields) {
  const emails = [];
  for (const f of (fields || [])) {
    const found = (f.value || '').match(/[\w.+-]+@[\w.-]+\.\w+/g);
    if (found) emails.push(...found);
  }
  return emails;
}

// --- Extract city from position name ---

function extractCity(name) {
  const m = (name || '').match(/\(([^)]+)\)$/);
  if (m) return m[1].trim();
  const parts = (name || '').split(',');
  if (parts.length >= 2) {
    const city = parts[parts.length - 2]?.trim();
    if (city && city.length < 50) return city;
  }
  return '';
}

// --- Matching ---

function matchByNameDiocese(posName, diocese, indexes) {
  if (!posName || !diocese) return null;

  const posNorm = normalizeChurchName(posName);
  const dioceseKey = normalizeDiocese(diocese);
  const allCandidates = indexes.dioceseIndex.get(dioceseKey) || [];
  const candidates = allCandidates.filter(c => !c.church.type || c.church.type === 'church');

  // Exact normalized match
  const exactMatches = candidates.filter(c => normalizeChurchName(c.church.name) === posNorm);
  if (exactMatches.length === 1) {
    return {
      church_nid: exactMatches[0].nid,
      confidence: 'exact',
      match_method: 'name_exact',
      flagged: false,
    };
  }

  // Multiple exact name matches: try city disambiguation
  if (exactMatches.length > 1) {
    const posCity = extractCity(posName).toLowerCase();
    if (posCity) {
      const cityMatched = exactMatches.filter(c => c.church.city.toLowerCase() === posCity);
      if (cityMatched.length === 1) {
        return {
          church_nid: cityMatched[0].nid,
          confidence: 'exact',
          match_method: 'name_exact_city',
          flagged: false,
        };
      }
    }
  }

  // High-confidence token match (>= 90% overlap + distinguishing token)
  if (posNorm && posNorm.length >= 3) {
    const posTokens = posNorm.split(/\s+/).filter(t => t.length > 1);
    if (posTokens.length > 0) {
      const hasDistinguishing = posTokens.some(t => !COMMON_TOKENS.has(t) && t.length > 2);

      if (hasDistinguishing) {
        let best = null;
        let bestScore = 0;

        for (const c of candidates) {
          const churchNorm = normalizeChurchName(c.church.name);
          const churchTokens = churchNorm.split(/\s+/).filter(t => t.length > 1);
          if (churchTokens.length === 0) continue;

          let matchCount = 0;
          for (const token of posTokens) {
            if (churchTokens.some(ct => ct === token)) matchCount++;
          }

          const score = matchCount / Math.max(posTokens.length, churchTokens.length);
          if (score > bestScore && score >= 0.9) {
            bestScore = score;
            best = c;
          }
        }

        if (best) {
          const posCity = extractCity(posName).toLowerCase();
          const churchCity = best.church.city.toLowerCase();
          const cityConflict = posCity && churchCity && posCity !== churchCity;

          if (!cityConflict) {
            return {
              church_nid: best.nid,
              confidence: 'high',
              match_method: 'name_high_confidence',
              flagged: false,
            };
          }
        }
      }
    }
  }

  return null;
}

function matchPosition(posName, diocese, fields, indexes, website) {
  const emails = extractEmails(fields);

  // Strategy 0: Website match (most reliable when available)
  if (website) {
    const w = normUrl(website);
    if (w) {
      const match = indexes.websiteIndex.get(w);
      if (match && (!match.church.type || match.church.type === 'church')) {
        return {
          church_nid: match.nid,
          confidence: 'exact',
          match_method: 'website',
          flagged: false,
        };
      }
    }
  }

  // Strategy 1: Unique email domain match
  for (const email of emails) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) continue;

    // Skip diocesan and generic domains entirely
    if (isDiocesanOrGenericDomain(domain)) continue;

    const matches = indexes.emailIndex.get(domain);
    if (!matches) continue;

    // Only use if this domain maps to exactly ONE church (truly unique domain)
    // Also skip if the match is a diocesan office, camp, or school (type !== 'church')
    if (matches.length === 1) {
      if (matches[0].church.type && matches[0].church.type !== 'church') {
        // This email domain uniquely maps to a non-church entity (diocesan office, camp, etc.)
        // Skip and fall through to name-based matching
        continue;
      }
      return {
        church_nid: matches[0].nid,
        confidence: 'exact',
        match_method: 'email_unique',
        flagged: false,
      };
    }

    // If multiple matches, filter to churches only and check again
    const churchOnly = matches.filter(m => !m.church.type || m.church.type === 'church');
    if (churchOnly.length === 1) {
      return {
        church_nid: churchOnly[0].nid,
        confidence: 'exact',
        match_method: 'email_unique_church',
        flagged: false,
      };
    }
  }

  // Strategy 2: Name + diocese matching
  // For multi-point calls (multiple churches separated by newlines), try each name
  const namesToTry = posName ? posName.split(/\n/).map(n => n.trim()).filter(Boolean) : [];
  if (posName && !namesToTry.length) namesToTry.push(posName);

  for (const nameCandidate of namesToTry) {
    const result = matchByNameDiocese(nameCandidate, diocese, indexes);
    if (result) return result;
  }

  // Strategy 2b: If position has a city hint, try matching name + city against all diocese candidates
  // This catches cases like "St Peters (Smyrna)" where normalization strips the city
  // but the registry name includes it: "St. Peter's Church Smyrna"
  if (posName && diocese) {
    const posCity = extractCity(posName).toLowerCase();
    if (posCity) {
      const dioceseKey = normalizeDiocese(diocese);
      const allCandidates = indexes.dioceseIndex.get(dioceseKey) || [];
      const candidates = allCandidates.filter(c => !c.church.type || c.church.type === 'church');

      // Find candidates whose city matches and whose name tokens overlap well
      const posNorm = normalizeChurchName(posName);
      const posTokens = posNorm.split(/\s+/).filter(t => t.length > 1);
      const cityMatches = candidates.filter(c => c.church.city.toLowerCase() === posCity);

      if (cityMatches.length > 0 && posTokens.length > 0) {
        // Among city matches, find ones where all position tokens appear in the church name
        const nameAndCity = cityMatches.filter(c => {
          const churchNorm = normalizeChurchName(c.church.name);
          const churchTokens = churchNorm.split(/\s+/).filter(t => t.length > 1);
          return posTokens.every(t => churchTokens.includes(t));
        });

        if (nameAndCity.length === 1) {
          return {
            church_nid: nameAndCity[0].nid,
            confidence: 'high',
            match_method: 'name_city_combined',
            flagged: false,
          };
        }
      }
    }
  }

  // No confident match found
  return {
    church_nid: null,
    confidence: 'none',
    match_method: 'unmatched',
    flagged: true,
  };
}

// --- Main ---

function main() {
  const registryData = load('church-registry.json');
  const positions = load('positions.json');
  const allProfiles = load('all-profiles.json');
  const profileFields = load('profile-fields.json');
  const manualMappings = load('manual-mappings.json') || {};

  if (!registryData) { console.error('No church-registry.json found. Run build-registry.js first.'); process.exit(1); }
  if (!positions) { console.error('No positions.json found.'); process.exit(1); }

  const indexes = buildRegistryIndexes(registryData.churches);

  const mappings = {};
  const stats = { exact: 0, high: 0, manual: 0, flagged: 0, total: 0 };

  // Collect all unique VH IDs from both sources
  const allEntries = new Map(); // vh_id -> { name, diocese, fields, website }

  // From positions (search results)
  for (const pos of positions) {
    const vhId = pos.vh_id;
    if (!vhId) continue;
    const fields = profileFields ? profileFields[String(vhId)] : [];
    allEntries.set(vhId, {
      name: pos.name || '',
      diocese: pos.diocese || '',
      fields: fields || [],
      website: '',
      source: 'search',
    });
  }

  // From all profiles
  if (allProfiles) {
    for (const profile of allProfiles) {
      if (allEntries.has(profile.vh_id)) {
        // Merge profile data into existing entry
        const existing = allEntries.get(profile.vh_id);
        if (!existing.name && profile.congregation) existing.name = profile.congregation;
        if (!existing.website && profile.website) existing.website = profile.website;
        if (profile.all_fields && profile.all_fields.length > (existing.fields?.length || 0)) {
          existing.fields = profile.all_fields;
        }
      } else {
        allEntries.set(profile.vh_id, {
          name: profile.congregation || '',
          diocese: profile.diocese || '',
          fields: profile.all_fields || [],
          website: profile.website || '',
          source: 'profile',
        });
      }
    }
  }

  console.log(`Processing ${allEntries.size} unique positions/profiles`);

  for (const [vhId, entry] of allEntries) {
    stats.total++;

    // Check for manual override first
    if (manualMappings[String(vhId)]) {
      const manual = manualMappings[String(vhId)];
      mappings[String(vhId)] = {
        church_nid: manual.church_nid,
        confidence: 'manual',
        match_method: 'manual',
        flagged: false,
        note: manual.note || '',
      };
      stats.manual++;
      continue;
    }

    // Auto-match
    const result = matchPosition(entry.name, entry.diocese, entry.fields, indexes, entry.website);
    mappings[String(vhId)] = result;

    if (result.confidence === 'exact') stats.exact++;
    else if (result.confidence === 'high') stats.high++;
    else stats.flagged++;
  }

  console.log(`\nMapping results:`);
  console.log(`  Exact:   ${stats.exact} (${(stats.exact/stats.total*100).toFixed(1)}%)`);
  console.log(`  High:    ${stats.high} (${(stats.high/stats.total*100).toFixed(1)}%)`);
  console.log(`  Manual:  ${stats.manual}`);
  console.log(`  Flagged: ${stats.flagged} (${(stats.flagged/stats.total*100).toFixed(1)}%)`);
  console.log(`  Total:   ${stats.total}`);

  // Write output
  const output = {
    meta: {
      lastUpdated: new Date().toISOString(),
      totalMapped: stats.exact + stats.high + stats.manual,
      totalFlagged: stats.flagged,
      totalPositions: stats.total,
    },
    mappings,
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'position-church-map.json'),
    JSON.stringify(output, null, 2)
  );

  // Show some flagged examples for debugging
  const flaggedExamples = Object.entries(mappings)
    .filter(([, m]) => m.flagged)
    .slice(0, 10);

  if (flaggedExamples.length > 0) {
    console.log(`\nSample flagged positions:`);
    for (const [vhId, mapping] of flaggedExamples) {
      const entry = allEntries.get(parseInt(vhId));
      console.log(`  VH ${vhId}: "${entry?.name || '(no name)'}" [${entry?.diocese || '(no diocese)'}]`);
    }
  }

  console.log(`\nWritten to position-church-map.json`);
}

main();
