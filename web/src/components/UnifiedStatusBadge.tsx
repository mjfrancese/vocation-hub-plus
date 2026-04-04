'use client';

import { getUnifiedStatus, isInterim, UNIFIED_STATUS_STYLES, type UnifiedStatus } from '@/lib/status-helpers';

interface UnifiedStatusBadgeProps {
  vhStatus?: string;
  visibility?: string;
  qualityScore?: number;
  receivingNamesFrom?: string;
}

export default function UnifiedStatusBadge({ vhStatus, visibility, qualityScore, receivingNamesFrom }: UnifiedStatusBadgeProps) {
  const unified = getUnifiedStatus(vhStatus, visibility, qualityScore, receivingNamesFrom);
  const style = UNIFIED_STATUS_STYLES[unified];
  const interim = isInterim(vhStatus);

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap cursor-help ${style}`}
      >
        {unified}
      </span>
      {interim && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-700 border border-yellow-200 whitespace-nowrap">
          Interim
        </span>
      )}
    </span>
  );
}

export { getUnifiedStatus, type UnifiedStatus };
