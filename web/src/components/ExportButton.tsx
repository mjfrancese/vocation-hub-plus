'use client';

import { Position } from '@/lib/types';

interface ExportButtonProps {
  positions: Position[];
  filename?: string;
}

export default function ExportButton({ positions, filename = 'positions' }: ExportButtonProps) {
  function handleExport() {
    if (positions.length === 0) return;

    const headers = [
      'Name',
      'Diocese',
      'State',
      'Organization Type',
      'Position Type',
      'Receiving Names From',
      'Receiving Names To',
      'Updated on Hub',
      'Status',
      'First Seen',
      'Last Seen',
    ];

    const rows = positions.map((p) => [
      escapeCsv(p.name),
      escapeCsv(p.diocese),
      escapeCsv(p.state),
      escapeCsv(p.organization_type),
      escapeCsv(p.position_type),
      escapeCsv(p.receiving_names_from),
      escapeCsv(p.receiving_names_to),
      escapeCsv(p.updated_on_hub),
      escapeCsv(p.status),
      escapeCsv(p.first_seen),
      escapeCsv(p.last_seen),
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleExport}
      disabled={positions.length === 0}
      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium
                 text-gray-700 bg-white border border-gray-300 rounded-md
                 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      Export CSV
    </button>
  );
}

function escapeCsv(value: string): string {
  if (!value) return '';
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
