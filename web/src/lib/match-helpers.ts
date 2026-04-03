import type { Position, SearchPreferences } from './types';
import { getRegion } from './analytics-helpers';
import { MATCH_TIER_STRONG, MATCH_TIER_GOOD, MATCH_TIER_PARTIAL } from './constants';

interface MatchResult {
  score: number;
  tier: 'strong' | 'good' | 'partial' | 'none';
  reasons: string[];
}

const WEIGHTS = {
  positionType: 25,
  region: 15,
  state: 15,
  asa: 15,
  comp: 15,
  housing: 5,
  ministrySetting: 10,
};

export function scorePosition(pos: Position, prefs: SearchPreferences): MatchResult {
  let earned = 0;
  let possible = 0;
  const reasons: string[] = [];

  // Position type
  if (prefs.positionTypes.length > 0) {
    possible += WEIGHTS.positionType;
    const posTypes = pos.position_types || [];
    if (posTypes.some(t => prefs.positionTypes.includes(t))) {
      earned += WEIGHTS.positionType;
      reasons.push(posTypes.find(t => prefs.positionTypes.includes(t)) || 'Type');
    }
  }

  // Region
  if (prefs.regions.length > 0) {
    possible += WEIGHTS.region;
    if (pos.state) {
      const region = getRegion(pos.state);
      if (prefs.regions.includes(region)) {
        earned += WEIGHTS.region;
        reasons.push(region);
      }
    }
  }

  // State
  if (prefs.states.length > 0) {
    possible += WEIGHTS.state;
    if (pos.state && prefs.states.includes(pos.state)) {
      earned += WEIGHTS.state;
      reasons.push(pos.state);
    }
  }

  // ASA range
  if (prefs.asaMin != null || prefs.asaMax != null) {
    possible += WEIGHTS.asa;
    const asa = getPositionASA(pos);
    if (asa != null) {
      const min = prefs.asaMin ?? 0;
      const max = prefs.asaMax ?? Infinity;
      if (asa >= min && asa <= max) {
        earned += WEIGHTS.asa;
        reasons.push('ASA range');
      } else {
        const tolerance = Math.max((max === Infinity ? min : max - min) * 0.25, 25);
        if (asa >= min - tolerance && asa <= (max === Infinity ? Infinity : max + tolerance)) {
          earned += WEIGHTS.asa / 2;
          reasons.push('ASA (near)');
        }
      }
    }
  }

  // Compensation range
  if (prefs.compMin != null || prefs.compMax != null) {
    possible += WEIGHTS.comp;
    const comp = pos.estimated_total_comp;
    if (comp != null && comp > 0) {
      const min = prefs.compMin ?? 0;
      const max = prefs.compMax ?? Infinity;
      if (comp >= min && comp <= max) {
        earned += WEIGHTS.comp;
        reasons.push('Comp range');
      } else {
        const tolerance = Math.max((max === Infinity ? min : max - min) * 0.15, 10000);
        if (comp >= min - tolerance && comp <= (max === Infinity ? Infinity : max + tolerance)) {
          earned += WEIGHTS.comp / 2;
          reasons.push('Comp (near)');
        }
      }
    }
  }

  // Housing
  if (prefs.housing != null && prefs.housing !== 'either') {
    possible += WEIGHTS.housing;
    const posHousing = getPositionHousing(pos);
    if (posHousing) {
      const match = (prefs.housing === 'rectory' && posHousing.includes('Rectory')) ||
                    (prefs.housing === 'allowance' && posHousing.includes('Allowance'));
      if (match) {
        earned += WEIGHTS.housing;
        reasons.push('Housing');
      }
    }
  } else if (prefs.housing === 'either') {
    possible += WEIGHTS.housing;
    earned += WEIGHTS.housing;
  }

  // Ministry setting
  if (prefs.ministrySettings.length > 0) {
    possible += WEIGHTS.ministrySetting;
    const setting = getPositionSetting(pos);
    if (setting && prefs.ministrySettings.includes(setting)) {
      earned += WEIGHTS.ministrySetting;
      reasons.push(setting);
    }
  }

  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;

  let tier: MatchResult['tier'] = 'none';
  if (score >= MATCH_TIER_STRONG) tier = 'strong';
  else if (score >= MATCH_TIER_GOOD) tier = 'good';
  else if (score >= MATCH_TIER_PARTIAL) tier = 'partial';

  return { score, tier, reasons };
}

function getPositionASA(pos: Position): number | null {
  const parochial = pos.parochials?.[0];
  if (!parochial?.years) return null;
  const years = Object.keys(parochial.years).sort();
  for (let i = years.length - 1; i >= 0; i--) {
    const asa = parochial.years[years[i]]?.averageAttendance;
    if (asa != null && asa > 0) return asa;
  }
  return null;
}

function getPositionHousing(pos: Position): string {
  const fields = pos.deep_scrape_fields || [];
  const field = fields.find(f => f.label === 'Type of Housing Provided');
  return field?.value || '';
}

function getPositionSetting(pos: Position): string {
  const fields = pos.deep_scrape_fields || [];
  const field = fields.find(f => f.label === 'Ministry Setting');
  return field?.value || '';
}

export type { MatchResult };

export const MATCH_TIER_STYLES = {
  strong: { bg: 'bg-green-100', text: 'text-green-800', label: 'Strong match' },
  good: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Good match' },
  partial: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Partial match' },
  none: { bg: '', text: '', label: '' },
} as const;
