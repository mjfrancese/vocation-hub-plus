'use client';

import { Position } from '@/lib/types';

interface ComparisonBarProps {
  selected: Position[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onCompare: () => void;
}

export default function ComparisonBar({ selected, onRemove, onClear, onCompare }: ComparisonBarProps) {
  if (selected.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm text-gray-600 font-medium shrink-0">
            {selected.length} selected
          </span>
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {selected.map((pos) => {
              const name = pos.church_info?.name || pos.name;
              return (
                <span
                  key={pos.id}
                  className="inline-flex items-center gap-1 bg-primary-50 text-primary-700 text-xs font-medium px-2 py-1 rounded-full border border-primary-200 max-w-[200px] truncate"
                >
                  <span className="truncate">{name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(pos.id); }}
                    className="text-primary-400 hover:text-primary-700 shrink-0 ml-0.5"
                    aria-label={`Remove ${name}`}
                  >
                    &times;
                  </button>
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onClear}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5"
          >
            Clear
          </button>
          <button
            onClick={onCompare}
            disabled={selected.length < 2}
            className={`text-sm font-medium px-4 py-1.5 rounded-lg transition-colors ${
              selected.length >= 2
                ? 'bg-primary-600 text-white hover:bg-primary-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            Compare {selected.length} position{selected.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
