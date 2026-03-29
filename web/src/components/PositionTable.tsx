'use client';

import { Fragment, useState } from 'react';
import { Position, SortField, SortDirection } from '@/lib/types';
import StatusBadge from './StatusBadge';
import ParochialTrends from './ParochialTrends';
import { isGibberish } from '@/lib/gibberish-detector';

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
    // Date fields: parse various formats to compare chronologically
    if (sortField === 'receiving_names_from' || sortField === 'updated_on_hub') {
      const parseDate = (s: string) => {
        if (!s) return 0;
        // Handle range like "02/18/2026 to 03/31/2026" - use first date
        const first = s.split(' to ')[0].trim();

        // MM/DD/YYYY format
        const mdy = first.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2])).getTime();

        // "Today, HH:MM AM/PM" format
        if (first.startsWith('Today')) {
          const now = new Date();
          const timeMatch = first.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
          if (timeMatch) {
            let h = parseInt(timeMatch[1]);
            const m = parseInt(timeMatch[2]);
            if (timeMatch[3].toUpperCase() === 'PM' && h !== 12) h += 12;
            if (timeMatch[3].toUpperCase() === 'AM' && h === 12) h = 0;
            return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
          }
          return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        }

        // "Yesterday, HH:MM AM/PM" format
        if (first.startsWith('Yesterday')) {
          const now = new Date();
          return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
        }

        // "Month DD" format (no year - assume current year)
        const monthDay = first.match(/^([A-Z][a-z]+)\s+(\d{1,2})$/);
        if (monthDay) {
          const months: Record<string, number> = {
            January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
            July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
          };
          const mo = months[monthDay[1]];
          if (mo !== undefined) {
            return new Date(new Date().getFullYear(), mo, parseInt(monthDay[2])).getTime();
          }
        }

        // "Month DD, YYYY" format
        const monthDayYear = first.match(/^([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
        if (monthDayYear) {
          const months: Record<string, number> = {
            January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
            July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
          };
          const mo = months[monthDayYear[1]];
          if (mo !== undefined) {
            return new Date(parseInt(monthDayYear[3]), mo, parseInt(monthDayYear[2])).getTime();
          }
        }

        // Try native Date parsing as last resort
        const d = new Date(first);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };
      const aTime = parseDate(aVal);
      const bTime = parseDate(bVal);
      const cmp = aTime - bTime;
      return sortDir === 'asc' ? cmp : -cmp;
    }
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
    <>
      {/* Mobile: card layout */}
      <div className="sm:hidden space-y-2">
        {/* Mobile sort control */}
        <div className="flex items-center gap-2 text-sm text-gray-500 px-1">
          <span>Sort by</span>
          <select
            value={sortField}
            onChange={(e) => { setSortField(e.target.value as SortField); setSortDir('asc'); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
          >
            {COLUMNS.map(col => (
              <option key={col.key} value={col.key}>{col.label}</option>
            ))}
          </select>
          <button
            onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
            className="text-primary-600 font-medium"
          >
            {sortDir === 'asc' ? '\u2191' : '\u2193'}
          </button>
        </div>

        {sorted.map((pos) => (
          <div key={pos.id}>
            <div
              onClick={() => toggleExpand(pos.id)}
              className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                expandedId === pos.id
                  ? 'bg-primary-50 border-l-4 border-l-primary-500 border-primary-200'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 text-sm leading-tight">{pos.name}</p>
                  <p className="text-xs text-gray-500 mt-1">{pos.diocese} &middot; {pos.state}</p>
                </div>
                {pos.vh_status ? (
                  <StatusBadge status={pos.vh_status} />
                ) : (
                  <StatusBadge status={pos.status === 'new' ? 'Receiving names' : pos.status} />
                )}
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                {pos.position_type && <span>{pos.position_type}</span>}
                {pos.receiving_names_from && (
                  <span>&middot; {pos.receiving_names_from}</span>
                )}
              </div>
            </div>
            {expandedId === pos.id && (
              <div className="border border-t-0 border-primary-200 rounded-b-lg p-3 bg-primary-50/40 border-l-4 border-l-primary-500">
                <ExpandedDetail pos={pos} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop: table layout */}
      <div className="hidden sm:block overflow-x-auto border border-gray-200 rounded-lg">
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
              <Fragment key={pos.id}>
                <tr
                  onClick={() => toggleExpand(pos.id)}
                  className={`cursor-pointer transition-colors ${
                    expandedId === pos.id
                      ? 'bg-primary-50 border-l-4 border-l-primary-500'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-xs truncate">
                    {pos.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{pos.diocese}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{pos.state}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{pos.position_type}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {pos.receiving_names_from ? (
                      <>
                        {pos.receiving_names_from}
                        {pos.receiving_names_to && pos.receiving_names_to !== 'Open ended' && ` to ${pos.receiving_names_to}`}
                      </>
                    ) : pos.vh_status ? (
                      <span className="text-gray-400 italic">{pos.vh_status}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{pos.updated_on_hub}</td>
                  <td className="px-4 py-3">
                    {pos.vh_status ? (
                      <StatusBadge status={pos.vh_status} />
                    ) : (
                      <StatusBadge status={pos.status === 'new' ? 'Receiving names' : pos.status} />
                    )}
                  </td>
                </tr>
                {expandedId === pos.id && (
                  <tr key={`${pos.id}-detail`}>
                    <td colSpan={7} className="px-4 py-4 bg-primary-50/40 border-l-4 border-l-primary-500">
                      <ExpandedDetail pos={pos} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ExpandedDetail({ pos }: { pos: Position }) {
  const fields = pos.deep_scrape_fields || [];
  const hasDeepData = fields.length > 0;

  // Parochial data is pre-computed at build time (attached to position)
  const hasParochial = !!pos.parochial && Object.keys(pos.parochial.years).length > 0;

  // Helper to find a field value by label keyword (skip gibberish)
  const findField = (...keywords: string[]): string => {
    for (const kw of keywords) {
      const lower = kw.toLowerCase();
      const match = fields.find((f) =>
        f.label.toLowerCase().includes(lower) && !isGibberish(f.value)
      );
      if (match?.value) return match.value;
    }
    return '';
  };

  // Filter out gibberish fields for display
  const cleanFields = fields.filter(f => !isGibberish(f.value));

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
        {hasParochial && <ParochialTrends data={pos.parochial!} />}
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

      {/* Parochial Report Trends */}
      {hasParochial && <ParochialTrends data={pos.parochial!} />}

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

      {/* Church directory info */}
      {pos.church_info && (
        <div className="border border-gray-200 rounded-lg p-3 bg-white text-sm">
          <div className="font-medium text-gray-700 mb-2">Church Directory</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {pos.church_info.street && (
              <div>
                <span className="text-gray-500">Address</span>
                <p className="text-gray-900">{pos.church_info.street}, {pos.church_info.city}, {pos.church_info.state} {pos.church_info.zip}</p>
              </div>
            )}
            {pos.church_info.phone && (
              <div>
                <span className="text-gray-500">Phone</span>
                <p className="text-gray-900">{pos.church_info.phone}</p>
              </div>
            )}
            {pos.church_info.email && (
              <div>
                <span className="text-gray-500">Email</span>
                <p className="text-gray-900">{pos.church_info.email}</p>
              </div>
            )}
          </div>
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
        {(pos.website_url || pos.church_info?.website) && (
          <a
            href={(() => {
              const url = pos.website_url || pos.church_info?.website || '';
              return url.startsWith('http') ? url : `https://${url}`;
            })()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline"
            onClick={(e) => e.stopPropagation()}
          >
            Church website
          </a>
        )}
      </div>

      {/* All fields (collapsible, gibberish filtered) */}
      <details className="text-sm">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
          View all {cleanFields.length} profile fields
        </summary>
        <div className="mt-2 space-y-2 pl-4 border-l-2 border-gray-200">
          {cleanFields.map((f, i) => (
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
