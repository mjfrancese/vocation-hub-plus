'use client';

import { PositionChange } from '@/lib/types';
import { formatRelativeTime } from '@/lib/data';

interface ChangeLogProps {
  changes: PositionChange[];
  limit?: number;
}

const typeStyles: Record<string, string> = {
  new: 'bg-green-100 text-green-800',
  expired: 'bg-gray-100 text-gray-600',
  reappeared: 'bg-blue-100 text-blue-800',
  updated: 'bg-yellow-100 text-yellow-800',
};

const typeLabels: Record<string, string> = {
  new: 'New',
  expired: 'Expired',
  reappeared: 'Reappeared',
  updated: 'Updated',
};

export default function ChangeLog({ changes, limit = 20 }: ChangeLogProps) {
  const displayed = changes.slice(0, limit);

  if (displayed.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No changes recorded yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {displayed.map((change) => (
        <div
          key={change.id}
          className="flex items-start gap-3 p-3 bg-white border border-gray-200 rounded-lg"
        >
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${typeStyles[change.change_type] || ''}`}
          >
            {typeLabels[change.change_type] || change.change_type}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{change.name}</p>
            <p className="text-xs text-gray-500">
              {change.diocese} &middot; {change.position_type}
            </p>
          </div>
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {formatRelativeTime(change.changed_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
