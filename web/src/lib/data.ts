import { Position, PositionChange, Meta } from './types';
import positionsData from '../../public/data/positions.json';
import changesData from '../../public/data/changes.json';
import metaData from '../../public/data/meta.json';

export function getPositions(): Position[] {
  return positionsData as Position[];
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
