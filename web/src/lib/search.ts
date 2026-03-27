import Fuse, { IFuseOptions } from 'fuse.js';
import { Position } from './types';

const fuseOptions: IFuseOptions<Position> = {
  keys: [
    { name: 'name', weight: 2 },
    { name: 'diocese', weight: 1.5 },
    { name: 'state', weight: 1 },
    { name: 'position_type', weight: 1.5 },
    { name: 'organization_type', weight: 1 },
    // Deep scrape detail fields
    { name: 'position_description', weight: 1 },
    { name: 'community_description', weight: 0.8 },
    { name: 'desired_skills', weight: 1 },
    { name: 'city', weight: 1 },
    { name: 'minimum_stipend', weight: 0.8 },
    { name: 'maximum_stipend', weight: 0.8 },
    { name: 'benefits', weight: 0.5 },
    { name: 'worship_style', weight: 0.5 },
    { name: 'housing_type', weight: 0.5 },
    { name: 'challenges', weight: 0.5 },
    { name: 'narrative_reflections', weight: 0.3 },
    // Search through raw deep scrape fields
    { name: 'deep_scrape_fields.value', weight: 0.5 },
    { name: 'deep_scrape_fields.label', weight: 0.3 },
  ],
  threshold: 0.35,
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

export function createSearchIndex(positions: Position[]): Fuse<Position> {
  return new Fuse(positions, fuseOptions);
}

export function searchPositions(fuse: Fuse<Position>, query: string): Position[] {
  if (!query.trim()) {
    return [];
  }
  return fuse.search(query).map((result) => result.item);
}
