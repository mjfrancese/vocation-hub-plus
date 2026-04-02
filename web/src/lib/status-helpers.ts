/**
 * VH status display helpers.
 * Shows actual Vocation Hub status terms rather than abstract categories.
 */

// Color mapping for VH status strings
const STATUS_COLORS: Record<string, string> = {
  'Receiving names': 'bg-green-100 text-green-800 border-green-200',
  'Reopened': 'bg-green-100 text-green-800 border-green-200',
  'Beginning search': 'bg-blue-100 text-blue-800 border-blue-200',
  'Developing profile': 'bg-blue-100 text-blue-800 border-blue-200',
  'Profile complete': 'bg-blue-100 text-blue-800 border-blue-200',
  'Developing self study': 'bg-blue-100 text-blue-800 border-blue-200',
  'Seeking interim': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Interim in place': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Search complete': 'bg-gray-100 text-gray-600 border-gray-200',
  'No longer receiving names': 'bg-red-100 text-red-700 border-red-200',
};

// Short labels for table column display
const STATUS_SHORT: Record<string, string> = {
  'Receiving names': 'Receiving',
  'Reopened': 'Reopened',
  'Beginning search': 'Beginning',
  'Developing profile': 'Developing',
  'Profile complete': 'Profile Ready',
  'Developing self study': 'Self Study',
  'Seeking interim': 'Seeking Interim',
  'Interim in place': 'Interim',
  'Search complete': 'Complete',
  'No longer receiving names': 'Closed',
};

export function getStatusStyle(status: string): string {
  return STATUS_COLORS[status] || 'bg-gray-100 text-gray-500 border-gray-200';
}

export function getStatusShortLabel(status: string): string {
  return STATUS_SHORT[status] || status || 'Unknown';
}

export function isActiveStatus(status: string): boolean {
  return status === 'Receiving names' || status === 'Reopened';
}

export function isDevelopingStatus(status: string): boolean {
  return ['Beginning search', 'Developing profile', 'Profile complete', 'Developing self study'].includes(status);
}

export function isClosedStatus(status: string): boolean {
  return status === 'Search complete' || status === 'No longer receiving names';
}

export function isInterimStatus(status: string): boolean {
  return status === 'Seeking interim' || status === 'Interim in place';
}

// Unified status model used for both filtering and display
export type UnifiedStatus = 'Active' | 'Developing' | 'Interim' | 'Closed' | 'Directory Only';

export const UNIFIED_STATUSES: UnifiedStatus[] = ['Active', 'Developing', 'Interim', 'Closed', 'Directory Only'];

export const UNIFIED_STATUS_STYLES: Record<UnifiedStatus, string> = {
  'Active': 'bg-green-100 text-green-800 border-green-200',
  'Developing': 'bg-blue-100 text-blue-800 border-blue-200',
  'Interim': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Closed': 'bg-gray-100 text-gray-600 border-gray-200',
  'Directory Only': 'bg-gray-50 text-gray-400 border-gray-200',
};

export const UNIFIED_STATUS_CHIP_COLORS: Record<UnifiedStatus, { color: string; activeColor: string }> = {
  'Active': { color: 'bg-green-50 text-green-700 border-green-200', activeColor: 'bg-green-600 text-white border-green-600' },
  'Developing': { color: 'bg-blue-50 text-blue-700 border-blue-200', activeColor: 'bg-blue-600 text-white border-blue-600' },
  'Interim': { color: 'bg-yellow-50 text-yellow-700 border-yellow-200', activeColor: 'bg-yellow-600 text-white border-yellow-600' },
  'Closed': { color: 'bg-gray-50 text-gray-600 border-gray-200', activeColor: 'bg-gray-600 text-white border-gray-600' },
  'Directory Only': { color: 'bg-gray-50 text-gray-400 border-gray-200', activeColor: 'bg-gray-500 text-white border-gray-500' },
};

/**
 * Derive a unified status for a position based on vh_status and visibility.
 * This provides a single categorization used for both filtering and display.
 */
export function getUnifiedStatus(
  vhStatus: string | undefined,
  visibility: string | undefined,
): UnifiedStatus {
  const vis = visibility || 'public';
  const status = vhStatus || '';

  // Extended (directory-only) positions with no active VH search status
  if (vis === 'extended' || vis === 'extended_hidden') {
    // Even directory positions can have a VH status if they were scraped from the hub
    if (isActiveStatus(status)) return 'Active';
    if (isDevelopingStatus(status)) return 'Developing';
    if (isInterimStatus(status)) return 'Interim';
    if (isClosedStatus(status)) return 'Closed';
    return 'Directory Only';
  }

  // Public positions: derive from vh_status
  if (isActiveStatus(status)) return 'Active';
  if (isDevelopingStatus(status)) return 'Developing';
  if (isInterimStatus(status)) return 'Interim';
  if (isClosedStatus(status)) return 'Closed';

  // Public with no recognized vh_status -- default to Active
  return 'Active';
}
