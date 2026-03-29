/**
 * Shared normalization utilities for church/diocese matching.
 * Used by build scripts (via web/scripts/lib/normalization.js) and frontend TypeScript code.
 */

export function normalizeChurchName(name: string): string {
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
    .replace(/([a-z]{4,})s\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDiocese(diocese: string): string {
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

export function normalizePhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') return digits.slice(1);
  if (digits.length === 10) return digits;
  return '';
}

export function normalizeDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`)
      .hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}
