'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { SortField, SortDirection } from '@/lib/types';
import { DEFAULT_ACTIVE_STATUSES } from '@/lib/filter-defaults';

export interface FilterState {
  statuses: string[];
  states: string[];
  dioceses: string[];
  types: string[];
  compensationRanges: string[];
  regions: string[];
  settings: string[];
  housingTypes: string[];
  healthcareOptions: string[];
  postedWithin: string | null;
  sort: { field: SortField; direction: SortDirection };
  query: string;
  view: 'table' | 'map';
  expandedId: string | null;
}

export interface FilterActions {
  setStatuses: (v: string[]) => void;
  setStates: (v: string[]) => void;
  setDioceses: (v: string[]) => void;
  setTypes: (v: string[]) => void;
  setCompensationRanges: (v: string[]) => void;
  setRegions: (v: string[]) => void;
  setSettings: (v: string[]) => void;
  setHousingTypes: (v: string[]) => void;
  setHealthcareOptions: (v: string[]) => void;
  setPostedWithin: (v: string | null) => void;
  setSort: (field: SortField, direction: SortDirection) => void;
  setQuery: (v: string) => void;
  setView: (v: 'table' | 'map') => void;
  setExpandedId: (v: string | null) => void;
  clearAll: () => void;
}

const SORT_DEFAULT_FIELD: SortField = 'date';
const SORT_DEFAULT_DIR: SortDirection = 'desc';

function splitParam(val: string | null): string[] {
  if (!val) return [];
  return val.split(',').filter(Boolean);
}

function joinParam(arr: string[]): string | null {
  return arr.length > 0 ? arr.join(',') : null;
}

function parseSortParam(val: string | null): { field: SortField; direction: SortDirection } {
  if (!val) return { field: SORT_DEFAULT_FIELD, direction: SORT_DEFAULT_DIR };
  const [field, dir] = val.split(':');
  const validFields: SortField[] = ['name', 'diocese', 'date', 'updated', 'firstseen', 'quality_score'];
  const f = validFields.includes(field as SortField) ? (field as SortField) : SORT_DEFAULT_FIELD;
  const d: SortDirection = dir === 'asc' ? 'asc' : 'desc';
  return { field: f, direction: d };
}

export function useFilterState(): [FilterState, FilterActions] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const state: FilterState = useMemo(() => ({
    statuses: splitParam(searchParams.get('status')),
    states: splitParam(searchParams.get('state')),
    dioceses: splitParam(searchParams.get('diocese')),
    types: splitParam(searchParams.get('type')),
    compensationRanges: splitParam(searchParams.get('comp')),
    regions: splitParam(searchParams.get('region')),
    settings: splitParam(searchParams.get('setting')),
    housingTypes: splitParam(searchParams.get('housing')),
    healthcareOptions: splitParam(searchParams.get('healthcare')),
    postedWithin: searchParams.get('posted') || null,
    sort: parseSortParam(searchParams.get('sort')),
    query: searchParams.get('q') || '',
    view: (searchParams.get('view') === 'map' ? 'map' : 'table') as 'table' | 'map',
    expandedId: searchParams.get('expanded') || null,
  }), [searchParams]);

  const updateParams = useCallback((updates: Record<string, string | null>, push = false, scroll = true) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const str = params.toString();
    const url = str ? `${pathname}?${str}` : pathname;
    if (push) {
      router.push(url, { scroll });
    } else {
      router.replace(url);
    }
  }, [searchParams, router, pathname]);

  const actions: FilterActions = useMemo(() => ({
    setStatuses: (v) => updateParams({ status: joinParam(v) }),
    setStates: (v) => updateParams({ state: joinParam(v) }),
    setDioceses: (v) => updateParams({ diocese: joinParam(v) }),
    setTypes: (v) => updateParams({ type: joinParam(v) }),
    setCompensationRanges: (v) => updateParams({ comp: joinParam(v) }),
    setRegions: (v) => updateParams({ region: joinParam(v) }),
    setSettings: (v) => updateParams({ setting: joinParam(v) }),
    setHousingTypes: (v) => updateParams({ housing: joinParam(v) }),
    setHealthcareOptions: (v) => updateParams({ healthcare: joinParam(v) }),
    setPostedWithin: (v) => updateParams({ posted: v }),
    setSort: (field, direction) => {
      const val = `${field}:${direction}`;
      const defaultVal = `${SORT_DEFAULT_FIELD}:${SORT_DEFAULT_DIR}`;
      updateParams({ sort: val === defaultVal ? null : val });
    },
    setQuery: (v) => updateParams({ q: v || null }),
    setView: (v) => updateParams({ view: v === 'table' ? null : v }, true),
    setExpandedId: (v) => updateParams({ expanded: v }, true, false),
    clearAll: () => {
      router.replace(pathname);
    },
  }), [updateParams, router, pathname]);

  return [state, actions];
}
