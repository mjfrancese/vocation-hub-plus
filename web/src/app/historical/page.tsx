'use client';

import { useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import SearchBar from '@/components/SearchBar';
import {
  categorizeStatus,
  getStatusLabel,
  getStatusStyle,
  StatusCategory,
  ALL_STATUS_CATEGORIES,
  STATUS_CATEGORY_LABELS,
} from '@/lib/status-helpers';

interface Profile {
  vh_id: number;
  profile_url: string;
  diocese: string;
  congregation: string;
  position_type: string;
  status: string;
  order_of_ministry: string;
  geographic_location: string;
  work_environment: string;
  ministry_setting: string;
  avg_sunday_attendance: string;
  annual_budget: string;
  salary_range: string;
  housing_type: string;
  pension: string;
  healthcare: string;
  reimbursement: string;
  vacation: string;
  leadership_skills: string;
  ministry_skills: string;
  languages: string;
  contact_email: string;
  all_fields: Array<{ label: string; value: string }>;
}

import profilesData from '../../../public/data/all-profiles.json';

export default function HistoricalPage() {
  const profiles = useMemo(() => profilesData as unknown as Profile[], []);

  const [query, setQuery] = useState('');
  const [dioceseFilter, setDioceseFilter] = useState('');
  const [settingFilter, setSettingFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusCategory | ''>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const dioceses = useMemo(() => {
    const vals = new Set<string>();
    profiles.forEach(p => { if (p.diocese) vals.add(p.diocese); });
    return Array.from(vals).sort();
  }, [profiles]);

  const settings = useMemo(() => {
    const vals = new Set<string>();
    profiles.forEach(p => { if (p.ministry_setting) vals.add(p.ministry_setting); });
    return Array.from(vals).sort();
  }, [profiles]);

  // Count by status category
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of ALL_STATUS_CATEGORIES) counts[cat] = 0;
    for (const p of profiles) {
      const cat = categorizeStatus(p.status);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [profiles]);

  const fuse = useMemo(() => new Fuse(profiles, {
    keys: [
      { name: 'congregation', weight: 2 },
      { name: 'diocese', weight: 1.5 },
      { name: 'position_type', weight: 1.5 },
      { name: 'salary_range', weight: 1 },
      { name: 'ministry_setting', weight: 1 },
      { name: 'leadership_skills', weight: 1 },
      { name: 'ministry_skills', weight: 1 },
      { name: 'all_fields.value', weight: 0.5 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2,
  }), [profiles]);

  const filtered = useMemo(() => {
    let results = query
      ? fuse.search(query).map(r => r.item)
      : profiles;

    if (dioceseFilter) results = results.filter(p => p.diocese === dioceseFilter);
    if (settingFilter) results = results.filter(p => p.ministry_setting === settingFilter);
    if (statusFilter) results = results.filter(p => categorizeStatus(p.status) === statusFilter);

    return results;
  }, [profiles, fuse, query, dioceseFilter, settingFilter, statusFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">All Positions</h1>
        <p className="text-sm text-gray-500">
          {profiles.length} positions from the Vocation Hub archive
        </p>
      </div>

      {/* Status summary cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {ALL_STATUS_CATEGORIES.filter(cat => statusCounts[cat] > 0).map(cat => (
          <button
            key={cat}
            onClick={() => setStatusFilter(statusFilter === cat ? '' : cat)}
            className={`rounded-lg p-3 text-center border transition-all ${
              statusFilter === cat
                ? getStatusStyle(cat) + ' ring-2 ring-offset-1 ring-primary-500'
                : statusFilter
                  ? 'bg-gray-50 text-gray-400 border-gray-100'
                  : getStatusStyle(cat)
            }`}
          >
            <p className="text-xl font-bold">{statusCounts[cat]}</p>
            <p className="text-xs">{getStatusLabel(cat)}</p>
          </button>
        ))}
      </div>

      <SearchBar
        value={query}
        onChange={setQuery}
        resultCount={query || dioceseFilter || settingFilter || statusFilter ? filtered.length : undefined}
      />

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-500 mb-1">Diocese</label>
          <select
            value={dioceseFilter}
            onChange={e => setDioceseFilter(e.target.value)}
            className="w-48 py-2 px-3 border border-gray-300 rounded-md text-sm bg-white"
          >
            <option value="">All ({dioceses.length})</option>
            {dioceses.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-500 mb-1">Setting</label>
          <select
            value={settingFilter}
            onChange={e => setSettingFilter(e.target.value)}
            className="w-40 py-2 px-3 border border-gray-300 rounded-md text-sm bg-white"
          >
            <option value="">All</option>
            {settings.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {(dioceseFilter || settingFilter || statusFilter) && (
          <button
            onClick={() => { setDioceseFilter(''); setSettingFilter(''); setStatusFilter(''); }}
            className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Clear
          </button>
        )}
        <span className="text-sm text-gray-500 ml-auto">
          {filtered.length} of {profiles.length} positions
        </span>
      </div>

      {/* Results table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Congregation</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Diocese</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Position</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Salary</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ASA</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filtered.slice(0, 100).map(p => {
              const cat = categorizeStatus(p.status);
              return (
                <>
                  <tr
                    key={p.vh_id}
                    onClick={() => setExpandedId(expandedId === p.vh_id ? null : p.vh_id)}
                    className={`hover:bg-gray-50 cursor-pointer ${cat === 'filled' || cat === 'closed' ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {p.congregation || '(unnamed)'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.diocese}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.position_type}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{p.salary_range || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {p.avg_sunday_attendance && p.avg_sunday_attendance !== '0' ? p.avg_sunday_attendance : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusStyle(cat)}`}>
                        {p.status || 'Unknown'}
                      </span>
                    </td>
                  </tr>
                  {expandedId === p.vh_id && (
                    <tr key={`${p.vh_id}-detail`}>
                      <td colSpan={6} className="px-4 py-4 bg-gray-50">
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            {p.salary_range && <Field label="Compensation" value={p.salary_range} />}
                            {p.housing_type && <Field label="Housing" value={p.housing_type} />}
                            {p.annual_budget && p.annual_budget !== '0' && (
                              <Field label="Annual Budget" value={`$${Number(p.annual_budget).toLocaleString()}`} />
                            )}
                            {p.avg_sunday_attendance && p.avg_sunday_attendance !== '0' && (
                              <Field label="Avg Sunday Attendance" value={p.avg_sunday_attendance} />
                            )}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            {p.ministry_setting && <Field label="Setting" value={p.ministry_setting} />}
                            {p.work_environment && <Field label="Work Environment" value={p.work_environment} />}
                            {p.geographic_location && <Field label="Region" value={p.geographic_location} />}
                            {p.order_of_ministry && <Field label="Orders" value={p.order_of_ministry} />}
                          </div>
                          {(p.pension || p.healthcare || p.vacation) && (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                              {p.pension && <Field label="Pension" value={p.pension} />}
                              {p.healthcare && <Field label="Healthcare" value={p.healthcare} />}
                              {p.vacation && <Field label="Vacation" value={p.vacation} />}
                            </div>
                          )}
                          {(p.leadership_skills || p.ministry_skills) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              {p.leadership_skills && <Field label="Leadership Skills" value={p.leadership_skills} />}
                              {p.ministry_skills && <Field label="Ministry Skills" value={p.ministry_skills} />}
                            </div>
                          )}
                          <div className="flex gap-4 text-sm">
                            <a
                              href={p.profile_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary-600 hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              View on Vocation Hub
                            </a>
                          </div>
                          <details className="text-sm">
                            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                              All {p.all_fields.length} fields
                            </summary>
                            <div className="mt-2 space-y-2 pl-4 border-l-2 border-gray-200">
                              {p.all_fields.map((f, i) => (
                                <div key={i}>
                                  <span className="font-medium text-gray-500">{f.label || `Field ${i + 1}`}</span>
                                  <p className="text-gray-900 whitespace-pre-line">
                                    {f.value.length > 300 ? f.value.substring(0, 300) + '...' : f.value}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > 100 && (
        <p className="text-sm text-gray-500 text-center">
          Showing first 100 of {filtered.length} results. Use search or filters to narrow down.
        </p>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-medium text-gray-500">{label}</span>
      <p className="text-gray-900">{value}</p>
    </div>
  );
}
