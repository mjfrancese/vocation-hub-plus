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
  statusValue: string;
  onStatusChange: (value: string) => void;
  onClear: () => void;
}

export default function Filters({
  filters,
  statusValue,
  onStatusChange,
  onClear,
}: FiltersProps) {
  const hasFilters = filters.some(f => f.selected.length > 0) || statusValue;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-end">
        {filters.map((f) => (
          <MultiSelect
            key={f.key}
            label={f.label}
            options={f.options}
            selected={f.selected}
            onChange={f.onChange}
            width={f.width || 'w-44'}
          />
        ))}
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-500 mb-1">Status</label>
          <select
            value={statusValue}
            onChange={(e) => onStatusChange(e.target.value)}
            className="block w-32 py-2 px-3 border border-gray-300 rounded-md text-sm
                       text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500
                       focus:border-primary-500 bg-white"
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="new">New</option>
            <option value="expired">Expired</option>
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
          {statusValue && (
            <Chip key="status" label={statusValue} onRemove={() => onStatusChange('')} />
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
  width = 'w-44',
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
    <div className="flex flex-col" ref={ref}>
      <label className="text-xs font-medium text-gray-500 mb-1">{label}</label>
      <button
        onClick={() => setOpen(!open)}
        className={`${width} py-2 px-3 border border-gray-300 rounded-md text-sm text-left
                   text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500
                   focus:border-primary-500 bg-white flex items-center justify-between`}
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
                        max-h-64 overflow-hidden flex flex-col" style={{ minWidth: '220px' }}>
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
          <div className="overflow-y-auto max-h-52">
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
