/**
 * Generate per-token clergy data files and a lightweight search index.
 *
 * Usage:
 *   CLERGY_TOKEN_SECRET=<secret> node scripts/generate-clergy-data.js
 *
 * Outputs:
 *   public/data/clergy/{token}.json          (one file per clergy member, ~2KB)
 *   public/data/clergy-search-index.json     (lightweight array for claim search)
 *   clergy_tokens table                      (audit trail in DB)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Generate a deterministic 12-char URL-safe token from a clergy GUID.
 * Uses HMAC-SHA256 with the provided secret, then base64url-encodes
 * and truncates to 12 characters.
 * @param {string} guid
 * @param {string} secret
 * @returns {string}
 */
function generateToken(guid, secret) {
  if (!secret) throw new Error('CLERGY_TOKEN_SECRET is required');
  const hmac = crypto.createHmac('sha256', secret).update(guid).digest('base64url');
  return hmac.slice(0, 12);
}

/**
 * Build the full PersonalData object for a single clergy member.
 * @param {string} guid
 * @param {import('better-sqlite3').Database} db
 * @returns {object|null} PersonalData-shaped object
 */
function buildPersonalData(guid, db) {
  const clergy = db.prepare(`SELECT * FROM clergy WHERE guid = ?`).get(guid);
  if (!clergy) return null;

  const name = [clergy.first_name, clergy.middle_name, clergy.last_name, clergy.suffix]
    .filter(Boolean).join(' ');

  // Ordination year from diaconate_date (MM/DD/YYYY or just a year)
  let ordinationYear = null;
  if (clergy.diaconate_date) {
    const parts = clergy.diaconate_date.split('/');
    const yearStr = parts.length >= 3 ? parts[2] : parts[0];
    const yr = parseInt(yearStr, 10);
    if (yr > 1900 && yr < 2100) ordinationYear = yr;
  }
  const currentYear = new Date().getFullYear();
  const experienceYears = ordinationYear ? currentYear - ordinationYear : null;

  // Position history
  const posRows = db.prepare(`
    SELECT cp.*, p.name AS parish_name, p.id AS p_id, p.diocese, p.city, p.state
    FROM clergy_positions cp
    LEFT JOIN parishes p ON cp.parish_id = p.id
    WHERE cp.clergy_guid = ?
    ORDER BY cp.is_current DESC, cp.start_date DESC
  `).all(guid);

  const positions = posRows.map(r => {
    const startYear = r.start_date ? parseInt(r.start_date.split('/').pop(), 10) || null : null;
    const endYear = r.end_date ? parseInt(r.end_date.split('/').pop(), 10) || null : null;
    return {
      title: r.position_title || 'Unknown',
      parish: r.parish_name || r.employer_name || 'Unknown',
      parish_id: r.p_id || null,
      diocese: r.diocese || '',
      city: r.city || null,
      state: r.state || null,
      start_year: startYear,
      end_year: r.is_current ? null : endYear,
      is_current: !!r.is_current,
    };
  });

  const currentPos = positions.find(p => p.is_current) || null;

  // Compensation benchmarks for current diocese
  const diocese = currentPos?.diocese ||
    (clergy.canonical_residence ? clergy.canonical_residence.replace(/^Diocese of /i, '') : null);
  const comp = diocese ? db.prepare(`
    SELECT * FROM compensation_diocesan WHERE LOWER(diocese) = LOWER(?) ORDER BY year DESC LIMIT 1
  `).get(diocese) : null;

  // ASA bucket median
  let asaBucketMedian = null;
  const currentParishId = currentPos?.parish_id;
  if (currentParishId) {
    const parish = db.prepare(`SELECT nid FROM parishes WHERE id = ?`).get(currentParishId);
    if (parish?.nid) {
      const latestParochial = db.prepare(`
        SELECT average_attendance FROM parochial_data WHERE parish_nid = ? ORDER BY year DESC LIMIT 1
      `).get(parish.nid);
      if (latestParochial?.average_attendance) {
        const asa = latestParochial.average_attendance;
        try {
          const asaRows = db.prepare(`
            SELECT asa_category, median FROM compensation_by_asa
            WHERE gender = 'all' ORDER BY year DESC
          `).all();
          for (const row of asaRows) {
            if (row.asa_category) {
              const parts = row.asa_category.split('-').map(Number);
              if (parts.length === 2 && asa >= parts[0] && asa <= parts[1]) {
                asaBucketMedian = row.median;
                break;
              }
            }
          }
        } catch { /* ignore if table structure differs */ }
      }
    }
  }

  // Position type median
  let positionTypeMedian = null;
  if (currentPos?.title) {
    try {
      const ptRow = db.prepare(`
        SELECT median FROM compensation_by_position
        WHERE LOWER(position_type) = LOWER(?) AND gender = 'all'
        ORDER BY year DESC LIMIT 1
      `).get(currentPos.title);
      positionTypeMedian = ptRow?.median || null;
    } catch { /* ignore */ }
  }

  // Experience bracket median
  let experienceBracketMedian = null;
  if (experienceYears != null) {
    try {
      const expRows = db.prepare(`
        SELECT service_bracket, median FROM compensation_by_experience
        WHERE gender = 'all' ORDER BY year DESC
      `).all();
      for (const row of expRows) {
        if (row.service_bracket) {
          const parts = row.service_bracket.split('-').map(Number);
          if (parts.length === 2 && experienceYears >= parts[0] && experienceYears <= parts[1]) {
            experienceBracketMedian = row.median;
            break;
          }
        }
      }
    } catch { /* ignore */ }
  }

  const compensationBenchmarks = {
    diocese_median: comp?.all_median || null,
    diocese_female_median: comp?.female_median || null,
    diocese_male_median: comp?.male_median || null,
    asa_bucket_median: asaBucketMedian,
    position_type_median: positionTypeMedian,
    experience_bracket_median: experienceBracketMedian,
    year: comp?.year || null,
  };

  // Current parish context
  let currentParish = null;
  if (currentParishId) {
    const p = db.prepare(`SELECT * FROM parishes WHERE id = ?`).get(currentParishId);
    if (p) {
      let asa = null, platePledge = null, membership = null, opRev = null;
      if (p.nid) {
        const latest = db.prepare(`
          SELECT average_attendance, plate_and_pledge, membership, operating_revenue
          FROM parochial_data WHERE parish_nid = ? ORDER BY year DESC LIMIT 1
        `).get(p.nid);
        if (latest) {
          asa = latest.average_attendance;
          platePledge = latest.plate_and_pledge;
          membership = latest.membership;
          opRev = latest.operating_revenue;
        }
      }

      // Census data
      let censusIncome = null, censusPop = null;
      try {
        const zip5 = p.zip ? p.zip.substring(0, 5) : null;
        if (zip5) {
          const census = db.prepare('SELECT median_income, population FROM census_data WHERE zip = ?').get(zip5);
          if (census) {
            censusIncome = census.median_income || null;
            censusPop = census.population || null;
          }
        }
      } catch { /* ignore */ }

      // Clergy tenure at this parish
      const tenYearsAgo = currentYear - 10;
      const clergyAtParish = db.prepare(
        `SELECT start_date, end_date, is_current FROM clergy_positions WHERE parish_id = ?`
      ).all(currentParishId);
      const recentClergy = clergyAtParish.filter(c => {
        if (c.is_current) return true;
        const endYear = c.end_date ? parseInt(c.end_date.split('/').pop(), 10) : null;
        const startYear = c.start_date ? parseInt(c.start_date.split('/').pop(), 10) : null;
        return (endYear && endYear >= tenYearsAgo) || (startYear && startYear >= tenYearsAgo);
      });

      let totalTenure = 0, tenureCount = 0;
      for (const c of recentClergy) {
        const sy = c.start_date ? parseInt(c.start_date.split('/').pop(), 10) : null;
        const ey = c.is_current ? currentYear : (c.end_date ? parseInt(c.end_date.split('/').pop(), 10) : null);
        if (sy && ey && ey >= sy) { totalTenure += ey - sy; tenureCount++; }
      }

      currentParish = {
        asa,
        plate_pledge: platePledge,
        membership,
        operating_revenue: opRev,
        lat: p.lat,
        lng: p.lng,
        census_median_income: censusIncome,
        census_population: censusPop,
        clergy_count_10yr: recentClergy.length,
        avg_tenure_years: tenureCount > 0 ? Math.round((totalTenure / tenureCount) * 10) / 10 : null,
      };
    }
  }

  return {
    name,
    clergy_guid: guid,
    current_position: currentPos ? {
      title: currentPos.title,
      parish: currentPos.parish,
      parish_id: currentPos.parish_id,
      start_date: posRows.find(r => r.is_current)?.start_date || null,
      diocese: currentPos.diocese,
      city: currentPos.city,
      state: currentPos.state,
    } : null,
    ordination_year: ordinationYear,
    experience_years: experienceYears,
    positions,
    compensation_benchmarks: compensationBenchmarks,
    current_parish: currentParish,
  };
}

/**
 * Generate per-token clergy files and a lightweight search index.
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {string} opts.outputDir - base directory for output (e.g. public/data)
 * @returns {{ clergyCount: number, searchIndexCount: number, collisions: string[] }}
 */
function generateClergyData({ db, outputDir }) {
  const secret = process.env.CLERGY_TOKEN_SECRET;
  if (!secret) throw new Error('CLERGY_TOKEN_SECRET environment variable is required');

  const allClergy = db.prepare(`SELECT guid FROM clergy`).all();
  console.log(`Generating clergy data for ${allClergy.length} clergy...`);

  // Ensure clergy subdirectory exists
  const clergyDir = path.join(outputDir, 'clergy');
  if (!fs.existsSync(clergyDir)) fs.mkdirSync(clergyDir, { recursive: true });

  const tokenToGuid = {};
  const collisions = [];
  let clergyCount = 0;

  for (const { guid } of allClergy) {
    const token = generateToken(guid, secret);
    const data = buildPersonalData(guid, db);
    if (!data) continue;

    // Collision detection
    if (tokenToGuid[token]) {
      collisions.push(`Token collision: ${token} for ${guid} and ${tokenToGuid[token]}`);
      console.error(`Token collision: ${token} for ${guid} and ${tokenToGuid[token]}`);
      continue;
    }
    tokenToGuid[token] = guid;

    // Write individual file
    fs.writeFileSync(path.join(clergyDir, `${token}.json`), JSON.stringify(data));
    clergyCount++;
  }

  console.log(`Wrote ${clergyCount} individual clergy files to clergy/`);

  if (collisions.length > 0) {
    console.error(`WARNING: ${collisions.length} token collision(s) detected`);
  }

  // Build and write search index
  const searchIndex = buildSearchIndex(db, secret);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'clergy-search-index.json'), JSON.stringify(searchIndex));
  console.log(`Wrote clergy-search-index.json (${searchIndex.length} entries)`);

  // Insert tokens into DB for audit
  const upsert = db.prepare(`INSERT OR REPLACE INTO clergy_tokens (token, clergy_guid) VALUES (?, ?)`);
  const insertMany = db.transaction((entries) => {
    for (const [token, guid] of entries) {
      upsert.run(token, guid);
    }
  });
  insertMany(Object.entries(tokenToGuid));
  console.log(`Inserted ${clergyCount} tokens into clergy_tokens table`);

  return { clergyCount, searchIndexCount: searchIndex.length, collisions };
}

/**
 * Build the lightweight search index for the claim page.
 * @param {import('better-sqlite3').Database} db
 * @param {string} secret
 * @returns {Array<object>}
 */
function buildSearchIndex(db, secret) {
  const allClergy = db.prepare(
    `SELECT guid, first_name, middle_name, last_name, suffix, canonical_residence, diaconate_date FROM clergy`
  ).all();

  return allClergy.map(c => {
    const name = [c.first_name, c.middle_name, c.last_name, c.suffix].filter(Boolean).join(' ');
    const token = generateToken(c.guid, secret);

    const pos = db.prepare(`
      SELECT cp.position_title, p.name AS parish_name, p.city, p.state
      FROM clergy_positions cp
      LEFT JOIN parishes p ON cp.parish_id = p.id
      WHERE cp.clergy_guid = ? AND cp.is_current = 1
      LIMIT 1
    `).get(c.guid);

    let ordinationYear = null;
    if (c.diaconate_date) {
      const parts = c.diaconate_date.split('/');
      const yr = parseInt(parts.length >= 3 ? parts[2] : parts[0], 10);
      if (yr > 1900 && yr < 2100) ordinationYear = yr;
    }

    return {
      token,
      name,
      diocese: c.canonical_residence || null,
      current_position: pos?.position_title || null,
      current_parish: pos?.parish_name || null,
      city: pos?.city || null,
      state: pos?.state || null,
      ordination_year: ordinationYear,
    };
  });
}

// CLI entry point
if (require.main === module) {
  if (!process.env.CLERGY_TOKEN_SECRET) {
    console.error('Error: CLERGY_TOKEN_SECRET environment variable is required');
    process.exit(1);
  }
  const { getDb, closeDb } = require('./db');
  const db = getDb();
  const outputDir = process.argv[2] || path.resolve(__dirname, '../public/data');
  const result = generateClergyData({ db, outputDir });
  if (result.collisions.length > 0) {
    process.exit(1);
  }
  closeDb();
}

module.exports = { generateToken, buildPersonalData, buildSearchIndex, generateClergyData };
