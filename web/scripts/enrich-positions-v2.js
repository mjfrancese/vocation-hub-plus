#!/usr/bin/env node
/**
 * DB-backed enrichment script (v2).
 *
 * Replaces the 3-script chain (build-registry + build-position-map + enrich-positions)
 * with a single script that reads from vocationhub.db.
 *
 * 1. Matches positions to parishes via DB (website, email, phone, name+diocese)
 * 2. Attaches parochial data, compensation, clergy info from DB
 * 3. Computes percentiles, quality scores, similar positions, census data
 * 4. Exports enriched-positions.json and enriched-extended.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getDb, closeDb } = require('./db');
const {
  normalizeChurchName,
  normalizePhone,
  normalizeDomain,
} = require('./lib/normalization');

const DATA_DIR = path.resolve(__dirname, '../public/data');

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function parseMMDDYYYY(str) {
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
}

/**
 * Fix bogus 1900 year in dates.
 * VH defaults empty year fields to 1900.
 * 01/01/1900 means "no date was ever entered" -- clear entirely.
 * Other /1900 dates get year fixed to current year.
 */
function fixBogusYear(dateStr) {
  if (!dateStr) return dateStr;
  const currentYear = new Date().getFullYear();
  if (dateStr.trim() === '01/01/1900') return '';
  if (/^01\/01\/1900\s*(to\s*01\/01\/1900)?$/.test(dateStr.trim())) return '';
  return dateStr.replace(/\/1900\b/g, `/${currentYear}`);
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function load(name) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function extractCity(name) {
  const m = (name || '').match(/\(([^)]+)\)$/);
  if (m) return m[1].trim();
  return '';
}

// Alias used by matchPositionToParish
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

// ---------------------------------------------------------------------------
// Generic / diocesan domain detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Stipend parsing
// ---------------------------------------------------------------------------

function parseStipend(str) {
  if (!str || typeof str !== 'string') return null;
  const upper = str.trim().toUpperCase();
  if (/^(DOE|TBD|NEGOTIABLE|N\/A|SEE|CONTACT|VARIES)/.test(upper)) return null;
  const cleaned = str.replace(/[$,\s]/g, '');
  const m = cleaned.match(/^(\d+\.?\d*)/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  return val > 0 ? val : null;
}

// ---------------------------------------------------------------------------
// DB-backed matching: matchPositionToParish
// ---------------------------------------------------------------------------

function matchPositionToParish(position) {
  const db = getDb();

  // Strategy 1: Website match
  if (position.website_url) {
    const domain = normalizeDomain(position.website_url);
    if (domain && !isGenericDomain(domain)) {
      const parishes = db.prepare("SELECT * FROM parishes WHERE website != '' AND website IS NOT NULL").all();
      for (const p of parishes) {
        if (normalizeDomain(p.website) === domain) {
          return { parish: p, confidence: 'exact', method: 'website' };
        }
      }
    }
  }

  // Strategy 2: Email domain match
  if (position.contact_email) {
    const emailDomain = position.contact_email.split('@')[1];
    if (emailDomain && !isGenericDomain(emailDomain)) {
      const parishes = db.prepare("SELECT * FROM parishes WHERE email != '' AND email IS NOT NULL").all();
      for (const p of parishes) {
        const pDomain = (p.email || '').split('@')[1];
        if (pDomain && pDomain.toLowerCase() === emailDomain.toLowerCase()) {
          return { parish: p, confidence: 'exact', method: 'email' };
        }
      }
    }
  }

  // Strategy 3: Phone match (within same diocese)
  const posNormDiocese = normalizeDioceseName(position.diocese);
  if (position.contact_phone) {
    const normalizedPhone = normalizePhone(position.contact_phone);
    if (normalizedPhone && normalizedPhone.length >= 10) {
      const parishes = db.prepare(
        "SELECT * FROM parishes WHERE phone != '' AND phone IS NOT NULL"
      ).all();
      for (const p of parishes) {
        if (normalizeDioceseName(p.diocese) === posNormDiocese && normalizePhone(p.phone) === normalizedPhone) {
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
  // For positions with parenthesized city hints like "Christ (Budd Lake)" where diocese is unknown.
  // Name + city together is a strong enough signal to match confidently.
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
  // For positions like "St Julians Episcopal Church" where we have a clear name but no diocese/city.
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
  // Position names like "Wethersfield and Glastonbury" or "Trinity and Old Swedes (Wilmington)"
  // contain city names or parenthesized city hints that can match parishes by location.
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
    // e.g., "Wethersfield and Glastonbury, Diocese of Connecticut"
    // or "Trinity Torrington and Trinity Lime Rock, Diocese of Connecticut"
    const cleanedName = position.name.replace(/,\s*Diocese of.*/i, '');
    const nameParts = cleanedName.split(/\s+and\s+/i);
    for (const part of nameParts) {
      const stripped = part.trim().replace(/\(.*?\)/, '').trim();
      // Try the whole part as a city, then try individual words (for "Trinity Torrington" -> "Torrington")
      const candidates = [stripped];
      const words = stripped.split(/\s+/);
      if (words.length > 1) {
        // Add individual words as potential city names (skip very short ones)
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
    // For names like "Rosebud Episcopal Mission West, Diocese of South Dakota"
    const allWords = cleanedName.split(/[\s,]+/).filter(w => w.length >= 4 && !/^(episcopal|church|parish|mission|diocese|west|east|north|south|the|and)$/i.test(w));
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

/**
 * Multi-parish matching orchestrator.
 * Splits position names on \n and " and ", matches each part independently,
 * and returns the set that produces the most matches.
 *
 * @param {object} position - { name, diocese, website_url, contact_email, contact_phone }
 * @returns {Array<{ parish, confidence, method }>} Array of match results (may be empty)
 */
function matchPositionToParishes(position) {
  // Try unsplit match first
  const unsplitMatch = matchPositionToParish(position);
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

    const match = matchPositionToParish(syntheticPosition);
    if (match && !seenParishIds.has(match.parish.id)) {
      seenParishIds.add(match.parish.id);
      splitResults.push(match);
    }
  }

  // Use split results if they produced more distinct matches
  if (splitResults.length > unsplitResults.length) {
    console.log(`  Multi-parish split: "${position.name}" -> ${splitResults.length} matches (was ${unsplitResults.length})`);
    return splitResults;
  }

  return unsplitResults;
}

// ---------------------------------------------------------------------------
// DB-backed compensation attachment
// ---------------------------------------------------------------------------

function attachCompensation(position) {
  const db = getDb();
  const comp = db.prepare(`
    SELECT * FROM compensation_diocesan
    WHERE LOWER(diocese) = LOWER(?)
    ORDER BY year DESC LIMIT 1
  `).get(position.diocese || '');

  if (!comp) return position;

  return {
    ...position,
    compensation: {
      diocese_median: comp.all_median,
      diocese_female_median: comp.female_median,
      diocese_male_median: comp.male_median,
      diocese_clergy_count: comp.all_count,
      year: comp.year,
    },
  };
}

// ---------------------------------------------------------------------------
// DB-backed clergy info
// ---------------------------------------------------------------------------

function attachClergyInfo(parishId) {
  const db = getDb();

  const currentAssignment = db.prepare(`
    SELECT cp.*, c.first_name, c.last_name
    FROM clergy_positions cp
    JOIN clergy c ON c.guid = cp.clergy_guid
    WHERE cp.parish_id = ? AND cp.is_current = 1
    ORDER BY cp.start_date DESC LIMIT 1
  `).get(parishId);

  let current_clergy = null;
  if (currentAssignment) {
    const startDate = currentAssignment.start_date;
    let yearsTenure = 0;
    if (startDate) {
      const parts = startDate.split('/');
      if (parts.length === 3) {
        const startYear = parseInt(parts[2], 10);
        yearsTenure = new Date().getFullYear() - startYear;
      } else if (parts.length === 1) {
        yearsTenure = new Date().getFullYear() - parseInt(parts[0], 10);
      }
    }

    current_clergy = {
      name: `${currentAssignment.first_name} ${currentAssignment.last_name}`.trim(),
      position_title: currentAssignment.position_title || '',
      start_date: startDate || '',
      years_tenure: Math.max(0, yearsTenure),
    };
  }

  const allPositions = db.prepare(`
    SELECT cp.start_date, cp.end_date, cp.position_title
    FROM clergy_positions cp
    WHERE cp.parish_id = ?
    ORDER BY cp.start_date DESC
  `).all(parishId);

  let recentCount = 0;
  let totalTenure = 0;
  const tenYearsAgo = new Date().getFullYear() - 10;

  for (const pos of allPositions) {
    let startYear = null;
    if (pos.start_date) {
      const parts = pos.start_date.split('/');
      startYear = parseInt(parts[parts.length - 1], 10);
    }
    let endYear = new Date().getFullYear();
    if (pos.end_date) {
      const parts = pos.end_date.split('/');
      endYear = parseInt(parts[parts.length - 1], 10);
    }

    if (startYear && (endYear >= tenYearsAgo || !pos.end_date)) {
      recentCount++;
    }
    if (startYear && endYear) {
      totalTenure += endYear - startYear;
    }
  }

  const avgTenure = allPositions.length > 0 ? totalTenure / allPositions.length : 0;

  return {
    current_clergy,
    parish_clergy_history: {
      recent_count: recentCount,
      avg_tenure_years: Math.round(avgTenure * 10) / 10,
    },
  };
}

// ---------------------------------------------------------------------------
// Diocese percentiles (reads parochial-data.json for now)
// ---------------------------------------------------------------------------

function computeDiocesePercentiles(positions) {
  const parochialData = load('parochial-data.json');
  if (!parochialData || !parochialData.congregations) {
    console.log('Diocese percentiles: 0 positions (no parochial data)');
    return;
  }

  const dioceseMetrics = {};
  for (const cong of parochialData.congregations) {
    if (!cong.diocese || !cong.years) continue;
    const yearKeys = Object.keys(cong.years).sort();
    if (yearKeys.length === 0) continue;
    const latest = cong.years[yearKeys[yearKeys.length - 1]];
    if (!latest) continue;

    if (!dioceseMetrics[cong.diocese]) {
      dioceseMetrics[cong.diocese] = { asa: [], platePledge: [], membership: [] };
    }
    const dm = dioceseMetrics[cong.diocese];
    if (latest.averageAttendance != null && latest.averageAttendance > 0) {
      dm.asa.push(latest.averageAttendance);
    }
    if (latest.plateAndPledge != null && latest.plateAndPledge > 0) {
      dm.platePledge.push(latest.plateAndPledge);
    }
    if (latest.membership != null && latest.membership > 0) {
      dm.membership.push(latest.membership);
    }
  }

  for (const dm of Object.values(dioceseMetrics)) {
    dm.asa.sort((a, b) => a - b);
    dm.platePledge.sort((a, b) => a - b);
    dm.membership.sort((a, b) => a - b);
  }

  function percentile(sortedArr, value) {
    let below = 0;
    for (let i = 0; i < sortedArr.length; i++) {
      if (sortedArr[i] < value) below++;
      else break;
    }
    return Math.round((below / sortedArr.length) * 100);
  }

  let count = 0;
  for (const pos of positions) {
    const posParochial = pos.parochials && pos.parochials[0];
    if (!posParochial || !pos.diocese) continue;
    const dm = dioceseMetrics[pos.diocese];
    if (!dm) continue;

    const yearKeys = Object.keys(posParochial.years || {}).sort();
    if (yearKeys.length === 0) continue;
    const latest = posParochial.years[yearKeys[yearKeys.length - 1]];
    if (!latest) continue;

    const pctile = {};
    if (latest.averageAttendance != null && latest.averageAttendance > 0 && dm.asa.length > 0) {
      pctile.asa = percentile(dm.asa, latest.averageAttendance);
      pctile.asa_value = latest.averageAttendance;
    }
    if (latest.plateAndPledge != null && latest.plateAndPledge > 0 && dm.platePledge.length > 0) {
      pctile.plate_pledge = percentile(dm.platePledge, latest.plateAndPledge);
      pctile.plate_pledge_value = latest.plateAndPledge;
    }
    if (latest.membership != null && latest.membership > 0 && dm.membership.length > 0) {
      pctile.membership = percentile(dm.membership, latest.membership);
      pctile.membership_value = latest.membership;
    }

    if (Object.keys(pctile).length > 0) {
      pos.diocese_percentiles = pctile;
      count++;
    }
  }

  console.log(`Diocese percentiles: ${count} positions`);
}

// ---------------------------------------------------------------------------
// Estimated total compensation
// ---------------------------------------------------------------------------

function computeEstimatedTotalComp(positions, profileFields) {
  let count = 0;
  for (const pos of positions) {
    let minStipend = parseStipend(pos.minimum_stipend);
    let maxStipend = parseStipend(pos.maximum_stipend);

    // Fallback: check profile fields for stipend data
    if (minStipend == null && maxStipend == null && profileFields && pos.vh_id) {
      const fields = profileFields[String(pos.vh_id)];
      if (Array.isArray(fields)) {
        for (const f of fields) {
          const label = (f.label || '').toLowerCase();
          if (label.includes('minimum') && label.includes('stipend') && minStipend == null) {
            minStipend = parseStipend(f.value);
          }
          if (label.includes('maximum') && label.includes('stipend') && maxStipend == null) {
            maxStipend = parseStipend(f.value);
          }
        }

        // Fallback: parse "Range" fields
        if (minStipend == null && maxStipend == null) {
          const rangeFields = fields.filter(f => (f.label || '').toLowerCase() === 'range');
          for (const rf of rangeFields) {
            const val = (rf.value || '').trim();
            const rangeMatch = val.match(/\$?([\d,]+)\s*[-\u2013]\s*\$?([\d,]+)/);
            if (rangeMatch && minStipend == null) {
              const lo = parseStipend(rangeMatch[1]);
              const hi = parseStipend(rangeMatch[2]);
              if (lo != null) minStipend = lo;
              if (hi != null) maxStipend = hi;
              continue;
            }
            const singleMatch = val.match(/\$\s*([\d,]+)/);
            if (singleMatch && minStipend == null && maxStipend == null) {
              const parsed = parseStipend(singleMatch[1]);
              if (parsed != null) minStipend = parsed;
            }
          }
        }
      }
    }

    // Fallback: parse salary_range field
    if (minStipend == null && maxStipend == null && pos.salary_range) {
      const rangeMatch = pos.salary_range.match(/\$?([\d,]+)\s*[-\u2013]\s*\$?([\d,]+)/);
      if (rangeMatch) {
        minStipend = parseStipend(rangeMatch[1]);
        maxStipend = parseStipend(rangeMatch[2]);
      }
    }

    // Fallback: parse all_fields Range entries
    if (minStipend == null && maxStipend == null && Array.isArray(pos.all_fields)) {
      const rangeFields = pos.all_fields.filter(f => (f.label || '').toLowerCase() === 'range');
      for (const rf of rangeFields) {
        const val = (rf.value || '').trim();
        const rangeMatch = val.match(/\$?([\d,]+)\s*[-\u2013]\s*\$?([\d,]+)/);
        if (rangeMatch && minStipend == null) {
          const lo = parseStipend(rangeMatch[1]);
          const hi = parseStipend(rangeMatch[2]);
          if (lo != null) minStipend = lo;
          if (hi != null) maxStipend = hi;
          continue;
        }
        const singleMatch = val.match(/\$\s*([\d,]+)/);
        if (singleMatch && minStipend == null && maxStipend == null) {
          const parsed = parseStipend(singleMatch[1]);
          if (parsed != null) minStipend = parsed;
        }
      }
    }

    if (minStipend == null && maxStipend == null) continue;

    let basePay;
    if (minStipend != null && maxStipend != null) {
      basePay = (minStipend + maxStipend) / 2;
    } else {
      basePay = minStipend != null ? minStipend : maxStipend;
    }

    let totalComp = basePay;
    let housingValue = 0;

    let housingType = (pos.housing_type || '').toLowerCase();
    // Fallback: check profile fields for housing type
    if (!housingType && profileFields && pos.vh_id) {
      const fields = profileFields[String(pos.vh_id)];
      if (Array.isArray(fields)) {
        for (const f of fields) {
          if ((f.label || '').toLowerCase().includes('housing')) {
            housingType = (f.value || '').toLowerCase();
            break;
          }
        }
      }
    }
    const housingProvided = housingType &&
      !housingType.includes('no housing') &&
      (/rectory|housing provided|bed|bath|required/.test(housingType));

    if (housingProvided) {
      housingValue = 20000;
      totalComp += housingValue;
    }

    pos.estimated_total_comp = Math.round(totalComp);
    pos.comp_breakdown = { stipend: Math.round(basePay) };
    if (housingValue > 0) {
      pos.comp_breakdown.housing = housingValue;
    }
    count++;
  }
  console.log(`Estimated total comp: ${count} positions`);
}

// ---------------------------------------------------------------------------
// Similar positions
// ---------------------------------------------------------------------------

function computeSimilarPositions(allPositions) {
  const posData = [];
  for (const pos of allPositions) {
    const id = pos.id || String(pos.vh_id);
    if (!id) continue;

    let asa = null;
    const firstParochial = pos.parochials && pos.parochials[0];
    if (firstParochial && firstParochial.years) {
      const yearKeys = Object.keys(firstParochial.years).sort();
      if (yearKeys.length > 0) {
        const latest = firstParochial.years[yearKeys[yearKeys.length - 1]];
        if (latest && latest.averageAttendance != null && latest.averageAttendance > 0) {
          asa = latest.averageAttendance;
        }
      }
    }

    const comp = pos.estimated_total_comp || null;
    const state = (pos.church_infos && pos.church_infos[0] && pos.church_infos[0].state) || pos.state || '';
    const positionType = pos.position_type || '';
    const housingType = (pos.housing_type || '').toLowerCase();
    const name = (pos.church_infos && pos.church_infos[0] && pos.church_infos[0].name) || pos.name || '';
    const city = (pos.church_infos && pos.church_infos[0] && pos.church_infos[0].city) || pos.city || '';

    if (asa == null && comp == null) continue;

    posData.push({ pos, id, vh_id: pos.vh_id, asa, comp, state, positionType, housingType, name, city });
  }

  let count = 0;
  for (let i = 0; i < posData.length; i++) {
    const a = posData[i];
    const scored = [];

    for (let j = 0; j < posData.length; j++) {
      if (i === j) continue;
      const b = posData[j];

      let score = 0;

      if (a.asa != null && b.asa != null) {
        const ratio = b.asa / a.asa;
        if (ratio >= 0.75 && ratio <= 1.25) score += 3;
      }

      if (a.comp != null && b.comp != null) {
        const ratio = b.comp / a.comp;
        if (ratio >= 0.8 && ratio <= 1.2) score += 2;
      }

      if (a.state && b.state && a.state === b.state) score += 2;
      if (a.positionType && b.positionType && a.positionType === b.positionType) score += 2;
      if (a.housingType && b.housingType && a.housingType === b.housingType) score += 1;

      if (score >= 3) {
        scored.push({
          id: b.id,
          vh_id: b.vh_id,
          name: b.name,
          city: b.city,
          state: b.state,
          position_type: b.positionType,
          asa: b.asa,
          estimated_total_comp: b.comp,
          score,
        });
      }
    }

    if (scored.length > 0) {
      scored.sort((x, y) => y.score - x.score);
      a.pos.similar_positions = scored.slice(0, 5);
      count++;
    }
  }

  console.log(`Similar positions: ${count} positions with recommendations`);
}

// ---------------------------------------------------------------------------
// Census data
// ---------------------------------------------------------------------------

function attachCensusData(positions) {
  const censusData = load('census-data.json');
  if (!censusData || Object.keys(censusData).length === 0) {
    console.log('Census data: 0 positions (no census-data.json)');
    return;
  }

  let count = 0;
  for (const pos of positions) {
    const rawZip = (pos.church_infos && pos.church_infos[0] && pos.church_infos[0].zip) || pos.postal_code || '';
    const zip = rawZip.replace(/[^0-9]/g, '').substring(0, 5);
    if (zip.length !== 5) continue;

    const data = censusData[zip];
    if (data) {
      pos.census = data;
      count++;
    }
  }

  console.log(`Census data: ${count} positions`);
}

// ---------------------------------------------------------------------------
// Quality scores
// ---------------------------------------------------------------------------

function computeQualityScores(positions, isPublic) {
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const ACTIVE_STATUSES = ['Receiving names', 'Reopened', 'Seeking interim'];
  const IN_PROGRESS_STATUSES = ['Developing profile', 'Beginning search', 'Profile complete'];

  for (const pos of positions) {
    if (isPublic) {
      pos.quality_score = 100;
      pos.quality_components = ['Public listing (100)'];
      pos.visibility = 'public';
      continue;
    }

    let score = 0;
    const components = [];
    const status = pos.vh_status || '';

    // Listing legitimacy (60 points max)
    if (ACTIVE_STATUSES.includes(status)) {
      score += 25;
      components.push('Active status (25)');
    } else if (IN_PROGRESS_STATUSES.includes(status)) {
      score += 15;
      components.push('In-progress status (15)');
    }

    const fromDate = parseMMDDYYYY(pos.receiving_names_from);
    if (fromDate && fromDate >= oneYearAgo) {
      score += 15;
      components.push('Recent date (15)');
      if (fromDate >= threeMonthsAgo) {
        score += 5;
        components.push('Very recent date (5)');
      }
    }

    const name = pos.name || '';
    if (name && !name.startsWith('Position in') && name !== 'Unknown Position') {
      score += 10;
      components.push('Congregation identified (10)');
    }

    const posName = pos.congregation || pos.position_title || '';
    if (posName && !posName.startsWith('Position in')) {
      score += 5;
      components.push('Position named (5)');
    }

    // Data richness (40 points max)
    if (pos.church_infos && pos.church_infos.length > 0) {
      score += 10;
      components.push('Church matched (10)');
    }

    if (pos.parochials && pos.parochials[0] && Object.keys(pos.parochials[0].years || {}).length > 0) {
      score += 10;
      components.push('Parochial data (10)');
    }

    if (pos.position_type) {
      score += 5;
      components.push('Position type (5)');
    }

    if (pos.state) {
      score += 5;
      components.push('State known (5)');
    }

    if (pos.match_confidence === 'exact') {
      score += 5;
      components.push('Exact match (5)');
    }

    const toDate = pos.receiving_names_to || '';
    if (toDate && toDate !== 'Open ended') {
      score += 5;
      components.push('End date set (5)');
    }

    // Entries with no congregation name should never be visible by default
    if (name.startsWith('Position in') || name === 'Unknown Position') {
      score = Math.min(score, 45);
      components.push('No congregation name (capped at 45)');
    }

    pos.quality_score = Math.min(score, 100);
    pos.quality_components = components;
    pos.visibility = score >= 50 ? 'extended' : 'extended_hidden';
  }

  const avg = positions.length > 0
    ? Math.round(positions.reduce((s, p) => s + (p.quality_score || 0), 0) / positions.length)
    : 0;
  const hidden = positions.filter(p => p.visibility === 'extended_hidden').length;
  console.log(`Quality scores: avg ${avg}, ${hidden} hidden (< 50)`);
}

// ---------------------------------------------------------------------------
// DB-backed parish data lookup (replaces registry + position-map chain)
// ---------------------------------------------------------------------------

/**
 * Look up parochial data for a parish from the DB.
 * Returns an object shaped like the old registry parochial field:
 * { years: { '2023': { averageAttendance, plateAndPledge, membership, operatingRevenue } } }
 */
function getParochialFromDb(parishNid) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM parochial_data WHERE parish_nid = ? ORDER BY year'
  ).all(String(parishNid));

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
 * Look up parochial data by congregation name (matching parochial_data.parish_nid
 * which stores congregation names like "St. Paul's (Alexandria)").
 */
function getParochialByName(congName) {
  if (!congName) return null;
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM parochial_data WHERE parish_nid = ? ORDER BY year'
  ).all(congName);

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
 * Build church_info object from a parish DB row.
 */
function buildChurchInfo(parish) {
  if (!parish) return null;
  return {
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
// Parish context computation
// ---------------------------------------------------------------------------

/**
 * Compute neutral parish context data for a given parish ID.
 * Returns clergy tenure stats and attendance/giving/membership trends.
 * @param {number} parishId
 * @returns {object} ParishContext-shaped object
 */
function computeParishContext(parishId) {
  const db = getDb();
  const tenYearsAgo = new Date().getFullYear() - 10;

  // Clergy history
  const allClergy = db.prepare(`
    SELECT start_date, end_date, is_current FROM clergy_positions WHERE parish_id = ?
  `).all(parishId);

  const currentCount = allClergy.filter(c => c.is_current).length;

  // Filter clergy to those who started or ended within the last 10 years, or are current.
  const recentClergy = allClergy.filter(c => {
    if (c.is_current) return true;
    const startYear = c.start_date ? parseInt(c.start_date.split('/').pop(), 10) : null;
    const endYear = c.end_date ? parseInt(c.end_date.split('/').pop(), 10) : null;
    if (endYear && endYear >= tenYearsAgo) return true;
    if (startYear && startYear >= tenYearsAgo) return true;
    return false;
  });

  // Compute average tenure
  let totalTenure = 0;
  let tenureCount = 0;
  for (const c of recentClergy) {
    const startYear = c.start_date ? parseInt(c.start_date.split('/').pop(), 10) : null;
    const endYear = c.is_current
      ? new Date().getFullYear()
      : (c.end_date ? parseInt(c.end_date.split('/').pop(), 10) : null);
    if (startYear && endYear && endYear >= startYear) {
      totalTenure += endYear - startYear;
      tenureCount++;
    }
  }
  const avgTenure = tenureCount > 0 ? Math.round((totalTenure / tenureCount) * 10) / 10 : null;

  // Parochial data trends
  const parish = db.prepare(`SELECT nid FROM parishes WHERE id = ?`).get(parishId);
  const nid = parish?.nid;

  let attendanceTrend = null;
  let attendanceChangePct = null;
  let givingTrend = null;
  let givingChangePct = null;
  let membershipTrend = null;
  let membershipChangePct = null;
  let latestRevenue = null;
  let yearsOfData = 0;

  if (nid) {
    const rows = db.prepare(`
      SELECT year, average_attendance, plate_and_pledge, membership, operating_revenue
      FROM parochial_data WHERE parish_nid = ? ORDER BY year ASC
    `).all(nid);

    yearsOfData = rows.length;

    if (rows.length >= 2) {
      const first = rows[0];
      const last = rows[rows.length - 1];

      // Attendance trend
      if (first.average_attendance && last.average_attendance) {
        const pct = ((last.average_attendance - first.average_attendance) / first.average_attendance) * 100;
        attendanceChangePct = Math.round(pct * 10) / 10;
        attendanceTrend = pct > 5 ? 'growing' : pct < -5 ? 'declining' : 'stable';
      }

      // Giving trend
      if (first.plate_and_pledge && last.plate_and_pledge) {
        const pct = ((last.plate_and_pledge - first.plate_and_pledge) / first.plate_and_pledge) * 100;
        givingChangePct = Math.round(pct * 10) / 10;
        givingTrend = pct > 5 ? 'growing' : pct < -5 ? 'declining' : 'stable';
      }

      // Membership trend
      if (first.membership && last.membership) {
        const pct = ((last.membership - first.membership) / first.membership) * 100;
        membershipChangePct = Math.round(pct * 10) / 10;
        membershipTrend = pct > 5 ? 'growing' : pct < -5 ? 'declining' : 'stable';
      }

      // Latest operating revenue
      latestRevenue = last.operating_revenue || null;
    } else if (rows.length === 1) {
      latestRevenue = rows[0].operating_revenue || null;
    }
  }

  return {
    clergy_count_10yr: recentClergy.length,
    avg_tenure_years: avgTenure,
    current_clergy_count: currentCount,
    attendance_trend: attendanceTrend,
    attendance_change_pct: attendanceChangePct,
    giving_trend: givingTrend,
    giving_change_pct: givingChangePct,
    membership_trend: membershipTrend,
    membership_change_pct: membershipChangePct,
    latest_operating_revenue: latestRevenue,
    years_of_data: yearsOfData,
  };
}

// ---------------------------------------------------------------------------
// Main enrichment pipeline
// ---------------------------------------------------------------------------

function enrichPositions() {
  // Backfill lat/lng from Asset Map parishes to ECDPlus parishes that lack coordinates.
  // Asset Map parishes have coordinates; ECDPlus ones often don't.
  // Match by normalized church name + normalized diocese name, then copy lat/lng.
  const db = getDb();
  const ecdNoCoords = db.prepare(
    "SELECT p.id, p.diocese FROM parishes p WHERE p.source = 'ecdplus' AND (p.lat IS NULL OR p.lat = 0)"
  ).all();
  if (ecdNoCoords.length > 0) {
    // Build index of Asset Map parishes with coords, keyed by normalized alias
    const amWithCoords = db.prepare(`
      SELECT p.id, p.diocese, p.lat, p.lng, pa.alias_normalized
      FROM parishes p
      JOIN parish_aliases pa ON pa.parish_id = p.id
      WHERE p.source IN ('asset_map', 'both')
        AND p.lat IS NOT NULL AND p.lat != 0
    `).all();
    const amIndex = {};
    for (const row of amWithCoords) {
      const key = row.alias_normalized;
      if (!amIndex[key]) amIndex[key] = [];
      amIndex[key].push(row);
    }

    // Build a map of ECDPlus parish aliases
    const ecdAliases = db.prepare(`
      SELECT parish_id, alias_normalized FROM parish_aliases
      WHERE parish_id IN (SELECT id FROM parishes WHERE source = 'ecdplus' AND (lat IS NULL OR lat = 0))
    `).all();
    const ecdAliasMap = {};
    for (const a of ecdAliases) {
      if (!ecdAliasMap[a.parish_id]) ecdAliasMap[a.parish_id] = [];
      ecdAliasMap[a.parish_id].push(a.alias_normalized);
    }

    const updateCoords = db.prepare('UPDATE parishes SET lat = ?, lng = ? WHERE id = ?');
    let backfillCount = 0;
    const runBackfill = db.transaction(() => {
      for (const ecd of ecdNoCoords) {
        const aliases = ecdAliasMap[ecd.id] || [];
        const ecdDiocNorm = normalizeDioceseName(ecd.diocese);
        for (const alias of aliases) {
          const candidates = amIndex[alias] || [];
          const match = candidates.find(c => normalizeDioceseName(c.diocese) === ecdDiocNorm);
          if (match) {
            updateCoords.run(match.lat, match.lng, ecd.id);
            backfillCount++;
            break;
          }
        }
      }
    });
    runBackfill();
    if (backfillCount > 0) {
      console.log(`Coordinate backfill: ${backfillCount} ECDPlus parishes updated from Asset Map`);
    }
  }

  const positions = load('positions.json');
  const allProfiles = load('all-profiles.json');
  const profileFields = load('profile-fields.json');
  const dioceseOverrides = load('manual-diocese-overrides.json') || {};
  const manualVhIds = load('manual-vh-ids.json') || {};

  if (!positions) { console.error('No positions.json found'); process.exit(1); }

  // Detect duplicate VH IDs (multi-point calls sharing a profile)
  const vhIdCounts = {};
  for (const pos of positions) {
    if (pos.vh_id) vhIdCounts[pos.vh_id] = (vhIdCounts[pos.vh_id] || 0) + 1;
  }

  let churchMatches = 0, parochialMatches = 0;
  let noVhIdCount = 0, badUrlCleared = 0;

  // Enrich public positions (from search results)
  for (const pos of positions) {
    let vhId = pos.vh_id;
    if (!pos.city) pos.city = extractCity(pos.name);

    // Fix bogus 1900 year in receiving dates
    if (pos.receiving_names_from) pos.receiving_names_from = fixBogusYear(pos.receiving_names_from);
    if (pos.receiving_names_to) pos.receiving_names_to = fixBogusYear(pos.receiving_names_to);
    if (pos.receiving_date) pos.receiving_date = fixBogusYear(pos.receiving_date);

    // Extract vh_id from profile_url if missing, and validate the mapping
    if (!vhId && pos.profile_url) {
      const urlMatch = pos.profile_url.match(/PositionView\/(\d+)/);
      if (urlMatch) {
        const candidateId = parseInt(urlMatch[1], 10);
        const profile = allProfiles ? allProfiles.find(p => p.vh_id === candidateId) : null;
        if (profile) {
          const posNorm = normalizeChurchName(pos.name);
          const profNorm = normalizeChurchName(profile.congregation || '');
          const posWords = posNorm.split(/\s+/).filter(w => w.length >= 3);
          const profWords = profNorm.split(/\s+/).filter(w => w.length >= 3);
          const genericWords = new Set(['church', 'episcopal', 'parish', 'chapel', 'cathedral', 'mission', 'memorial', 'diocese']);
          const posKey = posWords.filter(w => !genericWords.has(w));
          const profKey = profWords.filter(w => !genericWords.has(w));
          if (posKey.length > 0 && profKey.length > 0 && posKey.some(w => profKey.includes(w))) {
            vhId = candidateId;
            pos.vh_id = candidateId;
          } else {
            console.log(`  Cleared mismatched profile_url: ${pos.name} -> VH ${candidateId} (${profile.congregation || 'no name'})`);
            pos.profile_url = null;
            badUrlCleared++;
          }
        } else {
          vhId = candidateId;
          pos.vh_id = candidateId;
        }
      }
    }

    // Apply manual VH ID overrides
    if (!vhId && manualVhIds[pos.id]) {
      vhId = manualVhIds[pos.id].vh_id;
      pos.vh_id = vhId;
      console.log(`  Applied manual VH ID: ${pos.name} -> VH ${vhId}`);
    }

    if (!vhId) noVhIdCount++;

    // Fix profile_url: always construct from vh_id
    if (vhId) {
      pos.profile_url = `https://vocationhub.episcopalchurch.org/PositionView/${vhId}`;
    }

    // Match position to parish(es) via DB
    const matchResults = matchPositionToParishes({
      name: pos.name,
      diocese: pos.diocese,
      website_url: pos.website_url || '',
      contact_email: pos.contact_email || '',
      contact_phone: pos.contact_phone || '',
    });

    if (matchResults.length > 0) {
      // For duplicate VH IDs with single match, cross-validate the church name
      // Skip this check for city-based matches (multi-congregation positions)
      let nameMatch = true;
      if (matchResults.length === 1) {
        const matchResult = matchResults[0];
        const isCityMatch = matchResult.method && /city|town|word/.test(matchResult.method);
        if (!isCityMatch && vhIdCounts[vhId] > 1 && pos.name && matchResult.parish) {
          const posNorm = normalizeChurchName(pos.name);
          const churchNorm = normalizeChurchName(matchResult.parish.name);
          if (posNorm && churchNorm) {
            const posWords = posNorm.split(/\s+/).filter(w => w.length >= 3);
            const churchWords = churchNorm.split(/\s+/).filter(w => w.length >= 3);
            const genericWords = new Set(['church', 'episcopal', 'parish', 'chapel', 'cathedral', 'mission', 'memorial']);
            const posKey = posWords.filter(w => !genericWords.has(w));
            const churchKey = churchWords.filter(w => !genericWords.has(w));
            if (posKey.length > 0 && churchKey.length > 0 && !posKey.some(w => churchKey.includes(w))) {
              nameMatch = false;
            }
          }
        }
      }

      if (nameMatch) {
        churchMatches++;
        pos.church_infos = matchResults.map(r => buildChurchInfo(r.parish));
        pos.match_confidence = matchResults[0].confidence;

        // Get parochial data for all matched parishes
        const parochials = [];
        for (const r of matchResults) {
          const parishNameWithCity = r.parish.city
            ? `${r.parish.name} (${r.parish.city})`
            : r.parish.name;
          const parochial = getParochialByName(parishNameWithCity)
            || getParochialByName(r.parish.name)
            || getParochialFromDb(r.parish.nid);
          if (parochial) {
            parochials.push(parochial);
          }
        }
        if (parochials.length > 0) {
          parochialMatches++;
          pos.parochials = parochials;
        }

        // Attach compensation from DB
        const enriched = attachCompensation(pos);
        if (enriched.compensation) pos.compensation = enriched.compensation;

        // Attach clergy info from DB (first match only)
        const clergyInfo = attachClergyInfo(matchResults[0].parish.id);
        if (clergyInfo.current_clergy || clergyInfo.parish_clergy_history.recent_count > 0) {
          pos.clergy = clergyInfo;
        }

        // Attach parish contexts for all matches
        pos.parish_contexts = matchResults.map(r => computeParishContext(r.parish.id));
      }
    }
  }

  console.log(`Public positions: ${positions.length}`);
  console.log(`  Church matches: ${churchMatches}`);
  console.log(`  Parochial matches: ${parochialMatches}`);
  if (noVhIdCount) console.log(`  No VH ID: ${noVhIdCount}`);
  if (badUrlCleared) console.log(`  Bad profile URLs cleared: ${badUrlCleared}`);

  computeDiocesePercentiles(positions);
  computeEstimatedTotalComp(positions, profileFields);
  computeSimilarPositions(positions);
  attachCensusData(positions);
  computeQualityScores(positions, true);

  fs.writeFileSync(
    path.join(DATA_DIR, 'enriched-positions.json'),
    JSON.stringify(positions, null, 2)
  );

  // Build extended positions: ALL profiles not in search results
  if (allProfiles) {
    const publicVhIds = new Set(positions.map(p => p.vh_id).filter(Boolean));
    let extChurch = 0, extParochial = 0;
    let websiteMatches = 0;

    const extended = [];
    for (const profile of allProfiles) {
      if (publicVhIds.has(profile.vh_id)) continue;

      const vhId = profile.vh_id;

      // Try matching via DB
      const matchResults = matchPositionToParishes({
        name: profile.congregation || '',
        diocese: profile.diocese || '',
        website_url: profile.website || '',
        contact_email: '',
        contact_phone: '',
      });
      let matchResult = matchResults.length > 0 ? matchResults[0] : null;

      // Backfill diocese from church_info if profile has none
      let diocese = profile.diocese || '';
      if (diocese && /^https?:\/\/|\.org|\.com|\.net|\.edu/i.test(diocese)) diocese = '';
      if (!diocese && matchResult && matchResult.parish) {
        diocese = matchResult.parish.diocese || '';
      }

      // Apply manual overrides
      const override = dioceseOverrides[String(vhId)];
      if (override) {
        if (!diocese && override.diocese) diocese = override.diocese;
      }

      // Build church data from match(es)
      let churchInfos = [];
      let parochials = [];
      let parishContexts = [];
      let matchConfidence = null;

      if (matchResults.length > 0) {
        churchInfos = matchResults.map(r => buildChurchInfo(r.parish));
        matchConfidence = matchResults[0].confidence;

        for (const r of matchResults) {
          const parishNameWithCity = r.parish.city
            ? `${r.parish.name} (${r.parish.city})`
            : r.parish.name;
          const parochial = getParochialByName(parishNameWithCity)
            || getParochialByName(r.parish.name)
            || getParochialFromDb(r.parish.nid);
          if (parochial) parochials.push(parochial);
        }

        parishContexts = matchResults.map(r => computeParishContext(r.parish.id));
      }

      // Build display name
      let displayName = profile.congregation || '';
      if (!displayName && matchResult && (matchResult.confidence === 'exact' || matchResult.confidence === 'high')) {
        displayName = `${matchResult.parish.name}, ${matchResult.parish.city}, ${matchResult.parish.state}`;
      }
      if (!displayName) {
        displayName = diocese ? `Position in ${diocese}` : 'Unknown Position';
      }

      if (matchResults.length > 0) extChurch++;
      if (parochials.length > 0) extParochial++;
      if (matchResult && matchResult.method === 'website') websiteMatches++;

      // Track if original date was 01/01/1900
      const hadBogusDate = /^01\/01\/1900/.test(profile.receiving_names_from || '');

      // Fix bogus 1900 year
      if (profile.receiving_names_from) {
        profile.receiving_names_from = fixBogusYear(profile.receiving_names_from);
      }
      if (profile.receiving_names_to) {
        profile.receiving_names_to = fixBogusYear(profile.receiving_names_to);
      }

      // Infer status
      let inferredStatus = profile.status || '';
      const fromDate = parseMMDDYYYY(profile.receiving_names_from);
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      if (!inferredStatus) {
        if (fromDate) {
          inferredStatus = fromDate >= oneYearAgo ? 'Receiving names' : 'Search complete';
        } else {
          inferredStatus = 'Developing profile';
        }
      }

      if (fromDate && fromDate < oneYearAgo && inferredStatus !== 'Search complete' && inferredStatus !== 'No longer receiving names') {
        inferredStatus = 'Search complete';
      }

      if (hadBogusDate && inferredStatus !== 'Search complete' && inferredStatus !== 'No longer receiving names') {
        inferredStatus = 'Search complete';
      }

      // Determine state
      const state = (matchResult && matchResult.parish && matchResult.parish.state) || (override && override.state) || '';

      // Fallback position_type from order_of_ministry
      let positionType = profile.position_type || '';
      if (!positionType && profile.order_of_ministry) {
        const order = profile.order_of_ministry.toLowerCase();
        if (order.includes('priest')) positionType = 'Rector / Vicar / Priest-in-Charge';
        else if (order.includes('deacon')) positionType = 'Deacon';
        else if (order.includes('bishop')) positionType = 'Bishop';
        else positionType = profile.order_of_ministry;
      }
      if (!positionType && profile.congregation && profile.congregation.includes('\n')) {
        positionType = 'Priest-in-Charge Shared Ministry';
      }

      const extPos = {
        vh_id: vhId,
        name: displayName,
        diocese,
        state,
        vh_status: inferredStatus,
        profile_url: `https://vocationhub.episcopalchurch.org/PositionView/${vhId}`,
        position_type: positionType,
        congregation: profile.congregation || '',
        receiving_names_from: profile.receiving_names_from || '',
        receiving_names_to: profile.receiving_names_to || '',
        open_ended: profile.open_ended || false,
        church_infos: churchInfos.length > 0 ? churchInfos : undefined,
        match_confidence: matchConfidence || undefined,
        parochials: parochials.length > 0 ? parochials : undefined,
        // Carry through fields needed for comp estimation
        salary_range: profile.salary_range || undefined,
        housing_type: profile.housing_type || undefined,
        all_fields: profile.all_fields || undefined,
      };

      // Attach compensation from DB
      if (diocese) {
        const enriched = attachCompensation(extPos);
        if (enriched.compensation) extPos.compensation = enriched.compensation;
      }

      // Attach clergy info from DB (first match only)
      if (matchResult && matchResult.parish) {
        const clergyInfo = attachClergyInfo(matchResult.parish.id);
        if (clergyInfo.current_clergy || clergyInfo.parish_clergy_history.recent_count > 0) {
          extPos.clergy = clergyInfo;
        }

        // Attach parish contexts for all matches
        extPos.parish_contexts = parishContexts.length > 0 ? parishContexts : undefined;
      }

      extended.push(extPos);
    }

    console.log(`Extended positions: ${extended.length}`);
    console.log(`  Church matches: ${extChurch} (${websiteMatches} via website)`);
    console.log(`  Parochial matches: ${extParochial}`);

    computeDiocesePercentiles(extended);
    computeEstimatedTotalComp(extended, profileFields);
    computeSimilarPositions(extended);
    attachCensusData(extended);
    computeQualityScores(extended, false);

    // Strip temporary fields not needed by the frontend
    for (const pos of extended) {
      delete pos.salary_range;
      delete pos.all_fields;
    }

    fs.writeFileSync(
      path.join(DATA_DIR, 'enriched-extended.json'),
      JSON.stringify(extended, null, 2)
    );
  }

  console.log('\nEnriched data written to enriched-positions.json and enriched-extended.json');

  // --- Gap report ---
  const gaps = [];

  for (const pos of positions) {
    if (!pos.vh_id) {
      gaps.push({
        type: 'missing_vh_id',
        source: 'public',
        id: pos.id,
        name: pos.name,
        diocese: pos.diocese,
        state: pos.state,
        receiving_from: pos.receiving_names_from || '',
        note: 'Scraper click-through failed. Needs manual VH ID or backfill.',
      });
    }
  }

  for (const pos of positions) {
    if (pos.vh_id && (!pos.church_infos || pos.church_infos.length === 0)) {
      gaps.push({
        type: 'missing_church_match',
        source: 'public',
        vh_id: pos.vh_id,
        name: pos.name,
        diocese: pos.diocese,
        note: 'Has VH ID but no church registry match.',
      });
    }
  }

  {
    const extForGaps = load('enriched-extended.json') || [];
    for (const ext of extForGaps) {
      const status = ext.vh_status || '';
      if (status === 'Search complete' || status === 'No longer receiving names') continue;
      if ((!ext.church_infos || ext.church_infos.length === 0) && ext.vh_id) {
        gaps.push({
          type: 'missing_church_match',
          source: 'extended',
          vh_id: ext.vh_id,
          name: ext.name,
          diocese: ext.diocese || '',
          note: 'Active extended position with no church registry match.',
        });
      }
    }
  }

  const gapReport = {
    generated_at: new Date().toISOString(),
    summary: {
      missing_vh_id: gaps.filter(g => g.type === 'missing_vh_id').length,
      missing_church_match: gaps.filter(g => g.type === 'missing_church_match').length,
      total: gaps.length,
    },
    gaps,
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'needs-backfill.json'),
    JSON.stringify(gapReport, null, 2)
  );

  if (gapReport.summary.total > 0) {
    console.log(`\nGap report: ${gapReport.summary.total} positions need attention`);
    if (gapReport.summary.missing_vh_id > 0)
      console.log(`  Missing VH ID: ${gapReport.summary.missing_vh_id} (add to manual-vh-ids.json or wait for backfill)`);
    if (gapReport.summary.missing_church_match > 0)
      console.log(`  Missing church match: ${gapReport.summary.missing_church_match}`);
  }
}

// ---------------------------------------------------------------------------
// Exports + CLI
// ---------------------------------------------------------------------------

module.exports = {
  matchPositionToParish,
  matchPositionToParishes,
  attachCompensation,
  attachClergyInfo,
  enrichPositions,
  parseStipend,
  fixBogusYear,
  parseMMDDYYYY,
  computeEstimatedTotalComp,
  computeQualityScores,
  computeSimilarPositions,
  computeDiocesePercentiles,
  attachCensusData,
  isGenericDomain,
  extractCity,
  buildChurchInfo,
  getParochialFromDb,
  getParochialByName,
  computeParishContext,
};

if (require.main === module) {
  enrichPositions();
  closeDb();
}
