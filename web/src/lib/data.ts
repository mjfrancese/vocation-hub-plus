import { Position, PositionChange, Meta } from './types';
import positionsData from '../../public/data/positions.json';
import changesData from '../../public/data/changes.json';
import metaData from '../../public/data/meta.json';
import allProfilesData from '../../public/data/all-profiles.json';

interface ProfileField {
  label: string;
  value: string;
}

interface Profile {
  vh_id: number;
  profile_url: string;
  diocese: string;
  congregation: string;
  all_fields: ProfileField[];
}

// Build a lookup of profiles by diocese for fast matching
const profilesByDiocese = new Map<string, Profile[]>();
for (const p of allProfilesData as unknown as Profile[]) {
  const diocese = (p.diocese || '').toLowerCase();
  if (!profilesByDiocese.has(diocese)) {
    profilesByDiocese.set(diocese, []);
  }
  profilesByDiocese.get(diocese)!.push(p);
}

/**
 * Find the best matching profile for a position using fuzzy name matching.
 */
function findProfileForPosition(name: string, diocese: string): Profile | null {
  const candidates = profilesByDiocese.get(diocese.toLowerCase()) || [];
  if (candidates.length === 0) return null;

  const posName = name.toLowerCase();
  // Extract the core name (before parenthetical)
  const posCore = posName.split('(')[0].trim();

  let bestMatch: Profile | null = null;
  let bestScore = 0;

  for (const profile of candidates) {
    const profName = (profile.congregation || '').toLowerCase();
    if (!profName) continue;
    const profCore = profName.split('(')[0].trim();

    // Exact match
    if (profName === posName) return profile;

    // Core name exact match (e.g. "cople" matches "cople parish")
    if (posCore === profCore) {
      if (90 > bestScore) { bestScore = 90; bestMatch = profile; }
      continue;
    }

    // One contains the other
    if (posCore.includes(profCore) || profCore.includes(posCore)) {
      const score = Math.min(posCore.length, profCore.length) / Math.max(posCore.length, profCore.length) * 80;
      if (score > bestScore) { bestScore = score; bestMatch = profile; }
      continue;
    }

    // First significant word match (skip "st", "the", "church", "parish")
    const skipWords = new Set(['st', 'st.', 'the', 'church', 'parish', 'of', 'and']);
    const posWords = posCore.split(/\s+/).filter(w => !skipWords.has(w));
    const profWords = profCore.split(/\s+/).filter(w => !skipWords.has(w));

    if (posWords.length > 0 && profWords.length > 0 && posWords[0] === profWords[0] && posWords[0].length > 2) {
      const score = 60;
      if (score > bestScore) { bestScore = score; bestMatch = profile; }
    }
  }

  return bestScore >= 40 ? bestMatch : null;
}

export function getPositions(): Position[] {
  const positions = positionsData as unknown as Position[];

  // Enrich positions with profile data
  return positions.map(pos => {
    const profile = findProfileForPosition(pos.name, pos.diocese);
    if (profile) {
      return {
        ...pos,
        vh_id: profile.vh_id,
        profile_url: profile.profile_url,
        deep_scrape_fields: profile.all_fields,
      };
    }
    return pos;
  });
}

export function getChanges(): PositionChange[] {
  return changesData as PositionChange[];
}

export function getMeta(): Meta {
  return metaData as Meta;
}

export function getUniqueValues(positions: Position[], field: keyof Position): string[] {
  const values = new Set<string>();
  for (const p of positions) {
    const val = p[field];
    if (typeof val === 'string' && val.trim()) {
      values.add(val.trim());
    }
  }
  return Array.from(values).sort();
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  }
  const months = Math.floor(diffDays / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}
