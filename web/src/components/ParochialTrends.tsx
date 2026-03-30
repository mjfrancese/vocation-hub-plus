'use client';

interface YearData {
  averageAttendance: number | null;
  plateAndPledge: number | null;
  membership: number | null;
}

interface ParochialTrendsProps {
  data: {
    congregationCity: string;
    years: Record<string, YearData>;
  };
}

/**
 * Displays parochial report trend data (ASA, membership, plate & pledge)
 * as a compact display with trend indicators and expandable yearly breakdown.
 */
export default function ParochialTrends({ data }: ParochialTrendsProps) {
  const years = Object.keys(data.years)
    .map(Number)
    .sort((a, b) => a - b);

  if (years.length === 0) return null;

  const getYearData = (y: number) => data.years[String(y)] as YearData | undefined;

  // Compute trends (latest vs earliest non-null)
  const asaTrend = computeTrend(years, y => getYearData(y)?.averageAttendance);
  const memberTrend = computeTrend(years, y => getYearData(y)?.membership);
  const financeTrend = computeTrend(years, y => getYearData(y)?.plateAndPledge);

  // Get latest values
  const latest = getYearData(years[years.length - 1]);
  const latestASA = latest?.averageAttendance;
  const latestMembership = latest?.membership;
  const latestPP = latest?.plateAndPledge;

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-sm font-semibold text-gray-700">
          Parochial Report Data
        </h4>
        <span className="text-xs text-gray-400">
          {data.congregationCity} | {years[0]}-{years[years.length - 1]}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm mb-3">
        <MetricCard
          label="Avg Sunday Attendance"
          value={latestASA}
          trend={asaTrend}
        />
        <MetricCard
          label="Membership"
          value={latestMembership}
          trend={memberTrend}
        />
        <MetricCard
          label="Plate & Pledge"
          value={latestPP}
          trend={financeTrend}
          format="currency"
        />
      </div>

      {/* Sparkline table */}
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
          View yearly breakdown
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b">
                <th className="text-left py-1 pr-2">Year</th>
                <th className="text-right py-1 px-2">ASA</th>
                <th className="text-right py-1 px-2">Members</th>
                <th className="text-right py-1 px-2">Plate & Pledge</th>
              </tr>
            </thead>
            <tbody>
              {years.map(year => {
                const d = getYearData(year);
                return (
                  <tr key={year} className="border-b border-gray-100">
                    <td className="py-1 pr-2 font-medium">{year}</td>
                    <td className="text-right py-1 px-2">
                      {d?.averageAttendance ?? '--'}
                    </td>
                    <td className="text-right py-1 px-2">
                      {d?.membership != null ? d.membership.toLocaleString() : '--'}
                    </td>
                    <td className="text-right py-1 px-2">
                      {d?.plateAndPledge != null ? `$${d.plateAndPledge.toLocaleString()}` : '--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function MetricCard({
  label,
  value,
  trend,
  format,
}: {
  label: string;
  value: number | null | undefined;
  trend: { pct: number; direction: 'up' | 'down' | 'flat' } | null;
  format?: 'currency';
}) {
  const displayValue =
    value == null
      ? '--'
      : format === 'currency'
        ? `$${value.toLocaleString()}`
        : value.toLocaleString();

  return (
    <div>
      <div className="text-gray-500 mb-1">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{displayValue}</div>
      {trend && (
        <div className="text-xs text-gray-500">
          {trend.pct > 0 ? '+' : ''}
          {trend.pct.toFixed(0)}% over period
        </div>
      )}
    </div>
  );
}

function computeTrend(
  years: number[],
  getValue: (year: number) => number | null | undefined,
): { pct: number; direction: 'up' | 'down' | 'flat' } | null {
  let earliest: number | null = null;
  let latest: number | null = null;

  for (const y of years) {
    const v = getValue(y);
    if (v != null) {
      if (earliest === null) earliest = v;
      latest = v;
    }
  }

  if (earliest === null || latest === null || earliest === 0) return null;

  const pct = ((latest - earliest) / earliest) * 100;
  const direction = pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat';
  return { pct, direction };
}
