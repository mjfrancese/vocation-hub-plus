/**
 * Derive a church/organization name from profile fields when the
 * Congregation field is empty. Uses email addresses, contact info,
 * and description text to identify the church.
 */
export function deriveChurchName(
  fields: Array<{ label: string; value: string }>,
  diocese: string
): string {
  // 1. Check unlabeled fields for org names (often the first unlabeled field is the name)
  for (const f of fields) {
    if (f.label === '' && f.value.length > 3 && f.value.length < 80) {
      // Skip if it looks like a description, phone, email, or standard text
      const v = f.value;
      if (v.includes('@') || v.includes('http') || v.includes('(standard)')) continue;
      if (/^\d/.test(v) && !v.match(/^\d+\s+(st|holy|christ|trinity|grace|all|church)/i)) continue;
      if (v.startsWith('The Rev') || v.startsWith('Rev.') || v.startsWith('Canon')) continue;
      if (v.startsWith('Please') || v.startsWith('To apply') || v.startsWith('Dental')) continue;
      if (v === 'Yes' || v === 'No' || v === 'n/a' || v === 'N/A') continue;

      // Likely a church name or contact name. Check if it looks like a church.
      if (/church|parish|chapel|cathedral|st\.|saint|holy|trinity|grace|christ|epis|zion|calvary|emmanuel|redeemer|resurrection|ascension|transfiguration|advent|nativity|incarnation|spirit/i.test(v)) {
        return v;
      }
    }
  }

  // 2. Parse church name from email addresses
  for (const f of fields) {
    const emails = f.value.match(/[\w.+-]+@[\w.-]+\.\w+/g);
    if (!emails) continue;

    for (const email of emails) {
      const domain = email.split('@')[1]?.toLowerCase() || '';
      const localPart = email.split('@')[0]?.toLowerCase() || '';

      // Skip diocesan/generic emails
      if (domain.includes('diocese') || domain.includes('dioc') || domain.includes('edomi') ||
          domain.includes('episcopal') && !domain.includes('church') ||
          domain.includes('gmail') || domain.includes('yahoo') || domain.includes('outlook') ||
          domain.includes('hotmail') || domain.includes('aol') || domain.includes('att.net') ||
          domain.includes('comcast') || domain.includes('verizon') || domain.includes('icloud')) {
        // But check if the local part has a church name
        const churchFromLocal = parseChurchFromEmail(localPart);
        if (churchFromLocal) return churchFromLocal;
        continue;
      }

      // Try to extract church name from domain
      const churchFromDomain = parseChurchFromDomain(domain);
      if (churchFromDomain) return churchFromDomain;
    }
  }

  // 3. Check description fields for church name mentions
  for (const f of fields) {
    if (f.label === '' && f.value.length > 100) {
      // Look for "X Church" or "X Parish" patterns in descriptions
      const match = f.value.match(/(?:^|\s)((?:St\.?\s+\w+|Holy\s+\w+|Christ\s+\w*|Trinity|Grace|All\s+Saints?|Emmanuel|Calvary|Zion)\s*(?:Episcopal\s*)?(?:Church|Parish|Chapel|Cathedral)?)/i);
      if (match) return match[1].trim();
    }
  }

  return '';
}

function parseChurchFromDomain(domain: string): string {
  // Remove common suffixes
  const name = domain
    .replace(/\.(org|com|net|church|us)$/i, '')
    .replace(/-/g, ' ');

  // Known patterns
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [/^st(\w+)(?:episcopal)?$/i, m => `St. ${capitalize(m[1])}`],
    [/^saint(\w+)/i, m => `St. ${capitalize(m[1])}`],
    [/^(holy\w+)/i, m => capitalize(m[1].replace(/holy/i, 'Holy '))],
    [/^(trinity\w*)/i, m => capitalize(m[1])],
    [/^(grace\w*)/i, m => capitalize(m[1])],
    [/^(christ\w*)/i, m => capitalize(m[1])],
    [/^(allsaints?\w*)/i, m => 'All Saints'],
    [/^(calvary\w*)/i, m => capitalize(m[1])],
    [/^(emmanuel\w*)/i, m => capitalize(m[1])],
    [/^(epiphany\w*)/i, m => capitalize(m[1])],
    [/^(redeemer\w*)/i, m => capitalize(m[1])],
    [/^(goodshep\w*)/i, m => 'Good Shepherd'],
    [/^(advent\w*)/i, m => capitalize(m[1])],
  ];

  for (const [pattern, formatter] of patterns) {
    const match = name.match(pattern);
    if (match) return formatter(match);
  }

  // If domain looks like a church name (contains common church words)
  if (/church|parish|chapel|cathedral|episcopal/i.test(name)) {
    return name.split(' ').map(capitalize).join(' ');
  }

  return '';
}

function parseChurchFromEmail(localPart: string): string {
  const patterns: Array<[RegExp, string]> = [
    [/^(st\w+)search/i, ''],
    [/^(st\w+)rector/i, ''],
    [/^rectorsearch/i, ''],
    [/^search/i, ''],
  ];

  // Check if local part contains church identifiers
  if (/^(st\w+|holy\w+|trinity|grace|christ|calvary)/i.test(localPart)) {
    const cleaned = localPart
      .replace(/search|rector|office|admin|info|wardens?|parish|church/gi, '')
      .replace(/[^a-z]/gi, ' ')
      .trim();
    if (cleaned.length > 2) {
      return cleaned.split(' ').map(capitalize).join(' ');
    }
  }

  return '';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
