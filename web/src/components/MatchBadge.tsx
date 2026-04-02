'use client';

import { useState, useRef } from 'react';
import { MATCH_TIER_STYLES } from '@/lib/match-helpers';
import type { MatchResult } from '@/lib/match-helpers';

interface MatchBadgeProps {
  tier: MatchResult['tier'];
  reasons: string[];
  detailed?: boolean;
}

export default function MatchBadge({ tier, reasons, detailed = true }: MatchBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const badgeRef = useRef<HTMLSpanElement>(null);

  if (tier === 'none') return null;

  const styles = MATCH_TIER_STYLES[tier];

  return (
    <span className="relative inline-block" ref={badgeRef}>
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${styles.bg} ${styles.text} ${detailed && reasons.length > 0 ? 'cursor-help' : ''}`}
        onMouseEnter={() => { if (detailed && reasons.length > 0) setShowTooltip(true); }}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={(e) => { e.stopPropagation(); if (detailed && reasons.length > 0) setShowTooltip(!showTooltip); }}
      >
        {styles.label}
      </span>
      {showTooltip && detailed && reasons.length > 0 && (
        <div
          className="absolute z-50 left-0 top-full mt-1 w-48 p-2 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="font-medium mb-1">Matching criteria:</div>
          <ul className="space-y-0.5">
            {reasons.map((r, i) => (
              <li key={i} className="flex items-center gap-1">
                <span className="text-green-600">{'\u2713'}</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
