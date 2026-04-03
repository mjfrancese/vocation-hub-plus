/**
 * Shared normalization utilities for church/diocese matching.
 * CommonJS companion to web/src/lib/normalization.ts -- keep in sync.
 * Used by Node.js build scripts that cannot import TypeScript directly.
 */

'use strict';

function normalizeChurchName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\bsaints?\b/g, 'st')
    .replace(/\bsts\.?\s/g, 'st ')
    .replace(/\bst\.\s*/g, 'st ')
    .replace(/\bmount\b/g, 'mt')
    .replace(/\bmt\.\s*/g, 'mt ')
    .replace(/\s*\/.*$/, '')
    .replace(/['\u2018\u2019`]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/,.*$/, '')
    .replace(/-/g, ' ')
    .replace(/\b(the|of|and|in|at|for|a|an|be)\b/g, '')
    .replace(/\b(episcopal|church|parish|community|chapel|cathedral|mission|memorial)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDiocese(diocese) {
  if (!diocese) return '';
  return diocese
    .toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/^trustees and council of the episcopal diocese of\s*/i, '')
    .replace(/^episcopal\s+church\s+(in\s+)?/i, '')
    .replace(/^episcopal\s+diocese\s+(of\s+(the\s+)?)?/i, '')
    .replace(/^diocese\s+of\s+(the\s+)?/i, '')
    .replace(/^diocesis\s+de\s+/i, '')
    .replace(/\s+(inc|corp|llc|foundation)\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') return digits.slice(1);
  if (digits.length === 10) return digits;
  return '';
}

function normalizeDomain(url) {
  try {
    const href = url.startsWith('http') ? url : `https://${url}`;
    return new URL(href).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

module.exports = { normalizeChurchName, normalizeDiocese, normalizePhone, normalizeDomain };
