/**
 * Shared date-parsing utilities for the enrichment pipeline.
 */

'use strict';

/**
 * Parse a date string in MM/DD/YYYY format.
 *
 * @param {string|*} str
 * @returns {Date|null}
 */
function parseMMDDYYYY(str) {
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
}

module.exports = { parseMMDDYYYY };
