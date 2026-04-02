'use client';

import type { ChurchInfo } from '@/lib/types';

interface ChurchSelectorProps {
  churches: ChurchInfo[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/**
 * Multi-church pill selector. Only renders when position serves
 * multiple congregations. Filters parish-specific data throughout all tabs.
 */
export default function ChurchSelector({ churches, selectedIndex, onSelect }: ChurchSelectorProps) {
  if (churches.length <= 1) return null;

  return (
    <div className="flex items-center gap-2 py-2">
      <span className="text-xs text-gray-500 font-medium flex-shrink-0">
        Serving {churches.length} congregations
      </span>
      <div className="flex flex-wrap gap-1.5">
        {churches.map((church, i) => {
          const label = [church.name, church.city].filter(Boolean).join(', ') || `Church ${i + 1}`;
          return (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); onSelect(i); }}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                i === selectedIndex
                  ? 'bg-gray-700 text-white border-gray-700'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
