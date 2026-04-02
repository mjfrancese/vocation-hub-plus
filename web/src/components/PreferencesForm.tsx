'use client';

import { useState, useEffect } from 'react';
import type { SearchPreferences } from '@/lib/types';

interface PreferencesFormProps {
  prefs: SearchPreferences;
  onSave: (prefs: SearchPreferences) => void;
  onClear: () => void;
}

const POSITION_TYPES = [
  'Rector', 'Vicar', 'Priest-in-Charge', 'Assistant', 'Associate',
  'Curate', 'Dean', 'Interim', 'Canon', 'Other',
];

const REGIONS = ['Northeast', 'Southeast', 'Midwest', 'West', 'Southwest'];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
];

const MINISTRY_SETTINGS = ['Urban', 'Suburban', 'Small Town', 'Rural'];

export default function PreferencesForm({ prefs, onSave, onClear }: PreferencesFormProps) {
  const [local, setLocal] = useState<SearchPreferences>(prefs);

  useEffect(() => {
    setLocal(prefs);
  }, [prefs]);

  function toggle<K extends keyof SearchPreferences>(field: K, value: string) {
    const arr = local[field] as string[];
    const updated = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
    setLocal({ ...local, [field]: updated });
  }

  function setRange(field: 'asaMin' | 'asaMax' | 'compMin' | 'compMax', value: string) {
    const parsed = value === '' ? null : parseNumber(value);
    setLocal({ ...local, [field]: parsed });
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm font-semibold text-gray-900 mb-1">Search Preferences</div>
        <div className="text-xs text-gray-500">Set your criteria and matching positions will be highlighted on the Positions page.</div>
      </div>

      <FieldSection label="Position Types">
        <ChipGroup items={POSITION_TYPES} selected={local.positionTypes} onToggle={(v) => toggle('positionTypes', v)} />
      </FieldSection>

      <FieldSection label="Regions">
        <ChipGroup items={REGIONS} selected={local.regions} onToggle={(v) => toggle('regions', v)} />
      </FieldSection>

      <FieldSection label="States">
        <div className="flex flex-wrap gap-1.5">
          {local.states.map(s => (
            <span
              key={s}
              onClick={() => toggle('states', s)}
              className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800 cursor-pointer hover:bg-blue-200"
            >
              {s} &times;
            </span>
          ))}
          <select
            className="text-xs border border-gray-300 rounded px-2 py-1 text-gray-600"
            value=""
            onChange={(e) => {
              if (e.target.value && !local.states.includes(e.target.value)) {
                toggle('states', e.target.value);
              }
            }}
          >
            <option value="">Add state...</option>
            {US_STATES.filter(s => !local.states.includes(s)).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </FieldSection>

      <div className="grid grid-cols-2 gap-4">
        <FieldSection label="Church Size (ASA)">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Min"
              value={local.asaMin ?? ''}
              onChange={(e) => setRange('asaMin', e.target.value)}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="text"
              placeholder="Max"
              value={local.asaMax ?? ''}
              onChange={(e) => setRange('asaMax', e.target.value)}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center"
            />
          </div>
        </FieldSection>

        <FieldSection label="Compensation">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Min"
              value={local.compMin != null ? formatCompInput(local.compMin) : ''}
              onChange={(e) => setRange('compMin', e.target.value)}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="text"
              placeholder="Max"
              value={local.compMax != null ? formatCompInput(local.compMax) : ''}
              onChange={(e) => setRange('compMax', e.target.value)}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center"
            />
          </div>
        </FieldSection>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FieldSection label="Housing">
          <ChipGroup
            items={['Either', 'Rectory', 'Allowance']}
            selected={local.housing ? [local.housing === 'either' ? 'Either' : local.housing === 'rectory' ? 'Rectory' : 'Allowance'] : []}
            onToggle={(v) => {
              const mapped = v.toLowerCase() as 'either' | 'rectory' | 'allowance';
              setLocal({ ...local, housing: local.housing === mapped ? null : mapped });
            }}
          />
        </FieldSection>

        <FieldSection label="Ministry Setting">
          <ChipGroup items={MINISTRY_SETTINGS} selected={local.ministrySettings} onToggle={(v) => toggle('ministrySettings', v)} />
        </FieldSection>
      </div>

      <div className="flex gap-3 pt-3 border-t border-gray-200">
        <button
          onClick={() => onSave(local)}
          className="px-4 py-2 bg-blue-500 text-white text-xs font-medium rounded-lg hover:bg-blue-600 transition-colors"
        >
          Save Preferences
        </button>
        <button
          onClick={onClear}
          className="px-4 py-2 bg-white text-gray-600 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Clear All
        </button>
      </div>
    </div>
  );
}

function FieldSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function ChipGroup({ items, selected, onToggle }: { items: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(item => {
        const active = selected.includes(item);
        return (
          <button
            key={item}
            onClick={() => onToggle(item)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              active
                ? 'bg-blue-100 text-blue-800 border-blue-300'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

function parseNumber(val: string): number | null {
  const cleaned = val.replace(/[$,k]/gi, '');
  const num = Number(cleaned);
  if (isNaN(num)) return null;
  if (num > 0 && num < 1000 && val.toLowerCase().includes('k')) return num * 1000;
  return num;
}

function formatCompInput(val: number): string {
  if (val >= 1000) return `$${Math.round(val / 1000)}k`;
  return String(val);
}
