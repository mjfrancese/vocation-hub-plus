'use client';

import { useState, useRef, useEffect } from 'react';

export interface FilterConfig {
  key: string;
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  width?: string;
}

interface FiltersProps {
  filters: FilterConfig[];
  onClear: () => void;
  postedWithin: string | null;
  onPostedWithinChange: (value: string | null) => void;
}

export default function Filters({
  filters,
  onClear,
  postedWithin,
  onPostedWithinChange,
}: FiltersProps) {
  const hasFilters = filters.some(f => f.selected.length > 0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeCount = filters.reduce((n, f) => n + f.selected.length, 0);

  return (
    <div className="space-y-3">
      {/* Mobile: toggle button */}
      <div className="sm:hidden">
        <button
          onClick={() => setFiltersOpen(!filtersOpen)}
          className="w-full flex items-center justify-between px-3 py-2.5 border border-gray-300
                     rounded-md text-sm text-gray-700 bg-white"
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters {activeCount > 0 && `(${activeCount})`}
          </span>
          <svg className={`w-4 h-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Filter dropdowns: always visible on sm+, collapsible on mobile */}
      <div className={`${filtersOpen ? 'block' : 'hidden'} sm:block`}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 items-end">
          {filters.map((f) => (
            <MultiSelect
              key={f.key}
              label={f.label}
              options={f.options}
              selected={f.selected}
              onChange={f.onChange}
            />
          ))}
          {/* Posted Within filter */}
          <div className="min-w-[140px]">
            <label className="block text-xs text-gray-500 mb-1">Posted</label>
            <select
              value={postedWithin || ''}
              onChange={(e) => onPostedWithinChange(e.target.value || null)}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">All time</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="6m">Last 6 months</option>
              <option value="1y">Last year</option>
            </select>
          </div>
          {hasFilters && (
            <button
              onClick={onClear}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900
                         border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {hasFilters && (
        <div className="flex flex-wrap gap-2">
          {filters.flatMap((f) =>
            f.selected.map((v) => (
              <Chip
                key={`${f.key}-${v}`}
                label={v}
                onRemove={() => f.onChange(f.selected.filter((s) => s !== v))}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs
                     font-medium bg-primary-100 text-primary-800 border border-primary-200">
      {label}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="hover:text-primary-900"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <div className="relative flex flex-col" ref={ref}>
      <label className="text-xs font-medium text-gray-500 mb-1">{label}</label>
      <button
        onClick={() => setOpen(!open)}
        className="w-full py-2 px-3 border border-gray-300 rounded-md text-sm text-left
                   text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500
                   focus:border-primary-500 bg-white flex items-center justify-between"
      >
        <span className="truncate">
          {selected.length === 0 ? 'All' : `${selected.length} selected`}
        </span>
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute mt-14 z-50 bg-white border border-gray-200 rounded-md shadow-lg
                        max-h-96 overflow-hidden flex flex-col w-full sm:min-w-[220px]">
          {options.length > 5 && (
            <div className="p-2 border-b border-gray-100">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Filter ${label.toLowerCase()}...`}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded
                           focus:outline-none focus:ring-1 focus:ring-primary-500"
                autoFocus
              />
            </div>
          )}
          <div className="overflow-y-auto max-h-80">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-gray-400">No matches</div>
            )}
            {filtered.map((option) => (
              <label
                key={option}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700
                           hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggle(option)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="truncate">{option}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-gray-100 p-2">
              <button
                onClick={() => onChange([])}
                className="w-full text-xs text-gray-500 hover:text-gray-700 py-1"
              >
                Clear {label.toLowerCase()}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
