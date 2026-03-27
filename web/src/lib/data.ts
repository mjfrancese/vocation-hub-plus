import { Position, PositionChange, Meta } from './types';
import positionsData from '../../public/data/positions.json';
import changesData from '../../public/data/changes.json';
import metaData from '../../public/data/meta.json';
import profileFieldsData from '../../public/data/profile-fields.json';
import allProfilesData from '../../public/data/all-profiles.json';
import { getStateForDiocese } from './diocese-lookup';
import { deriveChurchName } from './church-name-parser';

const profileFields = profileFieldsData as unknown as Record<string, Array<{ label: string; value: string }>>;

interface RawProfile {
  vh_id: number;
  profile_url: string;
  diocese: string;
  congregation: string;
  position_type: string;
  status: string;
  all_fields: Array<{ label: string; value: string }>;
  [key: string]: unknown;
}

const allProfiles = allProfilesData as unknown as RawProfile[];

export function getPositions(): Position[] {
  const positions = positionsData as unknown as Position[];

  // Start with the public positions (from search table)
  const publicPositions = positions.map(pos => {
    const vhId = pos.vh_id;
    return {
      ...pos,
      visibility: 'public' as const,
      deep_scrape_fields: vhId ? profileFields[String(vhId)] : undefined,
    };
  });

  // Track which VH IDs are already in the public set
  const publicVhIds = new Set(publicPositions.map(p => p.vh_id).filter(Boolean));

  // Add active profiles from all-profiles that aren't in the public search
  const activeStatuses = new Set(['Receiving names', 'Reopened']);
  const extendedPositions: Position[] = [];

  for (const profile of allProfiles) {
    if (!activeStatuses.has(profile.status)) continue;
    if (publicVhIds.has(profile.vh_id)) continue;

    // Only include extended profiles that have real data.
    // Many "Receiving names" profiles are empty shells (no name, no salary).
    // Try to derive a church name from email addresses and other fields.
    const hasName = !!profile.congregation;
    const hasSalary = !!profile.salary_range;
    const hasAttendance = !!profile.avg_sunday_attendance && profile.avg_sunday_attendance !== '0';
    const derivedName = hasName ? '' : deriveChurchName(profile.all_fields || [], profile.diocese || '');
    const displayName = profile.congregation || derivedName;

    // Skip profiles with no identifiable name and no useful data
    if (!displayName && !hasSalary && !hasAttendance) continue;

    const diocese = profile.diocese || '';

    extendedPositions.push({
      id: `vh_${profile.vh_id}`,
      name: displayName || `Position in ${diocese}`,
      diocese,
      state: getStateForDiocese(diocese),
      organization_type: '',
      position_type: profile.position_type || '',
      receiving_names_from: '',
      receiving_names_to: '',
      updated_on_hub: '',
      first_seen: '',
      last_seen: '',
      status: 'active',
      details_url: '',
      visibility: 'extended',
      vh_status: profile.status,
      vh_id: profile.vh_id,
      profile_url: profile.profile_url,
      deep_scrape_fields: profile.all_fields,
    });
  }

  return [...publicPositions, ...extendedPositions];
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
