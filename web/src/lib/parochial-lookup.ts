/**
 * Look up parochial report data (ASA, membership, plate & pledge) for a congregation.
 * Cross-references Power BI parochial data with church directory entries.
 *
 * Data is loaded lazily on first lookup (fetched from /data/parochial-data.json)
 * to avoid bloating the initial page bundle (~15MB JSON).
 */

interface YearData {
  averageAttendance: number | null;
  plateAndPledge: number | null;
  membership: number | null;
}

interface ParochialCongregation {
  congregationCity: string;
  diocese: string;
  years: Record<string, YearData>;
}

interface ParochialData {
  meta: { lastUpdated: string; totalCongregations: number; yearRange: [number, number] };
  congregations: ParochialCongregation[];
}

export interface ParochialMatch {
  congregationCity: string;
  diocese: string;
  years: Record<number, YearData>;
  yearRange: [number, number];
}

// Lazy-loaded state
let dioceseIndex: Map<string, ParochialCongregation[]> | null = null;
let data: ParochialData | null = null;
let loadPromise: Promise<void> | null = null;
let loadFailed = false;

async function ensureLoaded(): Promise<boolean> {
  if (dioceseIndex) return true;
  if (loadFailed) return false;

  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const resp = await fetch('/data/parochial-data.json');
        if (!resp.ok) { loadFailed = true; return; }
        data = await resp.json() as ParochialData;

        dioceseIndex = new Map();
        for (const cong of data.congregations) {
          const key = normalizeDiocese(cong.diocese);
          const list = dioceseIndex.get(key) || [];
          list.push(cong);
          dioceseIndex.set(key, list);
        }
      } catch {
        loadFailed = true;
      }
    })();
  }

  await loadPromise;
  return !!dioceseIndex;
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

function normalizeChurchName(name: string): string {
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

function parseCongregationCity(congCity: string): { name: string; city: string } {
  const match = congCity.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (match) {
    return { name: match[1].trim(), city: match[2].trim() };
  }
  return { name: congCity, city: '' };
}

/**
 * Look up parochial report data for a position (async, lazy-loads data on first call).
 */
export async function lookupParochial(
  positionName: string,
  diocese: string,
  city?: string,
): Promise<ParochialMatch | null> {
  const loaded = await ensureLoaded();
  if (!loaded || !data || data.congregations.length === 0) return null;

  const dioceseKey = normalizeDiocese(diocese);
  const candidates = dioceseIndex!.get(dioceseKey) || [];
  if (candidates.length === 0) return null;

  const posNorm = normalizeChurchName(positionName);
  const posTokens = posNorm.split(/\s+/).filter(t => t.length > 2);
  if (posTokens.length === 0 && !city) return null;

  let bestMatch: ParochialCongregation | null = null;
  let bestScore = 0;

  for (const cong of candidates) {
    const { name: congName, city: congCity } = parseCongregationCity(cong.congregationCity);
    const congNorm = normalizeChurchName(congName);
    const congTokens = congNorm.split(/\s+/).filter(t => t.length > 2);

    let matchCount = 0;
    for (const token of posTokens) {
      if (congTokens.some(ct => ct === token || ct.startsWith(token) || token.startsWith(ct))) {
        matchCount++;
      }
    }

    let score = posTokens.length > 0 ? matchCount / posTokens.length : 0;

    if (city && congCity && city.toLowerCase() === congCity.toLowerCase()) {
      score += 0.3;
    }

    if (congNorm === posNorm) {
      score = 2;
    }

    if (score > bestScore && score >= 0.6) {
      bestScore = score;
      bestMatch = cong;
    }
  }

  if (!bestMatch) return null;

  const years: Record<number, YearData> = {};
  for (const [yearStr, yearData] of Object.entries(bestMatch.years)) {
    years[Number(yearStr)] = yearData;
  }

  return {
    congregationCity: bestMatch.congregationCity,
    diocese: bestMatch.diocese,
    years,
    yearRange: data!.meta.yearRange,
  };
}
