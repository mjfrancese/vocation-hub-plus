'use client';

interface StatusBadgeProps {
  status: 'active' | 'expired' | 'new';
}

const styles: Record<string, string> = {
  new: 'bg-green-100 text-green-800 border-green-200',
  active: 'bg-blue-100 text-blue-800 border-blue-200',
  expired: 'bg-gray-100 text-gray-600 border-gray-200',
};

const labels: Record<string, string> = {
  new: 'NEW',
  active: 'Active',
  expired: 'Expired',
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${styles[status] || styles.active}`}
    >
      {labels[status] || status}
    </span>
  );
}
