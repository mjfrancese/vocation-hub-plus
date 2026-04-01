'use client';

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';
import type { CompBenchmarks } from '@/lib/types';

interface Props {
  benchmarks: CompBenchmarks;
}

function formatDollar(value: number): string {
  return `$${Math.round(value / 1000)}K`;
}

export default function CompensationRadar({ benchmarks }: Props) {
  const data = [
    benchmarks.diocese_median != null ? { axis: 'Diocese Median', value: benchmarks.diocese_median } : null,
    benchmarks.asa_bucket_median != null ? { axis: 'Church Size (ASA)', value: benchmarks.asa_bucket_median } : null,
    benchmarks.position_type_median != null ? { axis: 'Position Type', value: benchmarks.position_type_median } : null,
    benchmarks.experience_bracket_median != null ? { axis: 'Experience', value: benchmarks.experience_bracket_median } : null,
    benchmarks.diocese_female_median != null ? { axis: 'Diocese (Female)', value: benchmarks.diocese_female_median } : null,
    benchmarks.diocese_male_median != null ? { axis: 'Diocese (Male)', value: benchmarks.diocese_male_median } : null,
  ].filter(Boolean) as Array<{ axis: string; value: number }>;

  if (data.length < 3) {
    return (
      <div className="text-sm text-gray-500 py-4">
        Not enough compensation data available for a benchmark chart.
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={350}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid strokeDasharray="3 3" />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 12, fill: '#6b7280' }} />
          <PolarRadiusAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickFormatter={formatDollar} />
          <Tooltip formatter={(value) => typeof value === 'number' ? formatDollar(value) : value} />
          <Radar name="Median Compensation" dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
        </RadarChart>
      </ResponsiveContainer>

      <table className="w-full text-sm mt-4">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-1 text-gray-600 font-medium">Dimension</th>
            <th className="text-right py-1 text-gray-600 font-medium">Median</th>
          </tr>
        </thead>
        <tbody>
          {data.map(d => (
            <tr key={d.axis} className="border-b border-gray-100">
              <td className="py-1 text-gray-700">{d.axis}</td>
              <td className="py-1 text-right text-gray-900 font-medium">{formatDollar(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {benchmarks.year && (
        <p className="text-xs text-gray-400 mt-2">Data from {benchmarks.year} CPG Clergy Compensation Report</p>
      )}
    </div>
  );
}
