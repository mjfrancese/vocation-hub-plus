'use client';

import type { PersonalData } from '@/lib/types';

interface Props {
  positions: PersonalData['positions'];
  ordinationYear: number | null;
}

export default function CareerTimeline({ positions, ordinationYear }: Props) {
  const currentYear = new Date().getFullYear();

  // Sort: current first, then by start_year descending
  const sorted = [...positions].sort((a, b) => {
    if (a.is_current && !b.is_current) return -1;
    if (!a.is_current && b.is_current) return 1;
    return (b.start_year || 0) - (a.start_year || 0);
  });

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

      {/* Ordination marker */}
      {ordinationYear && (
        <div className="relative flex items-center mb-6 pl-10">
          <div className="absolute left-2.5 w-3 h-3 rounded-full bg-amber-400 border-2 border-white" />
          <div className="text-sm text-amber-700 font-medium">
            Ordained {ordinationYear}
          </div>
        </div>
      )}

      {/* Position entries */}
      {sorted.map((pos, i) => {
        const duration = pos.start_year
          ? (pos.is_current ? currentYear : (pos.end_year || currentYear)) - pos.start_year
          : null;
        const dateRange = pos.start_year
          ? `${pos.start_year}${pos.is_current ? ' - present' : pos.end_year ? ` - ${pos.end_year}` : ''}`
          : 'Dates unknown';

        return (
          <div key={i} className="relative flex items-start mb-6 pl-10">
            <div className={`absolute left-2.5 w-3 h-3 rounded-full border-2 border-white ${
              pos.is_current ? 'bg-green-500' : 'bg-blue-400'
            }`} />
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <h4 className={`text-sm font-semibold ${pos.is_current ? 'text-green-700' : 'text-gray-800'}`}>
                  {pos.title}
                </h4>
                {pos.is_current && (
                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Current</span>
                )}
              </div>
              <p className="text-sm text-gray-600">{pos.parish}</p>
              <p className="text-xs text-gray-500">
                {pos.diocese}{pos.city && pos.state ? ` \u00b7 ${pos.city}, ${pos.state}` : ''}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {dateRange}{duration != null ? ` (${duration} year${duration !== 1 ? 's' : ''})` : ''}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
