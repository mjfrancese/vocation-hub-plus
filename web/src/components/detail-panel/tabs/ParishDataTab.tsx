'use client';

import { Position } from '@/lib/types';
import {
  extractParochialMetrics,
  trendDescription,
  trendColorClass,
  formatDollarFull,
} from '@/lib/narrative-helpers';
import { ordinalSuffix } from '@/lib/date-utils';

interface ParishDataTabProps {
  pos: Position;
  churchIndex: number;
}

/**
 * Parish Data tab: raw parochial data for data-oriented users.
 * Shows summary metrics, diocese ranking, and yearly breakdown table.
 */
export default function ParishDataTab({ pos, churchIndex }: ParishDataTabProps) {
  const parochial = pos.parochials?.[churchIndex];
  if (!parochial || Object.keys(parochial.years).length === 0) {
    return (
      <div className="text-sm text-gray-500 py-6 text-center">
        No parochial report data available for this position.
      </div>
    );
  }

  const metrics = extractParochialMetrics(pos, churchIndex);
  const dp = pos.diocese_percentiles;
  const years = Object.keys(parochial.years).sort().reverse();

  return (
    <div className="space-y-6">
      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Avg Sunday Attendance"
          value={metrics.latestAsa != null ? String(metrics.latestAsa) : null}
          year={metrics.latestAsaYear}
          trend={metrics.asaTrend}
        />
        <MetricCard
          label="Membership"
          value={metrics.latestMembership != null ? metrics.latestMembership.toLocaleString() : null}
          year={metrics.latestMembershipYear}
          trend={metrics.membershipTrend}
        />
        <MetricCard
          label="Plate & Pledge"
          value={metrics.latestPlatePledge != null ? formatDollarFull(metrics.latestPlatePledge) : null}
          year={metrics.latestPlatePledgeYear}
          trend={metrics.givingTrend}
        />
      </div>

      {/* Diocese Ranking */}
      {dp && (dp.asa != null || dp.plate_pledge != null || dp.membership != null) && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Diocese Ranking
          </h3>
          <div className="flex flex-wrap gap-4 text-sm text-gray-700">
            {dp.asa != null && (
              <span>
                Attendance: <span className="font-semibold text-primary-900">{dp.asa}{ordinalSuffix(dp.asa)} percentile</span>
              </span>
            )}
            {dp.plate_pledge != null && (
              <span>
                Giving: <span className="font-semibold text-primary-900">{dp.plate_pledge}{ordinalSuffix(dp.plate_pledge)} percentile</span>
              </span>
            )}
            {dp.membership != null && (
              <span>
                Membership: <span className="font-semibold text-primary-900">{dp.membership}{ordinalSuffix(dp.membership)} percentile</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Yearly Breakdown Table */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Yearly Breakdown
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-200">
                <th className="text-left py-2 pr-4 font-medium">Year</th>
                <th className="text-right py-2 px-4 font-medium">ASA</th>
                <th className="text-right py-2 px-4 font-medium">Members</th>
                <th className="text-right py-2 px-4 font-medium">Plate & Pledge</th>
              </tr>
            </thead>
            <tbody>
              {years.map(year => {
                const d = parochial.years[year];
                return (
                  <tr key={year} className="border-b border-gray-100">
                    <td className="py-1.5 pr-4 font-medium text-gray-700">{year}</td>
                    <td className="text-right py-1.5 px-4">
                      {d?.averageAttendance != null ? d.averageAttendance : <span className="text-gray-400">--</span>}
                    </td>
                    <td className="text-right py-1.5 px-4">
                      {d?.membership != null ? d.membership.toLocaleString() : <span className="text-gray-400">--</span>}
                    </td>
                    <td className="text-right py-1.5 px-4">
                      {d?.plateAndPledge != null ? `$${d.plateAndPledge.toLocaleString()}` : <span className="text-gray-400">--</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  year,
  trend,
}: {
  label: string;
  value: string | null;
  year: string | null;
  trend: { pct: number; direction: 'up' | 'down' | 'flat'; startYear: string; endYear: string; startValue: number; endValue: number } | null;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-xl font-semibold text-gray-900">
        {value || <span className="text-gray-400">--</span>}
      </div>
      {year && (
        <div className="text-xs text-gray-400 mt-0.5">As of {year}</div>
      )}
      {trend && (
        <div className={`text-xs mt-1 ${trendColorClass(trend)}`}>
          {trendDescription(trend)}
        </div>
      )}
    </div>
  );
}
