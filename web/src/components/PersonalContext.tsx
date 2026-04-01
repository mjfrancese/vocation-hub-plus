'use client';

import { useMemo } from 'react';
import { computeAllComparisons } from '@/lib/personal-context';
import type { PersonalData, Position } from '@/lib/types';

interface Props {
  user: PersonalData;
  position: Position;
}

function formatPct(value: number | null): string | null {
  if (value == null) return null;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatDollarCompact(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return `$${value}`;
}

function formatDistance(km: number): string {
  const miles = Math.round(km * 0.621371);
  if (miles < 50) return `${miles} miles`;
  return `${Math.round(miles / 10) * 10} miles`;
}

interface ContextLine {
  label: string;
  value: string;
  category: 'compensation' | 'parish' | 'geographic' | 'career' | 'people';
}

export default function PersonalContext({ user, position }: Props) {
  const comparisons = useMemo(() => computeAllComparisons(user, position), [user, position]);
  const lines: ContextLine[] = [];

  // Compensation comparisons
  if (comparisons.diocese_median_diff_pct != null) {
    const pct = formatPct(comparisons.diocese_median_diff_pct);
    lines.push({ label: 'Diocese median vs yours', value: pct!, category: 'compensation' });
  }
  if (comparisons.estimated_comp_diff_pct != null) {
    const pct = formatPct(comparisons.estimated_comp_diff_pct);
    lines.push({ label: 'Estimated comp vs yours', value: pct!, category: 'compensation' });
  }

  // Parish comparisons
  if (comparisons.asa_comparison) {
    lines.push({
      label: 'ASA',
      value: `Theirs: ${comparisons.asa_comparison.theirs}, Yours: ${comparisons.asa_comparison.yours}`,
      category: 'parish',
    });
  }
  if (comparisons.plate_pledge_comparison) {
    lines.push({
      label: 'Plate & Pledge',
      value: `Theirs: ${formatDollarCompact(comparisons.plate_pledge_comparison.theirs)}, Yours: ${formatDollarCompact(comparisons.plate_pledge_comparison.yours)}`,
      category: 'parish',
    });
  }
  if (comparisons.membership_comparison) {
    lines.push({
      label: 'Membership',
      value: `Theirs: ${comparisons.membership_comparison.theirs}, Yours: ${comparisons.membership_comparison.yours}`,
      category: 'parish',
    });
  }

  // Geographic
  if (comparisons.distance_km != null) {
    lines.push({ label: 'Distance', value: formatDistance(comparisons.distance_km), category: 'geographic' });
  }
  if (comparisons.relocation) {
    lines.push({ label: 'Relocation', value: comparisons.relocation, category: 'geographic' });
  }
  if (comparisons.cost_of_living_ratio != null) {
    const ratio = comparisons.cost_of_living_ratio;
    const desc = ratio > 1.05 ? 'Higher cost area' : ratio < 0.95 ? 'Lower cost area' : 'Similar cost area';
    lines.push({ label: 'Cost of living', value: `${desc} (${ratio.toFixed(2)}x)`, category: 'geographic' });
  }
  if (comparisons.stipend_to_income_ratio != null) {
    lines.push({ label: 'Stipend-to-local-income', value: `${comparisons.stipend_to_income_ratio.toFixed(2)}x`, category: 'geographic' });
  }

  // Career fit
  if (comparisons.position_type_match) {
    const labels = { same: 'Same role type', progression: 'Career progression', different: 'Different role type' };
    lines.push({ label: 'Position type', value: labels[comparisons.position_type_match], category: 'career' });
  }
  if (comparisons.diocese_familiar) {
    lines.push({ label: 'Diocese familiarity', value: "You've served in this diocese", category: 'career' });
  }
  if (comparisons.years_since_last_move != null) {
    lines.push({ label: 'Current tenure', value: `${comparisons.years_since_last_move} years in current role`, category: 'career' });
  }
  if (comparisons.experience_info) {
    lines.push({ label: 'Experience', value: comparisons.experience_info, category: 'career' });
  }

  if (lines.length === 0) return null;

  const categoryColors: Record<string, string> = {
    compensation: 'bg-emerald-50 border-emerald-200',
    parish: 'bg-sky-50 border-sky-200',
    geographic: 'bg-amber-50 border-amber-200',
    career: 'bg-violet-50 border-violet-200',
    people: 'bg-rose-50 border-rose-200',
  };

  const categoryLabels: Record<string, string> = {
    compensation: 'Compensation',
    parish: 'Parish Profile',
    geographic: 'Geographic',
    career: 'Career Fit',
    people: 'Connections',
  };

  // Group by category
  const grouped = lines.reduce((acc, line) => {
    if (!acc[line.category]) acc[line.category] = [];
    acc[line.category].push(line);
    return acc;
  }, {} as Record<string, ContextLine[]>);

  return (
    <div className="border border-indigo-200 rounded-lg p-3 bg-indigo-50">
      <h4 className="text-sm font-semibold text-indigo-800 mb-2">Personal Context</h4>
      <div className="space-y-2">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className={`rounded p-2 border ${categoryColors[category] || 'bg-gray-50 border-gray-200'}`}>
            <div className="text-xs font-medium text-gray-600 mb-1">{categoryLabels[category] || category}</div>
            {items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm py-0.5">
                <span className="text-gray-600">{item.label}</span>
                <span className="text-gray-900 font-medium">{item.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
