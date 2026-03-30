'use client';

import { useState, useRef, useEffect } from 'react';
import { Position } from '@/lib/types';

interface QualityBadgeProps {
  pos: Position;
}

function badgeConfig(pos: Position) {
  const vis = pos.visibility || 'public';
  if (vis === 'public') {
    return {
      label: 'Active Listing',
      className: 'bg-green-100 text-green-800 border-green-200',
      tooltip: "This position appears in the Episcopal Vocation Hub's active search results and is confirmed to be accepting applications.",
    };
  }
  const score = pos.quality_score ?? 0;
  if (vis === 'extended_hidden') {
    return {
      label: `Incomplete \u00B7 ${score}`,
      className: 'bg-gray-100 text-gray-500 border-gray-200',
      tooltip: buildScoreTooltip(score, pos.quality_components),
    };
  }
  return {
    label: `Directory \u00B7 ${score}`,
    className: 'bg-blue-100 text-blue-800 border-blue-200',
    tooltip: buildScoreTooltip(score, pos.quality_components),
  };
}

function buildScoreTooltip(score: number, components?: string[]): string {
  const intro = `Quality score: ${score}/100`;
  const source = "This position was found in the Vocation Hub's profile directory.";
  if (!components || components.length === 0) {
    return `${intro} -- ${source} No scoring criteria met.`;
  }
  return `${intro} -- ${source} Score based on: ${components.join(', ')}.`;
}

export default function QualityBadge({ pos }: QualityBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const config = badgeConfig(pos);

  useEffect(() => {
    if (!showTooltip) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        badgeRef.current && !badgeRef.current.contains(e.target as Node) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target as Node)
      ) {
        setShowTooltip(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTooltip]);

  return (
    <span className="relative inline-block" ref={badgeRef}>
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap cursor-help ${config.className}`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={(e) => { e.stopPropagation(); setShowTooltip(!showTooltip); }}
      >
        {config.label}
      </span>
      {showTooltip && (
        <div
          ref={tooltipRef}
          className="absolute z-50 right-0 top-full mt-1 w-72 p-2.5 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {config.tooltip}
        </div>
      )}
    </span>
  );
}

/** Quality score breakdown for the expanded detail view */
export function QualityScoreDetail({ pos }: { pos: Position }) {
  if (pos.visibility === 'public') return null;

  const score = pos.quality_score ?? 0;
  const earned = pos.quality_components || [];

  const ALL_CRITERIA = [
    'Active status (25)',
    'In-progress status (15)',
    'Recent date (15)',
    'Very recent date (5)',
    'Congregation identified (10)',
    'Position named (5)',
    'Church matched (10)',
    'Parochial data (10)',
    'Position type (5)',
    'State known (5)',
    'Exact match (5)',
    'End date set (5)',
  ];

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white text-sm">
      <div className="font-medium text-gray-700 mb-2">Quality Score: {score}/100</div>
      <div className="space-y-0.5">
        {ALL_CRITERIA.map((criterion) => {
          const met = earned.includes(criterion);
          return (
            <div key={criterion} className={`flex items-center gap-1.5 ${met ? 'text-gray-900' : 'text-gray-400'}`}>
              <span className={met ? 'text-green-600' : 'text-gray-300'}>{met ? '\u2713' : '\u2013'}</span>
              <span>{criterion}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
