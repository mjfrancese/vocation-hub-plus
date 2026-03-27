/**
 * Vocation Hub position status categories.
 * The VH site uses its own status field on profile pages.
 */

export type StatusCategory = 'active' | 'starting' | 'interim' | 'filled' | 'closed' | 'unknown';

const STATUS_MAP: Record<string, StatusCategory> = {
  'Receiving names': 'active',
  'Reopened': 'active',
  'Beginning search': 'starting',
  'Developing profile': 'starting',
  'Profile complete': 'starting',
  'Developing self study': 'starting',
  'Seeking interim': 'interim',
  'Interim in place': 'interim',
  'Search complete': 'filled',
  'No longer receiving names': 'closed',
};

export function categorizeStatus(vhStatus: string): StatusCategory {
  return STATUS_MAP[vhStatus] || 'unknown';
}

export function getStatusLabel(category: StatusCategory): string {
  switch (category) {
    case 'active': return 'Active';
    case 'starting': return 'Starting';
    case 'interim': return 'Interim';
    case 'filled': return 'Filled';
    case 'closed': return 'Closed';
    default: return 'Unknown';
  }
}

export function getStatusStyle(category: StatusCategory): string {
  switch (category) {
    case 'active': return 'bg-green-100 text-green-800 border-green-200';
    case 'starting': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'interim': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'filled': return 'bg-gray-100 text-gray-600 border-gray-200';
    case 'closed': return 'bg-red-100 text-red-700 border-red-200';
    default: return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

export const ALL_STATUS_CATEGORIES: StatusCategory[] = [
  'active', 'starting', 'interim', 'filled', 'closed', 'unknown',
];

export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
  active: 'Active (Receiving Names)',
  starting: 'Starting (Developing)',
  interim: 'Interim',
  filled: 'Filled (Search Complete)',
  closed: 'Closed',
  unknown: 'Unknown',
};
