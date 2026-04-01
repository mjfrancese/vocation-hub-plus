'use client';

import type { ParishContext } from '@/lib/types';

interface Props {
  contexts: ParishContext[];
  churchNames?: string[];
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

function SingleParishContext({ context, name }: { context: ParishContext; name?: string }) {
  const lines: string[] = [];

  if (context.clergy_count_10yr > 0) {
    const tenurePart = context.avg_tenure_years != null
      ? ` (avg tenure: ${context.avg_tenure_years} years)`
      : '';
    lines.push(`${context.clergy_count_10yr} clergy in the past 10 years${tenurePart}`);
  }

  const attLine = trendLine('Average Sunday Attendance', context.attendance_trend, context.attendance_change_pct);
  if (attLine) lines.push(attLine);

  const givLine = trendLine('Plate & Pledge', context.giving_trend, context.giving_change_pct);
  if (givLine) lines.push(givLine);

  const memLine = trendLine('Membership', context.membership_trend, context.membership_change_pct);
  if (memLine) lines.push(memLine);

  if (context.latest_operating_revenue) {
    lines.push(`Latest operating revenue: ${formatDollarCompact(context.latest_operating_revenue)}`);
  }

  if (lines.length === 0) return null;

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      {name && <div className="text-xs font-semibold text-gray-500 mb-1">{name}</div>}
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

export default function ParishContextSection({ contexts, churchNames }: Props) {
  const rendered = contexts.map((ctx, i) => (
    <SingleParishContext
      key={i}
      context={ctx}
      name={contexts.length > 1 ? churchNames?.[i] : undefined}
    />
  )).filter(Boolean);

  if (rendered.length === 0) return null;

  if (rendered.length === 1) return <>{rendered[0]}</>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {rendered}
    </div>
  );
}
