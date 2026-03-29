import { describe, it, expect } from 'vitest';
import {
  getStatusStyle,
  getStatusShortLabel,
  isActiveStatus,
  isDevelopingStatus,
  isClosedStatus,
  isInterimStatus,
} from '../status-helpers';

const ALL_STATUSES = [
  'Receiving names',
  'Reopened',
  'Beginning search',
  'Developing profile',
  'Profile complete',
  'Developing self study',
  'Seeking interim',
  'Interim in place',
  'Search complete',
  'No longer receiving names',
];

describe('getStatusStyle', () => {
  it('returns green classes for "Receiving names"', () => {
    expect(getStatusStyle('Receiving names')).toBe(
      'bg-green-100 text-green-800 border-green-200'
    );
  });

  it('returns green classes for "Reopened"', () => {
    expect(getStatusStyle('Reopened')).toBe(
      'bg-green-100 text-green-800 border-green-200'
    );
  });

  it('returns blue classes for "Beginning search"', () => {
    expect(getStatusStyle('Beginning search')).toBe(
      'bg-blue-100 text-blue-800 border-blue-200'
    );
  });

  it('returns blue classes for "Developing profile"', () => {
    expect(getStatusStyle('Developing profile')).toBe(
      'bg-blue-100 text-blue-800 border-blue-200'
    );
  });

  it('returns blue classes for "Profile complete"', () => {
    expect(getStatusStyle('Profile complete')).toBe(
      'bg-blue-100 text-blue-800 border-blue-200'
    );
  });

  it('returns blue classes for "Developing self study"', () => {
    expect(getStatusStyle('Developing self study')).toBe(
      'bg-blue-100 text-blue-800 border-blue-200'
    );
  });

  it('returns yellow classes for "Seeking interim"', () => {
    expect(getStatusStyle('Seeking interim')).toBe(
      'bg-yellow-100 text-yellow-800 border-yellow-200'
    );
  });

  it('returns yellow classes for "Interim in place"', () => {
    expect(getStatusStyle('Interim in place')).toBe(
      'bg-yellow-100 text-yellow-800 border-yellow-200'
    );
  });

  it('returns gray classes for "Search complete"', () => {
    expect(getStatusStyle('Search complete')).toBe(
      'bg-gray-100 text-gray-600 border-gray-200'
    );
  });

  it('returns red classes for "No longer receiving names"', () => {
    expect(getStatusStyle('No longer receiving names')).toBe(
      'bg-red-100 text-red-700 border-red-200'
    );
  });

  it('returns fallback gray classes for unknown status', () => {
    expect(getStatusStyle('Unknown status')).toBe(
      'bg-gray-100 text-gray-500 border-gray-200'
    );
  });

  it('returns fallback gray classes for empty string', () => {
    expect(getStatusStyle('')).toBe('bg-gray-100 text-gray-500 border-gray-200');
  });
});

describe('getStatusShortLabel', () => {
  it('returns "Receiving" for "Receiving names"', () => {
    expect(getStatusShortLabel('Receiving names')).toBe('Receiving');
  });

  it('returns "Reopened" for "Reopened"', () => {
    expect(getStatusShortLabel('Reopened')).toBe('Reopened');
  });

  it('returns "Beginning" for "Beginning search"', () => {
    expect(getStatusShortLabel('Beginning search')).toBe('Beginning');
  });

  it('returns "Developing" for "Developing profile"', () => {
    expect(getStatusShortLabel('Developing profile')).toBe('Developing');
  });

  it('returns "Profile Ready" for "Profile complete"', () => {
    expect(getStatusShortLabel('Profile complete')).toBe('Profile Ready');
  });

  it('returns "Self Study" for "Developing self study"', () => {
    expect(getStatusShortLabel('Developing self study')).toBe('Self Study');
  });

  it('returns "Seeking Interim" for "Seeking interim"', () => {
    expect(getStatusShortLabel('Seeking interim')).toBe('Seeking Interim');
  });

  it('returns "Interim" for "Interim in place"', () => {
    expect(getStatusShortLabel('Interim in place')).toBe('Interim');
  });

  it('returns "Complete" for "Search complete"', () => {
    expect(getStatusShortLabel('Search complete')).toBe('Complete');
  });

  it('returns "Closed" for "No longer receiving names"', () => {
    expect(getStatusShortLabel('No longer receiving names')).toBe('Closed');
  });

  it('returns the status itself for an unknown status', () => {
    expect(getStatusShortLabel('Some new status')).toBe('Some new status');
  });

  it('returns "Unknown" for empty string', () => {
    expect(getStatusShortLabel('')).toBe('Unknown');
  });
});

describe('isActiveStatus', () => {
  it('returns true for "Receiving names"', () => {
    expect(isActiveStatus('Receiving names')).toBe(true);
  });

  it('returns true for "Reopened"', () => {
    expect(isActiveStatus('Reopened')).toBe(true);
  });

  it('returns false for all non-active statuses', () => {
    const nonActive = ALL_STATUSES.filter(
      (s) => s !== 'Receiving names' && s !== 'Reopened'
    );
    for (const s of nonActive) {
      expect(isActiveStatus(s), `expected isActiveStatus("${s}") to be false`).toBe(false);
    }
  });

  it('returns false for unknown status', () => {
    expect(isActiveStatus('Unknown')).toBe(false);
  });
});

describe('isDevelopingStatus', () => {
  it('returns true for "Beginning search"', () => {
    expect(isDevelopingStatus('Beginning search')).toBe(true);
  });

  it('returns true for "Developing profile"', () => {
    expect(isDevelopingStatus('Developing profile')).toBe(true);
  });

  it('returns true for "Profile complete"', () => {
    expect(isDevelopingStatus('Profile complete')).toBe(true);
  });

  it('returns true for "Developing self study"', () => {
    expect(isDevelopingStatus('Developing self study')).toBe(true);
  });

  it('returns false for all non-developing statuses', () => {
    const nonDeveloping = ALL_STATUSES.filter(
      (s) =>
        !['Beginning search', 'Developing profile', 'Profile complete', 'Developing self study'].includes(s)
    );
    for (const s of nonDeveloping) {
      expect(isDevelopingStatus(s), `expected isDevelopingStatus("${s}") to be false`).toBe(false);
    }
  });

  it('returns false for unknown status', () => {
    expect(isDevelopingStatus('Unknown')).toBe(false);
  });
});

describe('isClosedStatus', () => {
  it('returns true for "Search complete"', () => {
    expect(isClosedStatus('Search complete')).toBe(true);
  });

  it('returns true for "No longer receiving names"', () => {
    expect(isClosedStatus('No longer receiving names')).toBe(true);
  });

  it('returns false for all non-closed statuses', () => {
    const nonClosed = ALL_STATUSES.filter(
      (s) => s !== 'Search complete' && s !== 'No longer receiving names'
    );
    for (const s of nonClosed) {
      expect(isClosedStatus(s), `expected isClosedStatus("${s}") to be false`).toBe(false);
    }
  });

  it('returns false for unknown status', () => {
    expect(isClosedStatus('Unknown')).toBe(false);
  });
});

describe('isInterimStatus', () => {
  it('returns true for "Seeking interim"', () => {
    expect(isInterimStatus('Seeking interim')).toBe(true);
  });

  it('returns true for "Interim in place"', () => {
    expect(isInterimStatus('Interim in place')).toBe(true);
  });

  it('returns false for all non-interim statuses', () => {
    const nonInterim = ALL_STATUSES.filter(
      (s) => s !== 'Seeking interim' && s !== 'Interim in place'
    );
    for (const s of nonInterim) {
      expect(isInterimStatus(s), `expected isInterimStatus("${s}") to be false`).toBe(false);
    }
  });

  it('returns false for unknown status', () => {
    expect(isInterimStatus('Unknown')).toBe(false);
  });
});
