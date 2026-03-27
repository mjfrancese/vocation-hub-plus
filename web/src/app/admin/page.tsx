'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { getStatusStyle, getStatusShortLabel, isActiveStatus } from '@/lib/status-helpers';

interface Profile {
  vh_id: number;
  profile_url: string;
  diocese: string;
  congregation: string;
  position_type: string;
  status: string;
  contact_email: string;
  all_fields: Array<{ label: string; value: string }>;
}

interface Mapping {
  church_nid: number | null;
  confidence: string;
  match_method: string;
  flagged: boolean;
}

interface Church {
  nid: number;
  name: string;
  diocese: string;
  city: string;
  state: string;
  type: string;
  street?: string;
  phone?: string;
  email?: string;
  website?: string;
  parochial?: { congregationCity: string; years: Record<string, unknown> } | null;
}

interface RegistryData {
  meta: { totalChurches: number; withParochial: number };
  churches: Record<string, Church>;
}

interface MapData {
  meta: { totalMapped: number; totalFlagged: number; totalPositions: number };
  mappings: Record<string, Mapping>;
}

import profilesData from '../../../public/data/all-profiles.json';
import registryData from '../../../public/data/church-registry.json';
import mapData from '../../../public/data/position-church-map.json';

const STORAGE_KEY = 'vhp-manual-mappings';

type ReviewAction = { church_nid: number; church_name: string } | 'non-church' | 'skip';

export default function AdminPage() {
  const profiles = profilesData as unknown as Profile[];
  const registry = registryData as unknown as RegistryData;
  const positionMap = mapData as unknown as MapData;

  // Local overrides stored in localStorage
  const [overrides, setOverrides] = useState<Record<string, ReviewAction>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setOverrides(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  const saveOverrides = useCallback((next: Record<string, ReviewAction>) => {
    setOverrides(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  // Flagged positions with profile data
  const flaggedItems = useMemo(() => {
    const mappings = positionMap.mappings;
    const items: Array<{ vhId: string; profile: Profile; mapping: Mapping }> = [];
    for (const [vhId, mapping] of Object.entries(mappings)) {
      if (!mapping.flagged) continue;
      const profile = profiles.find(p => String(p.vh_id) === vhId);
      if (!profile) continue;
      items.push({ vhId, profile, mapping });
    }
    // Sort: active statuses first, then by diocese
    items.sort((a, b) => {
      const aActive = isActiveStatus(a.profile.status) ? 0 : 1;
      const bActive = isActiveStatus(b.profile.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return a.profile.diocese.localeCompare(b.profile.diocese);
    });
    return items;
  }, [profiles, positionMap]);

  // Filter state
  const [filter, setFilter] = useState<'all' | 'pending' | 'reviewed' | 'has-name'>('all');
  const [dioceseFilter, setDioceseFilter] = useState('');
  const [searchChurch, setSearchChurch] = useState('');
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const dioceses = useMemo(() => {
    const d = new Set<string>();
    flaggedItems.forEach(item => { if (item.profile.diocese) d.add(item.profile.diocese); });
    return Array.from(d).sort();
  }, [flaggedItems]);

  const filtered = useMemo(() => {
    let items = flaggedItems;
    if (filter === 'pending') items = items.filter(i => !overrides[i.vhId]);
    if (filter === 'reviewed') items = items.filter(i => !!overrides[i.vhId]);
    if (filter === 'has-name') items = items.filter(i => !!i.profile.congregation);
    if (dioceseFilter) items = items.filter(i => i.profile.diocese === dioceseFilter);
    return items;
  }, [flaggedItems, filter, overrides, dioceseFilter]);

  // Church search for assignment
  const churchResults = useMemo(() => {
    if (!searchChurch || searchChurch.length < 2) return [];
    const lower = searchChurch.toLowerCase();
    const churches = Object.values(registry.churches);
    return churches
      .filter(c =>
        c.name.toLowerCase().includes(lower) ||
        c.city?.toLowerCase().includes(lower) ||
        c.diocese.toLowerCase().includes(lower)
      )
      .slice(0, 30);
  }, [searchChurch, registry.churches]);

  function assignChurch(vhId: string, church: Church) {
    const next = { ...overrides, [vhId]: { church_nid: church.nid, church_name: church.name } };
    saveOverrides(next);
    setAssigningId(null);
    setSearchChurch('');
  }

  function markNonChurch(vhId: string) {
    const next = { ...overrides, [vhId]: 'non-church' as const };
    saveOverrides(next);
    setAssigningId(null);
  }

  function markSkip(vhId: string) {
    const next = { ...overrides, [vhId]: 'skip' as const };
    saveOverrides(next);
    setAssigningId(null);
  }

  function clearOverride(vhId: string) {
    const next = { ...overrides };
    delete next[vhId];
    saveOverrides(next);
  }

  function exportMappings() {
    const manual: Record<string, { church_nid: number | null; note?: string }> = {};
    for (const [vhId, action] of Object.entries(overrides)) {
      if (action === 'skip') continue;
      if (action === 'non-church') {
        manual[vhId] = { church_nid: null, note: 'non-church (camp, diocesan office, etc.)' };
      } else {
        manual[vhId] = { church_nid: action.church_nid };
      }
    }
    const blob = new Blob([JSON.stringify(manual, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manual-mappings.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Stats
  const totalMapped = Object.keys(positionMap.mappings).length - flaggedItems.length;
  const reviewedCount = Object.keys(overrides).length;
  const assignedCount = Object.values(overrides).filter(v => typeof v === 'object').length;
  const nonChurchCount = Object.values(overrides).filter(v => v === 'non-church').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin: Position Review</h1>
        <p className="text-sm text-gray-500">
          Review flagged positions that could not be automatically matched to a church
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total Positions" value={Object.keys(positionMap.mappings).length} />
        <StatCard label="Auto-matched" value={totalMapped} color="text-green-700" />
        <StatCard label="Flagged" value={flaggedItems.length} color="text-amber-700" />
        <StatCard label="Reviewed" value={reviewedCount} color="text-blue-700" />
        <StatCard label="Assigned" value={assignedCount} color="text-green-700" />
      </div>

      {/* Coverage bar */}
      <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
        <div
          className="bg-green-500 h-full transition-all"
          style={{ width: `${((totalMapped + assignedCount) / Object.keys(positionMap.mappings).length * 100).toFixed(1)}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 -mt-4">
        {((totalMapped + assignedCount) / Object.keys(positionMap.mappings).length * 100).toFixed(1)}% coverage
        ({totalMapped} auto + {assignedCount} manual of {Object.keys(positionMap.mappings).length})
      </p>

      {/* Filters + Export */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex gap-1">
          {(['all', 'pending', 'reviewed', 'has-name'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm rounded-md ${
                filter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? `All (${flaggedItems.length})`
                : f === 'pending' ? `Pending (${flaggedItems.length - reviewedCount})`
                : f === 'reviewed' ? `Reviewed (${reviewedCount})`
                : `Has Name (${flaggedItems.filter(i => i.profile.congregation).length})`}
            </button>
          ))}
        </div>
        <select
          value={dioceseFilter}
          onChange={e => setDioceseFilter(e.target.value)}
          className="w-48 py-2 px-3 border border-gray-300 rounded-md text-sm bg-white"
        >
          <option value="">All Dioceses</option>
          {dioceses.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          {reviewedCount > 0 && (
            <button
              onClick={exportMappings}
              className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              Export Mappings ({assignedCount + nonChurchCount})
            </button>
          )}
        </div>
      </div>

      {/* Flagged positions list */}
      <div className="space-y-2">
        {filtered.slice(0, 100).map(item => {
          const override = overrides[item.vhId];
          const isAssigning = assigningId === item.vhId;

          return (
            <div
              key={item.vhId}
              className={`border rounded-lg p-4 ${
                override
                  ? typeof override === 'object'
                    ? 'border-green-200 bg-green-50'
                    : override === 'non-church'
                      ? 'border-gray-300 bg-gray-50'
                      : 'border-blue-200 bg-blue-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">
                      {item.profile.congregation || '(no congregation name)'}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusStyle(item.profile.status)}`}>
                      {getStatusShortLabel(item.profile.status)}
                    </span>
                    <span className="text-xs text-gray-400">VH #{item.vhId}</span>
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    {item.profile.diocese && <span>{item.profile.diocese}</span>}
                    {item.profile.position_type && <span> &middot; {item.profile.position_type}</span>}
                    {item.profile.contact_email && <span> &middot; {item.profile.contact_email}</span>}
                  </div>
                  {override && typeof override === 'object' && (
                    <div className="text-sm text-green-700 mt-1 font-medium">
                      Assigned to: {override.church_name} (NID {override.church_nid})
                    </div>
                  )}
                  {override === 'non-church' && (
                    <div className="text-sm text-gray-500 mt-1 italic">Marked as non-church position</div>
                  )}
                  {override === 'skip' && (
                    <div className="text-sm text-blue-600 mt-1 italic">Skipped for now</div>
                  )}
                </div>

                <div className="flex gap-2 shrink-0">
                  {override ? (
                    <button
                      onClick={() => clearOverride(item.vhId)}
                      className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-100"
                    >
                      Undo
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => { setAssigningId(isAssigning ? null : item.vhId); setSearchChurch(''); }}
                        className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded-md hover:bg-primary-700"
                      >
                        Assign
                      </button>
                      <button
                        onClick={() => markNonChurch(item.vhId)}
                        className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-100"
                        title="Not a parish (camp, diocesan office, school, etc.)"
                      >
                        Non-church
                      </button>
                      <button
                        onClick={() => markSkip(item.vhId)}
                        className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-100"
                      >
                        Skip
                      </button>
                      <a
                        href={item.profile.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-100"
                        onClick={e => e.stopPropagation()}
                      >
                        VH
                      </a>
                    </>
                  )}
                </div>
              </div>

              {/* Church search panel */}
              {isAssigning && (
                <div className="mt-3 border-t border-gray-200 pt-3">
                  <input
                    type="text"
                    value={searchChurch}
                    onChange={e => setSearchChurch(e.target.value)}
                    placeholder="Search churches by name, city, or diocese..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    autoFocus
                  />
                  {churchResults.length > 0 && (
                    <div className="mt-2 max-h-60 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                      {churchResults.map(church => (
                        <button
                          key={church.nid}
                          onClick={() => assignChurch(item.vhId, church)}
                          className="w-full text-left px-3 py-2 hover:bg-primary-50 text-sm"
                        >
                          <span className="font-medium">{church.name}</span>
                          <span className="text-gray-500"> &middot; {church.city}, {church.state}</span>
                          <span className="text-gray-400"> &middot; {church.diocese}</span>
                          {church.parochial && (
                            <span className="text-green-600 text-xs ml-1">(has parochial)</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {searchChurch.length >= 2 && churchResults.length === 0 && (
                    <p className="mt-2 text-sm text-gray-500">No churches found</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length > 100 && (
        <p className="text-sm text-gray-500 text-center">
          Showing first 100 of {filtered.length}. Use filters to narrow down.
        </p>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No positions match the current filters</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
      <p className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
