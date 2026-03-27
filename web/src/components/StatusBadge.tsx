'use client';

import { getStatusStyle, getStatusShortLabel } from '@/lib/status-helpers';

interface StatusBadgeProps {
  status: string;
  short?: boolean;
}

export default function StatusBadge({ status, short = true }: StatusBadgeProps) {
  const label = short ? getStatusShortLabel(status) : status;
  const style = getStatusStyle(status);

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${style}`}
      title={status}
    >
      {label}
    </span>
  );
}
