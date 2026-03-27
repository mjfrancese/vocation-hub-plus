'use client';

import { useState } from 'react';
import { Position, SortField, SortDirection } from '@/lib/types';
import StatusBadge from './StatusBadge';

interface PositionTableProps {
  positions: Position[];
}

const COLUMNS: Array<{ key: SortField; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'diocese', label: 'Diocese' },
  { key: 'state', label: 'State' },
  { key: 'position_type', label: 'Position' },
  { key: 'receiving_names_from', label: 'Receiving Names' },
  { key: 'updated_on_hub', label: 'Updated' },
];

export default function PositionTable({ positions }: PositionTableProps) {
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = [...positions].sort((a, b) => {
    const aVal = a[sortField] || '';
    const bVal = b[sortField] || '';
    const cmp = aVal.localeCompare(bVal);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function toggleExpand(id: string) {
    setExpandedId(expandedId === id ? null : id);
  }

  if (positions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No positions found</p>
        <p className="text-sm mt-1">Try adjusting your search or filters</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500
                           uppercase tracking-wider cursor-pointer hover:bg-gray-100
                           select-none"
              >
                <span className="flex items-center gap-1">
                  {col.label}
                  {sortField === col.key && (
                    <span className="text-primary-600">
                      {sortDir === 'asc' ? '\u2191' : '\u2193'}
                    </span>
                  )}
                </span>
              </th>
            ))}
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {sorted.map((pos) => (
            <>
              <tr
                key={pos.id}
                onClick={() => toggleExpand(pos.id)}
                className="hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-xs truncate">
                  {pos.name}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{pos.diocese}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{pos.state}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{pos.position_type}</td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {pos.receiving_names_from && (
                    <>
                      {pos.receiving_names_from}
                      {pos.receiving_names_to && ` to ${pos.receiving_names_to}`}
                    </>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{pos.updated_on_hub}</td>
                <td className="px-4 py-3">
                  {pos.visibility === 'extended' ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-purple-100 text-purple-800 border-purple-200">
                      Extended
                    </span>
                  ) : (
                    <StatusBadge status={pos.status} />
                  )}
                </td>
              </tr>
              {expandedId === pos.id && (
                <tr key={`${pos.id}-detail`}>
                  <td colSpan={7} className="px-4 py-4 bg-gray-50">
                    <ExpandedDetail pos={pos} />
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpandedDetail({ pos }: { pos: Position }) {
  const fields = pos.deep_scrape_fields || [];
  const hasDeepData = fields.length > 0;

  // Helper to find a field value by label keyword
  const findField = (...keywords: string[]): string => {
    for (const kw of keywords) {
      const lower = kw.toLowerCase();
      const match = fields.find((f) =>
        f.label.toLowerCase().includes(lower)
      );
      if (match?.value) return match.value;
    }
    return '';
  };

  // Extract key fields from deep scrape data
  const salary = findField('Range', 'Stipend', 'Compensation', 'Salary');
  const housing = findField('Housing');
  const attendance = findField('Average Sunday', 'Attendance', 'ASA');
  const budget = findField('Annual Budget', 'Budget');
  const setting = findField('Ministry Setting', 'Setting');
  const workEnv = findField('Work Environment');
  const geoLocation = findField('Geographic Location');
  const fullPart = findField('Full Time', 'Part Time', 'Full-Time');
  const pension = findField('Pension');
  const healthcare = findField('Healthcare');
  const vacation = findField('Vacation');
  const leadershipSkills = findField('Leadership skills');
  const ministrySkills = findField('Ministry skills');
  const communityHopes = findField('hopes for this position', 'qualities');
  const congregation = findField('Congregation', 'Community Name');
  const order = findField('Order', 'Ministry');
  const reimbursement = findField('Reimbursement');

  if (!hasDeepData) {
    // Fallback to basic detail fields
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <DetailField label="Organization Type" value={pos.organization_type} />
          <DetailField label="Full/Part Time" value={pos.full_part_time} />
          <DetailField label="First Seen" value={pos.first_seen} />
          <DetailField label="Last Seen" value={pos.last_seen} />
        </div>
        {pos.profile_url && (
          <a
            href={pos.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary-600 hover:text-primary-800 underline"
            onClick={(e) => e.stopPropagation()}
          >
            View full profile on Vocation Hub
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Key highlights */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <DetailField label="Compensation" value={salary} highlight />
        <DetailField label="Housing" value={housing} />
        <DetailField label="Avg Sunday Attendance" value={attendance} />
        <DetailField label="Annual Budget" value={budget ? `$${Number(budget).toLocaleString()}` : ''} />
      </div>

      {/* Position details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <DetailField label="Ministry Setting" value={setting} />
        <DetailField label="Work Environment" value={workEnv} />
        <DetailField label="Geographic Location" value={geoLocation} />
        <DetailField label="Orders" value={order} />
      </div>

      {/* Benefits */}
      {(pension || healthcare || vacation || reimbursement) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <DetailField label="Pension" value={pension} />
          <DetailField label="Healthcare" value={healthcare} />
          <DetailField label="Vacation" value={vacation} />
          <DetailField label="Reimbursement" value={reimbursement} />
        </div>
      )}

      {/* Skills */}
      {(leadershipSkills || ministrySkills) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <DetailField label="Leadership Skills" value={leadershipSkills} />
          <DetailField label="Ministry Skills" value={ministrySkills} />
        </div>
      )}

      {/* Narrative / Community hopes */}
      {communityHopes && (
        <div className="text-sm">
          <span className="font-medium text-gray-500">Community Hopes</span>
          <p className="text-gray-900 mt-1 whitespace-pre-line">{communityHopes}</p>
        </div>
      )}

      {/* Links */}
      <div className="flex gap-4 text-sm">
        {pos.profile_url && (
          <a
            href={pos.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline"
            onClick={(e) => e.stopPropagation()}
          >
            View full profile on Vocation Hub
          </a>
        )}
        {pos.website_url && (
          <a
            href={pos.website_url.startsWith('http') ? pos.website_url : `https://${pos.website_url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline"
            onClick={(e) => e.stopPropagation()}
          >
            Church website
          </a>
        )}
      </div>

      {/* All fields (collapsible) */}
      <details className="text-sm">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
          View all {fields.length} profile fields
        </summary>
        <div className="mt-2 space-y-2 pl-4 border-l-2 border-gray-200">
          {fields.map((f, i) => (
            <div key={i}>
              <span className="font-medium text-gray-500">{f.label || `Field ${i + 1}`}</span>
              <p className="text-gray-900 whitespace-pre-line">
                {f.value.length > 500 ? f.value.substring(0, 500) + '...' : f.value}
              </p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function DetailField({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <span className="font-medium text-gray-500">{label}</span>
      <p className={highlight ? 'text-gray-900 font-semibold' : 'text-gray-900'}>{value}</p>
    </div>
  );
}
