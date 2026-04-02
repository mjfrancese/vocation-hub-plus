'use client';

import { Position } from '@/lib/types';
import { findField } from '@/lib/narrative-helpers';

interface ProfileTabProps {
  pos: Position;
}

// Field groups with the labels to search for and display names
const FIELD_GROUPS: Array<{
  title: string;
  fields: Array<{ display: string; keywords: string[] }>;
}> = [
  {
    title: 'Position Details',
    fields: [
      { display: 'Position Type', keywords: ['Position Type', 'Type'] },
      { display: 'Diocese', keywords: ['Diocese'] },
      { display: 'Congregation', keywords: ['Congregation', 'Community Name'] },
      { display: 'Position Title/Role', keywords: ['Position Title', 'Role'] },
      { display: 'Type of Work', keywords: ['Full Time', 'Part Time', 'Full-Time'] },
      { display: 'Orders Required', keywords: ['Order', 'Ministry'] },
      { display: 'Current Status', keywords: ['Status'] },
      { display: 'Avg Sunday Attendance', keywords: ['Average Sunday', 'Attendance', 'ASA'] },
      { display: 'Annual Budget', keywords: ['Annual Budget', 'Budget'] },
    ],
  },
  {
    title: 'Description',
    fields: [
      { display: 'Position Description', keywords: ['hopes for this position', 'qualities', 'Description'] },
    ],
  },
  {
    title: 'How to Apply',
    fields: [
      { display: 'Application Instructions', keywords: ['How to Apply', 'Application', 'Submit'] },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { display: 'Contact Name', keywords: ['Contact Name', 'Contact Person'] },
      { display: 'Title', keywords: ['Contact Title'] },
      { display: 'Organization', keywords: ['Organization', 'Contact Organization'] },
      { display: 'Email', keywords: ['Contact Email', 'Email'] },
      { display: 'Phone', keywords: ['Contact Phone', 'Phone'] },
    ],
  },
  {
    title: 'Benefits & Leave',
    fields: [
      { display: 'Compensation Range', keywords: ['Range', 'Stipend', 'Compensation', 'Salary'] },
      { display: 'Housing', keywords: ['Housing'] },
      { display: 'Pension', keywords: ['Pension'] },
      { display: 'Healthcare', keywords: ['Healthcare'] },
      { display: 'Vacation', keywords: ['Vacation'] },
      { display: 'Continuing Education', keywords: ['Continuing Education', 'Education'] },
      { display: 'Travel/Auto', keywords: ['Reimbursement', 'Travel', 'Auto'] },
    ],
  },
  {
    title: 'Dates',
    fields: [
      { display: 'Receiving Names From', keywords: ['Receiving Names'] },
      { display: 'Receiving Names To', keywords: ['Receiving Names To', 'End Date'] },
    ],
  },
];

/**
 * Profile tab: all raw VocationHub deep scrape fields organized into
 * logical groups with a two-column key-value layout.
 */
export default function ProfileTab({ pos }: ProfileTabProps) {
  const fields = pos.deep_scrape_fields || [];

  if (fields.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-6 text-center">
        <p>No detailed profile data available.</p>
        {pos.profile_url && (
          <a
            href={pos.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline mt-1 inline-block"
            onClick={(e) => e.stopPropagation()}
          >
            View on VocationHub for full listing
          </a>
        )}
      </div>
    );
  }

  // Church directory info from enrichment
  const churchInfos = pos.church_infos || [];

  return (
    <div className="space-y-6">
      {FIELD_GROUPS.map(group => {
        const rows = group.fields
          .map(f => ({ label: f.display, value: findField(fields, ...f.keywords) }))
          .filter(r => r.value);

        if (rows.length === 0) return null;

        return (
          <div key={group.title}>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              {group.title}
            </h3>
            <div className="space-y-0">
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 py-1.5 border-b border-gray-100 text-sm">
                  <div className="text-gray-500">{row.label}</div>
                  <div className="col-span-2 text-gray-900 whitespace-pre-line">
                    {isUrl(row.value) ? (
                      <a
                        href={row.value.startsWith('http') ? row.value : `https://${row.value}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-600 underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.value}
                      </a>
                    ) : (
                      row.value.length > 500 ? row.value.substring(0, 500) + '...' : row.value
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Church Directory section */}
      {churchInfos.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Church Directory
          </h3>
          {churchInfos.map((church, i) => (
            <div key={i} className="space-y-0 mb-3">
              {churchInfos.length > 1 && (
                <div className="text-sm font-medium text-gray-700 mb-1">{church.name}</div>
              )}
              {[
                { label: 'Address', value: [church.street, church.city, church.state, church.zip].filter(Boolean).join(', ') },
                { label: 'Phone', value: church.phone },
                { label: 'Email', value: church.email },
                { label: 'Website', value: church.website },
              ].filter(r => r.value).map((row, j) => (
                <div key={j} className="grid grid-cols-3 gap-2 py-1.5 border-b border-gray-100 text-sm">
                  <div className="text-gray-500">{row.label}</div>
                  <div className="col-span-2 text-gray-900">
                    {row.label === 'Website' || row.label === 'Email' ? (
                      <a
                        href={row.label === 'Email' ? `mailto:${row.value}` : (row.value.startsWith('http') ? row.value : `https://${row.value}`)}
                        target={row.label === 'Email' ? undefined : '_blank'}
                        rel="noopener noreferrer"
                        className="text-primary-600 underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.value.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                      </a>
                    ) : row.value}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function isUrl(value: string): boolean {
  return /^https?:\/\//.test(value) || /^www\./.test(value);
}
