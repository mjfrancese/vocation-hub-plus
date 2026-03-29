#!/usr/bin/env node
/**
 * Pre-build script: enriches positions using the canonical church registry
 * and position-church mapping. No fuzzy matching happens here -- all matching
 * decisions come from build-position-map.js and manual-mappings.json.
 *
 * Run after build-registry.js and build-position-map.js.
 * Output: enriched-positions.json, enriched-extended.json
 */

const fs = require('fs');
const path = require('path');
const { normalizeChurchName } = require('./lib/normalization');

const DATA_DIR = path.resolve(__dirname, '../public/data');

function parseMMDDYYYY(str) {
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
}

// Fix bogus 1900 year in dates - VH defaults empty year fields to 1900.
// For live positions, the month/day are correct but year should be current year.
// EXCEPTION: 01/01/1900 means "no date was ever entered" - clear it entirely.
function fixBogusYear(dateStr) {
  if (!dateStr) return dateStr;
  const currentYear = new Date().getFullYear();
  // If the entire string is 01/01/1900, it means no date was entered - return empty
  if (dateStr.trim() === '01/01/1900') return '';
  // For range strings like "01/01/1900 to 01/01/1900", clear entirely
  if (/^01\/01\/1900\s*(to\s*01\/01\/1900)?$/.test(dateStr.trim())) return '';
  // For any remaining /1900 dates with real month/day, fix to current year
  return dateStr.replace(/\/1900\b/g, `/${currentYear}`);
}

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

// --- Main ---

function main() {
  const registry = load('church-registry.json');
  const positionMap = load('position-church-map.json');
  const positions = load('positions.json');
  const allProfiles = load('all-profiles.json');
  const profileFields = load('profile-fields.json');
  const dioceseOverrides = load('manual-diocese-overrides.json') || {};
  const manualVhIds = load('manual-vh-ids.json') || {};

  if (!positions) { console.error('No positions.json found'); process.exit(1); }

  const churches = registry ? registry.churches : {};
  const mappings = positionMap ? positionMap.mappings : {};

  // Helper: look up church + parochial for a VH ID
  function getChurchData(vhId) {
    const mapping = mappings[String(vhId)];
    if (!mapping || mapping.flagged || !mapping.church_nid) return null;

    const church = churches[String(mapping.church_nid)];
    if (!church) return null;

    return {
      church_info: {
        nid: church.nid,
        name: church.name,
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
      },
      parochial: church.parochial || null,
      confidence: mapping.confidence,
      match_method: mapping.match_method,
    };
  }

  let churchMatches = 0, parochialMatches = 0;

  // Detect duplicate VH IDs (multi-point calls sharing a profile)
  const vhIdCounts = {};
  for (const pos of positions) {
    if (pos.vh_id) vhIdCounts[pos.vh_id] = (vhIdCounts[pos.vh_id] || 0) + 1;
  }

  // Enrich public positions (from search results)
  let noVhIdCount = 0, badUrlCleared = 0;
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
        // Validate: check if this VH ID's profile matches this position's name/diocese
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
            // Mismatched profile_url - clear it to avoid sending users to wrong page
            console.log(`  Cleared mismatched profile_url: ${pos.name} -> VH ${candidateId} (${profile.congregation || 'no name'})`);
            pos.profile_url = null;
            badUrlCleared++;
          }
        } else {
          // Profile not found in all-profiles, but URL might still be valid
          vhId = candidateId;
          pos.vh_id = candidateId;
        }
      }
    }

    // Layer 1: Apply manual VH ID overrides for positions the scraper couldn't map
    if (!vhId && manualVhIds[pos.id]) {
      vhId = manualVhIds[pos.id].vh_id;
      pos.vh_id = vhId;
      console.log(`  Applied manual VH ID: ${pos.name} -> VH ${vhId}`);
    }

    if (!vhId) noVhIdCount++;

    // Fix profile_url: always construct from vh_id to avoid scraper mapping bugs
    if (vhId) {
      pos.profile_url = `https://vocationhub.episcopalchurch.org/PositionView/${vhId}`;
    }

    if (vhId) {
      const data = getChurchData(vhId);
      if (data) {
        // For duplicate VH IDs, cross-validate the church name matches this specific position
        let nameMatch = true;
        if (vhIdCounts[vhId] > 1 && pos.name && data.church_info) {
          const posNorm = normalizeChurchName(pos.name);
          const churchNorm = normalizeChurchName(data.church_info.name);
          if (posNorm && churchNorm) {
            const posWords = posNorm.split(/\s+/).filter(w => w.length >= 3);
            const churchWords = churchNorm.split(/\s+/).filter(w => w.length >= 3);
            const genericWords = new Set(['church', 'episcopal', 'parish', 'chapel', 'cathedral', 'mission', 'memorial']);
            const posKey = posWords.filter(w => !genericWords.has(w));
            const churchKey = churchWords.filter(w => !genericWords.has(w));
            if (posKey.length > 0 && churchKey.length > 0 && !posKey.some(w => churchKey.includes(w))) {
              nameMatch = false; // This church doesn't match this specific position row
            }
          }
        }
        if (nameMatch) {
          churchMatches++;
          pos.church_info = data.church_info;
          pos.match_confidence = data.confidence;
          if (data.parochial) {
            parochialMatches++;
            pos.parochial = data.parochial;
          }
        }
      }
    }
  }

  console.log(`Public positions: ${positions.length}`);
  console.log(`  Church matches: ${churchMatches}`);
  console.log(`  Parochial matches: ${parochialMatches}`);
  if (noVhIdCount) console.log(`  No VH ID: ${noVhIdCount}`);
  if (badUrlCleared) console.log(`  Bad profile URLs cleared: ${badUrlCleared}`);

  fs.writeFileSync(
    path.join(DATA_DIR, 'enriched-positions.json'),
    JSON.stringify(positions, null, 2)
  );

  // Build website -> church lookup for fallback matching
  function normUrl(u) {
    if (!u) return '';
    return u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').toLowerCase();
  }
  const churchByWebsite = {};
  for (const c of Object.values(churches)) {
    const w = normUrl(c.website);
    if (w) churchByWebsite[w] = c;
  }

  // Build extended positions: ALL profiles not in search results
  if (allProfiles) {
    const publicVhIds = new Set(positions.map(p => p.vh_id).filter(Boolean));
    let extChurch = 0, extParochial = 0;
    let websiteMatches = 0;

    const extended = [];
    for (const profile of allProfiles) {
      if (publicVhIds.has(profile.vh_id)) continue;

      const vhId = profile.vh_id;
      let data = getChurchData(vhId);

      // Fallback: try website-based matching if no church match exists
      if (!data && profile.website) {
        const pw = normUrl(profile.website);
        const church = pw && churchByWebsite[pw];
        if (church) {
          websiteMatches++;
          data = {
            church_info: {
              nid: church.nid,
              name: church.name,
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
            },
            parochial: church.parochial || null,
            confidence: 'high',
            match_method: 'website',
          };
        }
      }

      // Backfill diocese from church_info if profile has none
      let diocese = profile.diocese || '';
      // Guard: if diocese looks like a URL, clear it so we fall through to backfill
      if (diocese && /^https?:\/\/|\.org|\.com|\.net|\.edu/i.test(diocese)) diocese = '';
      if (!diocese && data && data.church_info) {
        // Look up diocese from registry church data
        const church = Object.values(churches).find(c => String(c.nid) === String(data.church_info.nid));
        if (church && church.diocese) diocese = church.diocese;
      }

      // Apply manual overrides for positions we've identified by phone/website/geo
      const override = dioceseOverrides[String(vhId)];
      if (override) {
        if (!diocese && override.diocese) diocese = override.diocese;
      }

      // Build display name: use congregation if available, else church name if exact match
      let displayName = profile.congregation || '';
      if (!displayName && data && (data.confidence === 'exact' || data.confidence === 'high')) {
        displayName = `${data.church_info.name}, ${data.church_info.city}, ${data.church_info.state}`;
      }

      // For positions with no name and no match, use diocese-based label
      if (!displayName) {
        displayName = diocese ? `Position in ${diocese}` : 'Unknown Position';
      }

      if (data) extChurch++;
      if (data?.parochial) extParochial++;

      // Track if original date was 01/01/1900 (means "no date ever entered")
      const hadBogusDate = /^01\/01\/1900/.test(profile.receiving_names_from || '');

      // Fix bogus 1900 year in receiving dates before status inference
      if (profile.receiving_names_from) {
        profile.receiving_names_from = fixBogusYear(profile.receiving_names_from);
      }
      if (profile.receiving_names_to) {
        profile.receiving_names_to = fixBogusYear(profile.receiving_names_to);
      }

      // Infer status - mark stale positions as closed
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

      // Override ANY status to "Search complete" if receiving date is over 1 year old.
      // Positions from 2017-2024 showing as "Receiving names", "Profile complete",
      // "Developing profile", etc. are almost certainly filled/closed.
      if (fromDate && fromDate < oneYearAgo && inferredStatus !== 'Search complete' && inferredStatus !== 'No longer receiving names') {
        inferredStatus = 'Search complete';
      }

      // 01/01/1900 = "no date was ever entered" on VH. These profiles have no salary,
      // no housing, no narrative -- they were started but never completed. Mark as closed
      // regardless of what VH says their status is.
      if (hadBogusDate && inferredStatus !== 'Search complete' && inferredStatus !== 'No longer receiving names') {
        inferredStatus = 'Search complete';
      }

      // Determine state from church_info, override, or profile
      const state = data?.church_info?.state || (override && override.state) || '';

      // Fallback position_type from order_of_ministry
      let positionType = profile.position_type || '';
      if (!positionType && profile.order_of_ministry) {
        // Map order to common position type
        const order = profile.order_of_ministry.toLowerCase();
        if (order.includes('priest')) positionType = 'Rector / Vicar / Priest-in-Charge';
        else if (order.includes('deacon')) positionType = 'Deacon';
        else if (order.includes('bishop')) positionType = 'Bishop';
        else positionType = profile.order_of_ministry;
      }
      // Multi-point calls (shared ministry) with no type - infer as part-time rector
      if (!positionType && profile.congregation && profile.congregation.includes('\n')) {
        positionType = 'Priest-in-Charge Shared Ministry';
      }

      extended.push({
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
        church_info: data ? data.church_info : undefined,
        match_confidence: data ? data.confidence : undefined,
        parochial: data?.parochial || undefined,
      });
    }

    console.log(`Extended positions: ${extended.length}`);
    console.log(`  Church matches: ${extChurch} (${websiteMatches} via website)`);
    console.log(`  Parochial matches: ${extParochial}`);

    fs.writeFileSync(
      path.join(DATA_DIR, 'enriched-extended.json'),
      JSON.stringify(extended, null, 2)
    );
  }

  console.log('\nEnriched data written to enriched-positions.json and enriched-extended.json');

  // --- Layer 1: Generate gap report ---
  // Identifies positions that need attention: missing VH ID, missing church data, etc.
  const gaps = [];

  // Public positions missing VH ID
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

  // Public positions missing church data despite having VH ID
  for (const pos of positions) {
    if (pos.vh_id && !pos.church_info) {
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

  // Extended positions missing church data (only active ones)
  {
    const extForGaps = load('enriched-extended.json') || [];
    for (const ext of extForGaps) {
      const status = ext.vh_status || '';
      if (status === 'Search complete' || status === 'No longer receiving names') continue;
      if (!ext.church_info && ext.vh_id) {
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

  // Write gap report
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

main();
