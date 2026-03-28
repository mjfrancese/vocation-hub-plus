/**
 * Look up church information from the Episcopal Asset Map directory.
 * Replaces the fragile email-domain-to-church-name parser with authoritative data.
 */

import churchesData from '../../public/data/churches.json';

interface Church {
  nid: number;
  name: string;
  diocese: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  website: string;
  type: string;
  lat: number | null;
  lng: number | null;
}

interface ChurchDirectory {
  meta: { lastUpdated: string; totalChurches: number };
  churches: Church[];
}

interface ProfileField {
  label: string;
  value: string;
}

// Indexes built once on first lookup
let emailDomainIndex: Map<string, Church[]> | null = null;
let dioceseIndex: Map<string, Church[]> | null = null;
let directory: Church[] = [];

function ensureIndexes(): void {
  if (emailDomainIndex) return;

  emailDomainIndex = new Map();
  dioceseIndex = new Map();

  const data = churchesData as unknown as ChurchDirectory;
  directory = data.churches || [];

  for (const church of directory) {
    // Email domain index
    if (church.email) {
      const domain = church.email.split('@')[1]?.toLowerCase();
      if (domain) {
        const list = emailDomainIndex.get(domain) || [];
        list.push(church);
        emailDomainIndex.set(domain, list);
      }
    }

    // Diocese index (normalized)
    if (church.diocese) {
      const key = normalizeDiocese(church.diocese);
      const list = dioceseIndex.get(key) || [];
      list.push(church);
      dioceseIndex.set(key, list);
    }
  }
}

/**
 * Look up a church from the directory using profile fields and diocese.
 * Returns the matched church or null.
 */
export function lookupChurch(
  fields: ProfileField[],
  diocese: string,
  positionName?: string,
): Church | null {
  ensureIndexes();
  if (directory.length === 0) return null;

  // Strategy 1: Email domain match
  const emails = extractEmails(fields);
  for (const email of emails) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) continue;

    // Skip generic/diocesan email providers
    if (isGenericDomain(domain)) continue;

    const matches = emailDomainIndex!.get(domain);
    if (matches && matches.length === 1) {
      return matches[0];
    }
    // If multiple matches on same domain, try to narrow by diocese
    if (matches && matches.length > 1 && diocese) {
      const dioceseMatch = matches.find(
        c => normalizeDiocese(c.diocese) === normalizeDiocese(diocese)
      );
      if (dioceseMatch) return dioceseMatch;
    }
  }

  // Strategy 2: Diocese + name match (fuzzy)
  if (diocese) {
    const candidates = dioceseIndex!.get(normalizeDiocese(diocese)) || [];

    // Try congregation name from fields
    const congregation = getFieldValue(fields, 'Congregation', 'Community Name', 'Name');
    if (congregation) {
      const match = fuzzyMatchName(congregation, candidates);
      if (match) return match;
    }

    // Try position name (from search table)
    if (positionName) {
      const match = fuzzyMatchName(positionName, candidates);
      if (match) return match;
    }

    // Strategy 3: Diocese + city match
    const city = extractCityFromFields(fields, positionName);
    if (city) {
      const cityLower = city.toLowerCase();
      const cityMatches = candidates.filter(
        c => c.city.toLowerCase() === cityLower
      );
      if (cityMatches.length === 1) return cityMatches[0];
    }
  }

  return null;
}

/**
 * Get the display name for a church match (formatted nicely).
 */
export function getChurchDisplayName(church: Church): string {
  if (church.city && church.state) {
    return `${church.name}, ${church.city}, ${church.state}`;
  }
  if (church.city) {
    return `${church.name}, ${church.city}`;
  }
  return church.name;
}

// --- Helpers ---

function extractEmails(fields: ProfileField[]): string[] {
  const emails: string[] = [];
  for (const f of fields) {
    const found = f.value.match(/[\w.+-]+@[\w.-]+\.\w+/g);
    if (found) emails.push(...found);
  }
  return emails;
}

function isGenericDomain(domain: string): boolean {
  return /diocese|dioc|edomi|ednin|gmail|yahoo|outlook|hotmail|aol|comcast|verizon|att\.net|icloud|cablelynx|ptd\.net|frontier|embarq/i.test(domain);
}

function getFieldValue(fields: ProfileField[], ...labels: string[]): string {
  for (const label of labels) {
    const match = fields.find(f => f.label.toLowerCase() === label.toLowerCase());
    if (match?.value) return match.value;
  }
  return '';
}

function normalizeDiocese(diocese: string): string {
  return diocese
    .toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/^episcopal\s+church\s+/i, '')
    .replace(/^episcopal\s+diocese\s+(of\s+)?/i, '')
    .replace(/^diocese\s+of\s+/i, '')
    .replace(/^diocesis\s+de\s+/i, '')
    .trim();
}

function normalizeName(name: string): string {
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

function fuzzyMatchName(positionName: string, candidates: Church[]): Church | null {
  const normalized = normalizeName(positionName);
  if (!normalized || normalized.length < 3) return null;

  // Exact normalized match
  for (const c of candidates) {
    if (normalizeName(c.name) === normalized) return c;
  }

  // Token containment: all significant tokens in the position name appear in the church name
  const posTokens = normalized.split(/\s+/).filter(t => t.length > 2);
  if (posTokens.length === 0) return null;

  let bestMatch: Church | null = null;
  let bestScore = 0;

  for (const c of candidates) {
    const churchNorm = normalizeName(c.name);
    const churchTokens = churchNorm.split(/\s+/).filter(t => t.length > 2);

    // Count how many position tokens appear in the church name
    let matchCount = 0;
    for (const token of posTokens) {
      if (churchTokens.some(ct => ct === token || ct.startsWith(token) || token.startsWith(ct))) {
        matchCount++;
      }
    }

    const score = matchCount / posTokens.length;
    if (score > bestScore && score >= 0.6) {
      bestScore = score;
      bestMatch = c;
    }
  }

  return bestMatch;
}

function extractCityFromFields(fields: ProfileField[], positionName?: string): string {
  // Try Geographic Location field
  const geo = getFieldValue(fields, 'Geographic Location');
  if (geo) {
    // Often formatted as "City, ST" or just "City"
    const parts = geo.split(',');
    if (parts[0]) return parts[0].trim();
  }

  // Try extracting city from position name parenthetical: "St. Mark's (Houma)"
  if (positionName) {
    const match = positionName.match(/\(([^)]+)\)$/);
    if (match) return match[1].trim();
  }

  return '';
}
