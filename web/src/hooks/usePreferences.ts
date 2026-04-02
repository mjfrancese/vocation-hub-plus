'use client';

import { useState, useCallback, useEffect } from 'react';
import type { SearchPreferences } from '@/lib/types';

const STORAGE_KEY = 'vh_search_prefs';

const DEFAULT_PREFS: SearchPreferences = {
  positionTypes: [],
  regions: [],
  states: [],
  asaMin: null,
  asaMax: null,
  compMin: null,
  compMax: null,
  housing: null,
  ministrySettings: [],
  showDetailedMatch: true,
};

function loadPrefs(): SearchPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function hasActivePreferences(prefs: SearchPreferences): boolean {
  return (
    prefs.positionTypes.length > 0 ||
    prefs.regions.length > 0 ||
    prefs.states.length > 0 ||
    prefs.asaMin != null ||
    prefs.asaMax != null ||
    prefs.compMin != null ||
    prefs.compMax != null ||
    prefs.housing != null ||
    prefs.ministrySettings.length > 0
  );
}

export function countActivePreferences(prefs: SearchPreferences): number {
  let count = 0;
  if (prefs.positionTypes.length > 0) count++;
  if (prefs.regions.length > 0) count++;
  if (prefs.states.length > 0) count++;
  if (prefs.asaMin != null || prefs.asaMax != null) count++;
  if (prefs.compMin != null || prefs.compMax != null) count++;
  if (prefs.housing != null) count++;
  if (prefs.ministrySettings.length > 0) count++;
  return count;
}

export function usePreferences(): [SearchPreferences, (prefs: SearchPreferences) => void, () => void] {
  const [prefs, setPrefsState] = useState<SearchPreferences>(DEFAULT_PREFS);

  useEffect(() => {
    setPrefsState(loadPrefs());
  }, []);

  const save = useCallback((updated: SearchPreferences) => {
    setPrefsState(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const clear = useCallback(() => {
    setPrefsState(DEFAULT_PREFS);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return [prefs, save, clear];
}
