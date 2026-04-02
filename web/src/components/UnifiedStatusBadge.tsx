'use client';

import { getUnifiedStatus, UNIFIED_STATUS_STYLES, type UnifiedStatus } from '@/lib/status-helpers';

interface UnifiedStatusBadgeProps {
  vhStatus?: string;
  visibility?: string;
}

export default function UnifiedStatusBadge({ vhStatus, visibility }: UnifiedStatusBadgeProps) {
  const unified = getUnifiedStatus(vhStatus, visibility);
  const style = UNIFIED_STATUS_STYLES[unified];
  // Show the specific vh_status in the tooltip when available
  const tooltip = vhStatus ? `${unified} -- ${vhStatus}` : unified;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap cursor-default ${style}`}
      title={tooltip}
    >
      {unified}
    </span>
  );
}

export { getUnifiedStatus, type UnifiedStatus };
