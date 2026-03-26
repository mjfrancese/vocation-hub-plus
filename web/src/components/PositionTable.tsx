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
                  <StatusBadge status={pos.status} />
                </td>
              </tr>
              {expandedId === pos.id && (
                <tr key={`${pos.id}-detail`}>
                  <td colSpan={7} className="px-4 py-4 bg-gray-50">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <DetailField label="Organization Type" value={pos.organization_type} />
                        <DetailField label="Full/Part Time" value={pos.full_part_time} />
                        <DetailField label="First Seen" value={pos.first_seen} />
                        <DetailField label="Last Seen" value={pos.last_seen} />
                      </div>

                      {/* Compensation and Housing */}
                      {(pos.minimum_stipend || pos.maximum_stipend || pos.housing_type) && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <DetailField label="Stipend Range" value={
                            pos.minimum_stipend && pos.maximum_stipend
                              ? `${pos.minimum_stipend} - ${pos.maximum_stipend}`
                              : pos.minimum_stipend || pos.maximum_stipend
                          } />
                          <DetailField label="Housing" value={pos.housing_type} />
                          <DetailField label="Worship Style" value={pos.worship_style} />
                          <DetailField label="Avg Sunday Attendance" value={pos.avg_sunday_attendance} />
                        </div>
                      )}

                      {/* Location */}
                      {(pos.city || pos.state_province) && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <DetailField label="City" value={pos.city} />
                          <DetailField label="State" value={pos.state_province} />
                          <DetailField label="Contact" value={pos.contact_name} />
                          <DetailField label="Email" value={pos.contact_email} />
                        </div>
                      )}

                      {/* Description */}
                      {pos.position_description && (
                        <div className="text-sm">
                          <span className="font-medium text-gray-500">Position Description</span>
                          <p className="text-gray-900 mt-1 whitespace-pre-line">
                            {pos.position_description}
                          </p>
                        </div>
                      )}

                      {/* Skills and Community */}
                      {pos.desired_skills && (
                        <div className="text-sm">
                          <span className="font-medium text-gray-500">Desired Skills</span>
                          <p className="text-gray-900 mt-1 whitespace-pre-line">{pos.desired_skills}</p>
                        </div>
                      )}

                      {pos.community_description && (
                        <div className="text-sm">
                          <span className="font-medium text-gray-500">Community Description</span>
                          <p className="text-gray-900 mt-1 whitespace-pre-line">{pos.community_description}</p>
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
                    </div>
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

function DetailField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="font-medium text-gray-500">{label}</span>
      <p className="text-gray-900">{value}</p>
    </div>
  );
}
