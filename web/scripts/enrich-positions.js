#!/usr/bin/env node
/**
 * Pre-build script: cross-references positions with church directory and
 * parochial report data, then writes enriched-positions.json.
 *
 * Run before `next build` to keep the client bundle small.
 * The heavy parochial-data.json (~15MB) is only used here, not imported by the frontend.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../public/data');

function load(name) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// --- Diocese normalization (shared logic) ---

function normalizeDiocese(diocese) {
  return diocese
    .toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/^episcopal\s+church\s+/i, '')
    .replace(/^episcopal\s+diocese\s+(of\s+)?/i, '')
    .replace(/^diocese\s+of\s+/i, '')
    .replace(/^diocesis\s+de\s+/i, '')
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
    .replace(/saint\b/g, 'st')
    .replace(/st\.\s*/g, 'st ')
    .replace(/['']/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/,.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Build indexes ---

function buildChurchIndex(churches) {
  const emailIndex = new Map();
  const dioceseIndex = new Map();

  for (const church of churches) {
    if (church.email) {
      const domain = church.email.split('@')[1]?.toLowerCase();
      if (domain) {
        const list = emailIndex.get(domain) || [];
        list.push(church);
        emailIndex.set(domain, list);
      }
    }
    if (church.diocese) {
      const key = normalizeDiocese(church.diocese);
      const list = dioceseIndex.get(key) || [];
      list.push(church);
      dioceseIndex.set(key, list);
    }
  }

  return { emailIndex, dioceseIndex };
}

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

// --- Matching ---

function isGenericDomain(domain) {
  return /diocese|dioc|edomi|ednin|gmail|yahoo|outlook|hotmail|aol|comcast|verizon|att\.net|icloud|cablelynx|ptd\.net|frontier|embarq/i.test(domain);
}

function extractEmails(fields) {
  const emails = [];
  for (const f of fields) {
    const found = f.value.match(/[\w.+-]+@[\w.-]+\.\w+/g);
    if (found) emails.push(...found);
  }
  return emails;
}

function fuzzyMatchChurch(name, candidates) {
  const normalized = normalizeChurchName(name);
  if (!normalized || normalized.length < 3) return null;

  for (const c of candidates) {
    if (normalizeChurchName(c.name) === normalized) return c;
  }

  const posTokens = normalized.split(/\s+/).filter(t => t.length > 2);
  if (posTokens.length === 0) return null;

  let best = null, bestScore = 0;
  for (const c of candidates) {
    const churchNorm = normalizeChurchName(c.name);
    const churchTokens = churchNorm.split(/\s+/).filter(t => t.length > 2);
    let matchCount = 0;
    for (const token of posTokens) {
      if (churchTokens.some(ct => ct === token || ct.startsWith(token) || token.startsWith(ct))) matchCount++;
    }
    const score = matchCount / posTokens.length;
    if (score > bestScore && score >= 0.6) { bestScore = score; best = c; }
  }
  return best;
}

function matchChurch(fields, diocese, positionName, churchIdx) {
  // Strategy 1: Email domain
  const emails = extractEmails(fields);
  for (const email of emails) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain || isGenericDomain(domain)) continue;
    const matches = churchIdx.emailIndex.get(domain);
    if (matches && matches.length === 1) return matches[0];
    if (matches && matches.length > 1 && diocese) {
      const dm = matches.find(c => normalizeDiocese(c.diocese) === normalizeDiocese(diocese));
      if (dm) return dm;
    }
  }

  // Strategy 2: Diocese + name
  if (diocese) {
    const candidates = churchIdx.dioceseIndex.get(normalizeDiocese(diocese)) || [];
    if (positionName) {
      const match = fuzzyMatchChurch(positionName, candidates);
      if (match) return match;
    }
  }

  return null;
}

function matchParochial(positionName, diocese, city, parochialIdx) {
  const candidates = parochialIdx.get(normalizeDiocese(diocese)) || [];
  if (candidates.length === 0) return null;

  const posNorm = normalizeChurchName(positionName);
  const posTokens = posNorm.split(/\s+/).filter(t => t.length > 2);
  if (posTokens.length === 0 && !city) return null;

  let best = null, bestScore = 0;
  for (const cong of candidates) {
    const m = cong.congregationCity.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    const congName = m ? m[1].trim() : cong.congregationCity;
    const congCity = m ? m[2].trim() : '';
    const congNorm = normalizeChurchName(congName);
    const congTokens = congNorm.split(/\s+/).filter(t => t.length > 2);

    let matchCount = 0;
    for (const token of posTokens) {
      if (congTokens.some(ct => ct === token || ct.startsWith(token) || token.startsWith(ct))) matchCount++;
    }
    let score = posTokens.length > 0 ? matchCount / posTokens.length : 0;
    if (city && congCity && city.toLowerCase() === congCity.toLowerCase()) score += 0.3;
    if (congNorm === posNorm) score = 2;
    if (score > bestScore && score >= 0.6) { bestScore = score; best = cong; }
  }

  return best;
}

// --- Main ---

function main() {
  const churches = load('churches.json');
  const parochial = load('parochial-data.json');
  const positions = load('positions.json');
  const allProfiles = load('all-profiles.json');
  const profileFields = load('profile-fields.json');

  if (!positions) { console.error('No positions.json found'); process.exit(1); }

  const churchIdx = churches ? buildChurchIndex(churches.churches) : { emailIndex: new Map(), dioceseIndex: new Map() };
  const parochialIdx = parochial ? buildParochialIndex(parochial.congregations) : new Map();

  let churchMatches = 0, parochialMatches = 0;

  // Enrich public positions
  for (const pos of positions) {
    const vhId = pos.vh_id;
    const fields = vhId && profileFields ? profileFields[String(vhId)] : [];

    // Extract city from position name parenthetical
    const cityMatch = (pos.name || '').match(/\(([^)]+)\)$/);
    if (!pos.city && cityMatch) pos.city = cityMatch[1].trim();

    // Church directory match
    const church = matchChurch(fields || [], pos.diocese, pos.name, churchIdx);
    if (church) {
      churchMatches++;
      pos.church_info = {
        name: church.name, street: church.street, city: church.city,
        state: church.state, zip: church.zip, phone: church.phone,
        email: church.email, website: church.website, type: church.type,
        lat: church.lat, lng: church.lng,
      };
    }

    // Parochial match
    const pm = matchParochial(pos.name, pos.diocese, pos.city, parochialIdx);
    if (pm) {
      parochialMatches++;
      pos.parochial = { congregationCity: pm.congregationCity, years: pm.years };
    }
  }

  console.log(`Public positions: ${positions.length}`);
  console.log(`  Church matches: ${churchMatches}`);
  console.log(`  Parochial matches: ${parochialMatches}`);

  // Write enriched positions
  fs.writeFileSync(
    path.join(DATA_DIR, 'enriched-positions.json'),
    JSON.stringify(positions, null, 2)
  );

  // Also enrich extended positions (active profiles not in search)
  if (allProfiles) {
    const publicVhIds = new Set(positions.map(p => p.vh_id).filter(Boolean));
    const activeStatuses = new Set(['Receiving names', 'Reopened']);
    let extChurch = 0, extParochial = 0;

    const extended = [];
    for (const profile of allProfiles) {
      if (!activeStatuses.has(profile.status)) continue;
      if (publicVhIds.has(profile.vh_id)) continue;

      const fields = profile.all_fields || [];
      const church = matchChurch(fields, profile.diocese || '', profile.congregation || '', churchIdx);
      const displayName = profile.congregation || (church ? `${church.name}, ${church.city}, ${church.state}` : '');

      if (!displayName && !profile.salary_range && !(profile.avg_sunday_attendance && profile.avg_sunday_attendance !== '0')) continue;

      const diocese = profile.diocese || '';
      const city = church?.city || '';
      const pm = displayName ? matchParochial(displayName, diocese, city, parochialIdx) : null;

      if (church) extChurch++;
      if (pm) extParochial++;

      extended.push({
        vh_id: profile.vh_id,
        name: displayName || `Position in ${diocese}`,
        diocese,
        vh_status: profile.status,
        profile_url: profile.profile_url,
        position_type: profile.position_type || '',
        church_info: church ? {
          name: church.name, street: church.street, city: church.city,
          state: church.state, zip: church.zip, phone: church.phone,
          email: church.email, website: church.website, type: church.type,
          lat: church.lat, lng: church.lng,
        } : undefined,
        parochial: pm ? { congregationCity: pm.congregationCity, years: pm.years } : undefined,
      });
    }

    console.log(`Extended positions: ${extended.length}`);
    console.log(`  Church matches: ${extChurch}`);
    console.log(`  Parochial matches: ${extParochial}`);

    fs.writeFileSync(
      path.join(DATA_DIR, 'enriched-extended.json'),
      JSON.stringify(extended, null, 2)
    );
  }

  console.log('\nEnriched data written to enriched-positions.json and enriched-extended.json');
}

main();
