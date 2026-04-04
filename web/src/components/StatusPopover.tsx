'use client';

import { useState, useRef, useEffect } from 'react';
import { Position } from '@/lib/types';
import { getUnifiedStatus, type UnifiedStatus } from '@/lib/status-helpers';

interface StatusPopoverProps {
  pos: Position;
  children: React.ReactNode;
}

const STATUS_DESCRIPTIONS: Record<UnifiedStatus, string> = {
  Active: "This position appears in VocationHub's active search results and is accepting applications.",
  Developing: 'This position is being developed and may not yet be accepting applications.',
  Closed: 'This position search has been completed or closed.',
};

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

export default function StatusPopover({ pos, children }: StatusPopoverProps) {
  const [show, setShow] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        wrapperRef.current && !wrapperRef.current.contains(e.target as Node) &&
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
      ) {
        setShow(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [show]);

  const unified = getUnifiedStatus(pos.vh_status || pos.status, pos.visibility, pos.quality_score, pos.receiving_names_from);
  const hasScore = pos.visibility === 'extended' || pos.visibility === 'extended_hidden';
  const score = pos.quality_score ?? 0;
  const earned = pos.quality_components || [];

  return (
    <span
      className="relative inline-flex items-center"
      ref={wrapperRef}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => { e.stopPropagation(); setShow(!show); }}
    >
      {children}
      {show && (
        <div
          ref={popoverRef}
          className="absolute z-50 right-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {hasScore ? (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-900">Quality: {score}/100</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                <div
                  className="h-2 rounded-full bg-blue-500"
                  style={{ width: `${score}%` }}
                />
              </div>
              <div className="space-y-0.5">
                {ALL_CRITERIA.map((criterion) => {
                  const met = earned.includes(criterion);
                  return (
                    <div key={criterion} className={`flex items-center gap-1.5 text-xs ${met ? 'text-gray-800' : 'text-gray-400'}`}>
                      <span className={met ? 'text-green-600' : 'text-gray-300'}>{met ? '\u2713' : '\u2013'}</span>
                      <span>{criterion}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-3">
              <div className="text-sm font-semibold text-gray-900 mb-1">{unified}</div>
              <p className="text-xs text-gray-600">{STATUS_DESCRIPTIONS[unified]}</p>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
