import { describe, it, expect } from 'vitest';
import { computeDiff } from '../src/diff.js';
import { RawPosition } from '../src/scrape-results.js';

function makePosition(overrides: Partial<RawPosition> = {}): RawPosition {
  return {
    id: 'test-id-1',
    name: 'St. Mark\'s Church',
    diocese: 'Diocese of Virginia',
    state: 'VA',
    organizationType: 'Congregation',
    positionType: 'Rector',
    receivingNamesFrom: '2024-01-01',
    receivingNamesTo: '2024-06-01',
    updatedOnHub: '2024-01-15',
    detailsUrl: '',
    rawHtml: '<tr>...</tr>',
    ...overrides,
  };
}

describe('computeDiff', () => {
  it('should detect new positions', () => {
    const previous: RawPosition[] = [];
    const current = [makePosition()];

    const result = computeDiff(previous, current);

    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
  });

  it('should detect removed positions', () => {
    const previous = [makePosition()];
    const current: RawPosition[] = [];

    const result = computeDiff(previous, current);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
    expect(result.changed).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
  });

  it('should detect unchanged positions', () => {
    const pos = makePosition();
    const result = computeDiff([pos], [{ ...pos }]);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
    expect(result.unchanged).toHaveLength(1);
  });

  it('should detect changed positions', () => {
    const before = makePosition();
    const after = makePosition({ positionType: 'Associate Rector' });

    const result = computeDiff([before], [after]);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].before.positionType).toBe('Rector');
    expect(result.changed[0].after.positionType).toBe('Associate Rector');
  });

  it('should handle mixed changes', () => {
    const kept = makePosition({ id: 'kept', name: 'Kept Church' });
    const removed = makePosition({ id: 'removed', name: 'Removed Church' });
    const changed = makePosition({ id: 'changed', name: 'Changed Church' });
    const changedAfter = makePosition({ id: 'changed', name: 'Changed Church', state: 'MD' });
    const added = makePosition({ id: 'added', name: 'Added Church' });

    const result = computeDiff([kept, removed, changed], [kept, changedAfter, added]);

    expect(result.added).toHaveLength(1);
    expect(result.added[0].id).toBe('added');
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].id).toBe('removed');
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].id).toBe('changed');
    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0].id).toBe('kept');
  });
});
