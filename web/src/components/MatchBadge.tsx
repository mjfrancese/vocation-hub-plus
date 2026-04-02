'use client';

import { MATCH_TIER_STYLES } from '@/lib/match-helpers';

interface MatchBadgeProps {
  tier: 'strong' | 'good' | 'partial' | 'none';
  reasons: string[];
  detailed: boolean;
}

export default function MatchBadge({ tier, reasons, detailed }: MatchBadgeProps) {
  if (tier === 'none') return null;

  const style = MATCH_TIER_STYLES[tier];

  return (
    <div className="flex flex-col gap-0.5">
      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.bg} ${style.text} w-fit`}>
        {detailed ? style.label : tier === 'strong' ? 'Strong' : tier === 'good' ? 'Good' : 'Partial'}
      </span>
      {detailed && reasons.length > 0 && (
        <span className="text-[10px] text-gray-500 leading-tight">
          {reasons.join(' \u00b7 ')}
        </span>
      )}
    </div>
  );
}
