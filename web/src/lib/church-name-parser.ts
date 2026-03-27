/**
 * Derive a church/organization name from profile fields when the
 * Congregation field is empty. Uses email addresses and unlabeled fields.
 */
export function deriveChurchName(
  fields: Array<{ label: string; value: string }>,
  diocese: string
): string {
  // 1. Check unlabeled fields for church names
  for (const f of fields) {
    if (f.label === '' && f.value.length > 3 && f.value.length < 80) {
      const v = f.value;
      if (v.includes('@') || v.includes('http') || v.includes('(standard)')) continue;
      if (/^\d/.test(v)) continue;
      if (v.startsWith('The Rev') || v.startsWith('Rev.') || v.startsWith('Canon')) continue;
      if (v.startsWith('Please') || v.startsWith('To apply') || v.startsWith('Dental')) continue;
      if (v === 'Yes' || v === 'No' || v === 'n/a' || v === 'N/A') continue;

      if (/church|parish|chapel|cathedral|st\s|saint|holy|trinity|grace|christ|epis|zion|calvary|emmanuel|redeemer|resurrection|ascension|advent|nativity|incarnation|spirit/i.test(v)) {
        return v;
      }
    }
  }

  // 2. Parse church name from email addresses
  const emails: string[] = [];
  for (const f of fields) {
    const found = f.value.match(/[\w.+-]+@[\w.-]+\.\w+/g);
    if (found) emails.push(...found);
  }

  // Filter to church-related emails (skip diocesan/generic)
  for (const email of emails) {
    const domain = email.split('@')[1]?.toLowerCase() || '';

    // Skip generic and diocesan emails
    if (/diocese|dioc|edomi|ednin|episcopal(?!church)|gmail|yahoo|outlook|hotmail|aol|comcast|verizon|att\.net|icloud|cablelynx|ptd\.net|frontier|embarq/i.test(domain)) {
      continue;
    }

    const name = parseChurchFromDomain(domain);
    if (name) return name;
  }

  return '';
}

/**
 * Parse a church name from an email domain.
 * Handles patterns like: stpetersripon.com -> St. Peter's, Ripon
 */
function parseChurchFromDomain(domain: string): string {
  // Remove TLD
  const base = domain.replace(/\.(org|com|net|church|us|edu)$/i, '').toLowerCase();

  // Known church name prefixes and how to split them
  const patterns: Array<{ regex: RegExp; format: (parts: RegExpMatchArray) => string }> = [
    // st[name][city] patterns (most common)
    { regex: /^st\.?(\w+?)s?(ripon|croom|dexter|oxford|plymouth|spokane|warsaw|katonah|peekskill|greenville|fishkill|sandwich|hanover|chatham|missoula|cleveland\w*|waterford|annarbor|detroit|romeo|lincoln|temecula|hazelton|somerset|denton|hamilton|cordele|eugene|sturart|rockford|dekalb|kankakee|morris|ithaca|oneonta)$/i,
      format: m => `St. ${capitalize(m[1])}'s, ${capitalize(m[2])}` },
    // st[name] without city
    { regex: /^st\.?(\w+?)s?(?:episcopal|church)?$/i,
      format: m => `St. ${capitalize(m[1])}'s` },
    // holy[name][city]
    { regex: /^holy(\w+?)(missoula|clemson|sutherlin)$/i,
      format: m => `Holy ${capitalize(m[1])}, ${capitalize(m[2])}` },
    // holy[name]
    { regex: /^holy(\w+?)(?:episcopal|church)?$/i,
      format: m => `Holy ${capitalize(m[1])}` },
    // christ[church][city]
    { regex: /^christchurch(lincoln|cody|warren|\w+)$/i,
      format: m => `Christ Church, ${capitalize(m[1])}` },
    // cometochristchurch -> Christ Church
    { regex: /^cometo(\w+)$/i,
      format: m => capitalize(m[1]).replace(/church/i, ' Church') },
    // trinity[city]
    { regex: /^trinity(fishkill|hamilton|anderson|toldo|wrentham|\w+)$/i,
      format: m => `Trinity, ${capitalize(m[1])}` },
    // trinity alone
    { regex: /^trinity(?:episcopal)?$/i,
      format: () => 'Trinity' },
    // calvary[city]
    { regex: /^calvary(cleveland\w*|tarboro|\w+)$/i,
      format: m => `Calvary, ${capitalize(m[1]).replace(/ms$/i, '')}` },
    // goodshep[city]
    { regex: /^goodshep(\w+?)(?:online|herd)?$/i,
      format: m => `Good Shepherd${m[1] && m[1] !== 'herd' ? ', ' + capitalize(m[1]) : ''}` },
    // incarnation[city]
    { regex: /^incarnation(\w+)$/i,
      format: m => `Incarnation, ${capitalize(m[1])}` },
    // spiritofgrace
    { regex: /^spiritofgrace$/i, format: () => 'Spirit of Grace' },
    // emmanuel/epiphany/advent/grace + city
    { regex: /^(emmanuel|epiphany|advent|grace|redeemer|resurrection|ascension|nativity|zion)(\w+)?$/i,
      format: m => m[2] ? `${capitalize(m[1])}, ${capitalize(m[2])}` : capitalize(m[1]) },
    // allsaints[city]
    { regex: /^allsaints?(\w*)$/i,
      format: m => m[1] ? `All Saints, ${capitalize(m[1])}` : 'All Saints' },
    // Generic [name]episcopal[church]
    { regex: /^(\w+?)episcopal(?:church)?(\w*)$/i,
      format: m => m[2] ? `${capitalize(m[1])} Episcopal, ${capitalize(m[2])}` : `${capitalize(m[1])} Episcopal` },
  ];

  for (const { regex, format } of patterns) {
    const match = base.match(regex);
    if (match) {
      const result = format(match);
      // Clean up: remove trailing commas, double spaces
      return result.replace(/,\s*$/, '').replace(/\s+/g, ' ').trim();
    }
  }

  // Fallback: try to split by known church words
  const churchWords = /^(st\w*|holy\w*|christ\w*|trinity|grace|calvary|good\w*|all\w*|incarnation|spirit\w*|epiphany|advent|redeemer|resurrection|zion|emmanuel)/i;
  const match = base.match(churchWords);
  if (match) {
    const rest = base.slice(match[0].length);
    const churchPart = match[0]
      .replace(/^st(\w)/i, 'St. $1')
      .replace(/^holy(\w)/i, 'Holy $1')
      .replace(/^christ(\w)/i, 'Christ $1')
      .replace(/^good(\w)/i, 'Good $1');
    if (rest && rest.length > 2) {
      return `${capitalize(churchPart)}, ${capitalize(rest)}`;
    }
    return capitalize(churchPart);
  }

  return '';
}

function capitalize(s: string): string {
  if (!s) return '';
  // Handle known abbreviations
  const lower = s.toLowerCase();
  if (lower === 'annarbor') return 'Ann Arbor';
  if (lower === 'clevelandms') return 'Cleveland';
  if (lower === 'wakeforest') return 'Wake Forest';
  if (lower === 'newlondon') return 'New London';

  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
