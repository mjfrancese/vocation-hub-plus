'use client';

import { useState } from 'react';
import type { SearchPreferences } from '@/lib/types';
import { countActivePreferences } from '@/hooks/usePreferences';

interface PreferencesPanelProps {
  prefs: SearchPreferences;
  onToggleDetailed: (detailed: boolean) => void;
}

export default function PreferencesPanel({ prefs, onToggleDetailed }: PreferencesPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const activeCount = countActivePreferences(prefs);

  if (activeCount === 0) return null;

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700">My Preferences</span>
          <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
            {activeCount} active
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label
            className="flex items-center gap-1.5 text-[11px] text-gray-500"
            onClick={(e) => e.stopPropagation()}
          >
            <span>Detailed</span>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleDetailed(!prefs.showDetailedMatch); }}
              className={`relative w-8 h-[18px] rounded-full transition-colors ${
                prefs.showDetailedMatch ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-[2px] w-[14px] h-[14px] bg-white rounded-full transition-transform ${
                  prefs.showDetailedMatch ? 'right-[2px]' : 'left-[2px]'
                }`}
              />
            </button>
          </label>
          <span className={`text-gray-400 text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}>
            &#9660;
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center gap-3">
          {prefs.positionTypes.length > 0 && (
            <PrefChips label="Types" values={prefs.positionTypes} />
          )}
          {prefs.regions.length > 0 && (
            <PrefChips label="Regions" values={prefs.regions} />
          )}
          {prefs.states.length > 0 && (
            <PrefChips label="States" values={prefs.states} />
          )}
          {(prefs.asaMin != null || prefs.asaMax != null) && (
            <PrefRange label="ASA" min={prefs.asaMin} max={prefs.asaMax} />
          )}
          {(prefs.compMin != null || prefs.compMax != null) && (
            <PrefRange label="Comp" min={prefs.compMin} max={prefs.compMax} format="comp" />
          )}
          {prefs.housing != null && (
            <PrefChips label="Housing" values={[prefs.housing === 'either' ? 'Either' : prefs.housing === 'rectory' ? 'Rectory' : 'Allowance']} />
          )}
          {prefs.ministrySettings.length > 0 && (
            <PrefChips label="Setting" values={prefs.ministrySettings} />
          )}
          <a
            href="/me#preferences"
            className="text-[11px] text-blue-500 hover:text-blue-700 ml-auto"
          >
            Edit in Dashboard &rarr;
          </a>
        </div>
      )}
    </div>
  );
}

function PrefChips({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-gray-500 font-medium">{label}:</span>
      {values.map(v => (
        <span key={v} className="px-1.5 py-0.5 rounded-full text-[11px] bg-blue-100 text-blue-800">
          {v}
        </span>
      ))}
    </div>
  );
}

function PrefRange({ label, min, max, format }: { label: string; min: number | null; max: number | null; format?: 'comp' }) {
  const fmt = (v: number) => format === 'comp' ? `$${Math.round(v / 1000)}k` : String(v);
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-gray-500 font-medium">{label}:</span>
      <span className="text-[11px] text-gray-700">
        {min != null ? fmt(min) : '...'} - {max != null ? fmt(max) : '...'}
      </span>
    </div>
  );
}
