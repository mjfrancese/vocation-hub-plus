import { RawPosition } from './scrape-results.js';
import { upsertPosition, markExpired, promoteNewToActive } from './db.js';
import { logger } from './logger.js';

export interface DiffResult {
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  expiredCount: number;
}

/**
 * Compare scraped positions against the database and apply changes.
 */
export function applyDiff(positions: RawPosition[]): DiffResult {
  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  const currentIds = new Set<string>();

  for (const position of positions) {
    currentIds.add(position.id);
    const result = upsertPosition(position);

    switch (result) {
      case 'new':
        newCount++;
        break;
      case 'updated':
        updatedCount++;
        break;
      case 'unchanged':
        unchangedCount++;
        break;
    }
  }

  // Mark positions not in current scrape as expired
  const expiredCount = markExpired(currentIds);

  // Promote "new" positions that have been seen again to "active"
  promoteNewToActive();

  logger.info('Diff complete', { newCount, updatedCount, unchangedCount, expiredCount });

  return { newCount, updatedCount, unchangedCount, expiredCount };
}

/**
 * Pure diff logic for testing (no DB dependency).
 * Compares two sets of positions and returns change categories.
 */
export function computeDiff(
  previous: RawPosition[],
  current: RawPosition[]
): {
  added: RawPosition[];
  removed: RawPosition[];
  changed: Array<{ id: string; before: RawPosition; after: RawPosition }>;
  unchanged: RawPosition[];
} {
  const prevMap = new Map(previous.map((p) => [p.id, p]));
  const currMap = new Map(current.map((p) => [p.id, p]));

  const added: RawPosition[] = [];
  const removed: RawPosition[] = [];
  const changed: Array<{ id: string; before: RawPosition; after: RawPosition }> = [];
  const unchanged: RawPosition[] = [];

  for (const [id, pos] of currMap) {
    const prev = prevMap.get(id);
    if (!prev) {
      added.push(pos);
    } else if (hasPositionChanged(prev, pos)) {
      changed.push({ id, before: prev, after: pos });
    } else {
      unchanged.push(pos);
    }
  }

  for (const [id, pos] of prevMap) {
    if (!currMap.has(id)) {
      removed.push(pos);
    }
  }

  return { added, removed, changed, unchanged };
}

function hasPositionChanged(a: RawPosition, b: RawPosition): boolean {
  return (
    a.name !== b.name ||
    a.diocese !== b.diocese ||
    a.state !== b.state ||
    a.organizationType !== b.organizationType ||
    a.positionType !== b.positionType ||
    a.receivingNamesFrom !== b.receivingNamesFrom ||
    a.receivingNamesTo !== b.receivingNamesTo ||
    a.updatedOnHub !== b.updatedOnHub
  );
}
