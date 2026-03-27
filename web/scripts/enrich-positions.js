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

const DATA_DIR = path.resolve(__dirname, '../public/data');

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

  // Enrich public positions (from search results)
  for (const pos of positions) {
    const vhId = pos.vh_id;
    if (!pos.city) pos.city = extractCity(pos.name);

    if (vhId) {
      const data = getChurchData(vhId);
      if (data) {
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

  console.log(`Public positions: ${positions.length}`);
  console.log(`  Church matches: ${churchMatches}`);
  console.log(`  Parochial matches: ${parochialMatches}`);

  fs.writeFileSync(
    path.join(DATA_DIR, 'enriched-positions.json'),
    JSON.stringify(positions, null, 2)
  );

  // Build extended positions: ALL profiles not in search results
  if (allProfiles) {
    const publicVhIds = new Set(positions.map(p => p.vh_id).filter(Boolean));
    let extChurch = 0, extParochial = 0;

    const extended = [];
    for (const profile of allProfiles) {
      if (publicVhIds.has(profile.vh_id)) continue;

      const vhId = profile.vh_id;
      const diocese = profile.diocese || '';
      const data = getChurchData(vhId);

      // Build display name: use congregation if available, else church name if exact match
      let displayName = profile.congregation || '';
      if (!displayName && data && data.confidence === 'exact') {
        displayName = `${data.church_info.name}, ${data.church_info.city}, ${data.church_info.state}`;
      }

      // For positions with no name and no match, use diocese-based label
      if (!displayName) {
        displayName = diocese ? `Position in ${diocese}` : 'Unknown Position';
      }

      if (data) extChurch++;
      if (data?.parochial) extParochial++;

      extended.push({
        vh_id: vhId,
        name: displayName,
        diocese,
        vh_status: profile.status || '',
        profile_url: profile.profile_url || '',
        position_type: profile.position_type || '',
        congregation: profile.congregation || '',
        church_info: data ? data.church_info : undefined,
        match_confidence: data ? data.confidence : undefined,
        parochial: data?.parochial || undefined,
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
