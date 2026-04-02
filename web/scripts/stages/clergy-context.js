/**
 * Enrichment Stage: Clergy Context
 *
 * For each position with matched parishes (church_infos), looks up current
 * clergy, computes tenure info, and derives neutral parish context stats
 * (clergy turnover, attendance/giving/membership trends).
 *
 * Extracted from enrich-positions-v2.js.
 */

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the year out of a date string. Supports two formats:
 *   - "MM/DD/YYYY" -> parseInt on parts[2]
 *   - "YYYY"       -> parseInt on parts[0]
 * Returns null if the string is falsy or unparseable.
 *
 * @param {string|null|undefined} dateStr
 * @returns {number|null}
 */
function parseYear(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  const raw = parts.length >= 3 ? parts[2] : parts[0];
  const year = parseInt(raw, 10);
  return isNaN(year) ? null : year;
}

/**
 * Find the current clergy assignment for a parish, build tenure info,
 * and compute clergy history stats.
 *
 * @param {number} parishId
 * @param {object} db - better-sqlite3 database instance
 * @returns {{ current_clergy: object|null, parish_clergy_history: object }}
 */
function attachClergyInfo(parishId, db) {
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
    const startYear = parseYear(pos.start_date);
    let endYear = new Date().getFullYear();
    if (pos.end_date) {
      endYear = parseYear(pos.end_date) ?? new Date().getFullYear();
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

/**
 * Compute neutral parish context stats for public display.
 *
 * @param {number} parishId
 * @param {object} db - better-sqlite3 database instance
 * @returns {object} parish context object
 */
function computeParishContext(parishId, db) {
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
// Stage entry point
// ---------------------------------------------------------------------------

/**
 * Clergy context enrichment stage.
 *
 * For each position with matched parishes (church_infos), uses the first
 * matched parish's DB id to look up clergy info and parish context stats.
 *
 * Attaches:
 *   - position.clergy: { current_clergy: {...}|null, parish_clergy_history: {...} }
 *     or null when there are no matched parishes.
 *   - position.parish_contexts: array of parish context objects (one per
 *     church_info that has a DB id), each containing:
 *       clergy_count_10yr, avg_tenure_years, current_clergy_count,
 *       attendance_trend, attendance_change_pct, giving_trend,
 *       giving_change_pct, membership_trend, membership_change_pct,
 *       latest_operating_revenue, years_of_data
 *
 * @param {Array} positions - positions already processed by match-parishes stage
 * @param {object} db - better-sqlite3 database instance
 * @returns {Array} positions with clergy and parish_contexts fields attached
 */
function attachClergyContext(positions, db) {
  for (const pos of positions) {
    const churchInfos = pos.church_infos || [];

    if (churchInfos.length === 0) {
      pos.clergy = null;
      pos.parish_contexts = [];
      continue;
    }

    // clergy field: use the first matched parish that has a DB id
    const firstWithId = churchInfos.find(info => info.id != null);
    if (firstWithId) {
      pos.clergy = attachClergyInfo(firstWithId.id, db);
    } else {
      pos.clergy = null;
    }

    // parish_contexts: one entry per church_info that has a DB id
    const contexts = [];
    for (const info of churchInfos) {
      if (info.id != null) {
        contexts.push(computeParishContext(info.id, db));
      }
    }
    pos.parish_contexts = contexts;
  }

  return positions;
}

module.exports = attachClergyContext;

// Also export internals for testing
module.exports.attachClergyInfo = attachClergyInfo;
module.exports.computeParishContext = computeParishContext;
