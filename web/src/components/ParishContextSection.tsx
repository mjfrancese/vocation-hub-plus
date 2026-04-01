'use client';

import type { ParishContext } from '@/lib/types';

interface Props {
  context: ParishContext;
}

function formatDollarCompact(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return `$${value}`;
}

function trendLine(label: string, trend: string | null, changePct: number | null): string | null {
  if (!trend || changePct == null) return null;
  const sign = changePct > 0 ? '+' : '';
  return `${label}: ${trend} (${sign}${changePct.toFixed(1)}%)`;
}

export default function ParishContextSection({ context }: Props) {
  const lines: string[] = [];

  // Clergy info
  if (context.clergy_count_10yr > 0) {
    const tenurePart = context.avg_tenure_years != null
      ? ` (avg tenure: ${context.avg_tenure_years} years)`
      : '';
    lines.push(`${context.clergy_count_10yr} clergy in the past 10 years${tenurePart}`);
  }

  // Attendance trend
  const attLine = trendLine('Average Sunday Attendance', context.attendance_trend, context.attendance_change_pct);
  if (attLine) lines.push(attLine);

  // Giving trend
  const givLine = trendLine('Plate & Pledge', context.giving_trend, context.giving_change_pct);
  if (givLine) lines.push(givLine);

  // Membership trend
  const memLine = trendLine('Membership', context.membership_trend, context.membership_change_pct);
  if (memLine) lines.push(memLine);

  // Operating revenue
  if (context.latest_operating_revenue) {
    lines.push(`Latest operating revenue: ${formatDollarCompact(context.latest_operating_revenue)}`);
  }

  if (lines.length === 0) return null;

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      <h4 className="text-sm font-semibold text-gray-700 mb-2">Parish Context</h4>
      <ul className="text-sm text-gray-600 space-y-1">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {context.years_of_data > 0 && (
        <p className="text-xs text-gray-400 mt-2">Based on {context.years_of_data} years of parochial report data</p>
      )}
    </div>
  );
}
