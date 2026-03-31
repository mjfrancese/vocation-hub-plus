'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { getStatusStyle, getStatusShortLabel, isActiveStatus } from '@/lib/status-helpers';

// --- Interfaces ---

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

interface GapReport {
  generated_at: string;
  summary: { missing_vh_id: number; missing_church_match: number; total: number };
  gaps: Array<{
    type: string;
    source: string;
    id?: string;
    vh_id?: number;
    name: string;
    diocese: string;
    state?: string;
    receiving_from?: string;
    note: string;
  }>;
}

interface MetaData {
  lastUpdated: string;
  totalPositions: number;
  activeCount: number;
  expiredCount: number;
  newCount: number;
  discoveryStatus?: { pending: number; failed: number; resolved: number };
  lastScrape: {
    scraped_at: string;
    total_found: number;
    duration_ms: number;
    status: string;
  } | null;
}


// --- Auth Gate ---

const AUTH_KEY = 'vhp-admin-auth';
const STORAGE_KEY = 'vhp-manual-mappings';
// Simple hash check -- not a security boundary, just a casual access gate
// for a static site review tool.
function checkAccessCode(input: string): boolean {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return hash === -1077942682;
}

function AccessGate({ onAuth }: { onAuth: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (checkAccessCode(code)) {
      sessionStorage.setItem(AUTH_KEY, 'true');
      onAuth();
    } else {
      setError(true);
      setCode('');
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-8 w-full max-w-sm shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Review Tool Access</h2>
        <p className="text-sm text-gray-500 mb-4">Enter the access code to continue.</p>
        <p className="text-xs text-gray-400 mb-3">This is a review tool access gate, not a security boundary.</p>
        <input
          type="password"
          value={code}
          onChange={e => { setCode(e.target.value); setError(false); }}
          placeholder="Access code"
          className={`w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
            error ? 'border-red-300 bg-red-50' : 'border-gray-300'
          }`}
          autoFocus
        />
        {error && <p className="text-xs text-red-600 mt-1">Incorrect access code</p>}
        <button
          type="submit"
          className="w-full mt-3 px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
        >
          Continue
        </button>
      </form>
    </div>
  );
}

// --- Main Admin Page ---

type ReviewAction = { church_nid: number; church_name: string } | 'non-church' | 'skip';

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(AUTH_KEY) === 'true') {
      setAuthed(true);
    }
  }, []);

  if (!authed) {
    return <AccessGate onAuth={() => setAuthed(true)} />;
  }

  return <AdminDashboard authed={authed} />;
}

function AdminDashboard({ authed }: { authed: boolean }) {
  const [profilesData, setProfiles] = useState<Profile[]>([]);
  const [registryData, setRegistry] = useState<RegistryData | null>(null);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [metaData, setMeta] = useState<MetaData | null>(null);
  const [gapReportData, setGapReport] = useState<GapReport | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<'overview' | 'review'>('overview');

  // Local overrides stored in localStorage
  const [overrides, setOverrides] = useState<Record<string, ReviewAction>>({});

  useEffect(() => {
    if (!authed) return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    Promise.all([
      fetch(`${base}/data/all-profiles.json`).then(r => r.json()),
      fetch(`${base}/data/church-registry.json`).then(r => r.json()).catch(() => ({ churches: {} })),
      fetch(`${base}/data/position-church-map.json`).then(r => r.json()),
      fetch(`${base}/data/meta.json`).then(r => r.json()),
      fetch(`${base}/data/needs-backfill.json`).then(r => r.json()).catch(() => null),
    ]).then(([profiles, registry, map, meta, gaps]) => {
      setProfiles(profiles);
      setRegistry(registry);
      setMapData(map);
      setMeta(meta);
      setGapReport(gaps);
      setDataLoading(false);
    });
  }, [authed]);

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
    if (!mapData) return [];
    const mappings = mapData.mappings;
    const items: Array<{ vhId: string; profile: Profile; mapping: Mapping }> = [];
    for (const [vhId, mapping] of Object.entries(mappings)) {
      if (!mapping.flagged) continue;
      const profile = profilesData.find(p => String(p.vh_id) === vhId);
      if (!profile) continue;
      items.push({ vhId, profile, mapping });
    }
    items.sort((a, b) => {
      const aActive = isActiveStatus(a.profile.status) ? 0 : 1;
      const bActive = isActiveStatus(b.profile.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return a.profile.diocese.localeCompare(b.profile.diocese);
    });
    return items;
  }, [profilesData, mapData]);

  if (dataLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-gray-500">Loading admin data...</p>
      </div>
    );
  }

  const profiles = profilesData;
  const registry = registryData!;
  const positionMap = mapData!;
  const meta = metaData!;
  const gapReport = gapReportData;

  const reviewedCount = Object.keys(overrides).length;
  const assignedCount = Object.values(overrides).filter(v => typeof v === 'object').length;
  const totalMapped = Object.keys(positionMap.mappings).length - flaggedItems.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-sm text-gray-500">Data quality monitoring and manual interventions</p>
        </div>
        <button
          onClick={() => { sessionStorage.removeItem(AUTH_KEY); window.location.reload(); }}
          className="px-3 py-1.5 text-xs text-gray-500 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Sign Out
        </button>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {(['overview', 'review'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'overview' ? 'System Overview' : `Position Review (${flaggedItems.length})`}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' ? (
        <OverviewTab meta={meta} gapReport={gapReport} positionMap={positionMap} totalMapped={totalMapped} assignedCount={assignedCount} />
      ) : (
        <ReviewTab
          flaggedItems={flaggedItems}
          overrides={overrides}
          saveOverrides={saveOverrides}
          registry={registry}
          positionMap={positionMap}
          totalMapped={totalMapped}
          reviewedCount={reviewedCount}
          assignedCount={assignedCount}
        />
      )}
    </div>
  );
}

// --- Overview Tab ---

function OverviewTab({
  meta,
  gapReport,
  positionMap,
  totalMapped,
  assignedCount,
}: {
  meta: MetaData;
  gapReport: GapReport | null;
  positionMap: MapData;
  totalMapped: number;
  assignedCount: number;
}) {
  const discovery = meta.discoveryStatus;
  const missingVhIds = gapReport?.gaps.filter(g => g.type === 'missing_vh_id') || [];
  const missingChurch = gapReport?.gaps.filter(g => g.type === 'missing_church_match') || [];

  return (
    <div className="space-y-6">
      {/* Alert: Positions needing manual intervention */}
      {missingVhIds.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-amber-800">
                {missingVhIds.length} position{missingVhIds.length !== 1 ? 's' : ''} missing VH ID
              </h3>
              <p className="text-sm text-amber-700 mt-1">
                These positions were found in VH search results but the scraper could not retrieve their profile pages.
                They have no detail data, no VH link, and no church match. The backfill system will retry automatically,
                or you can manually add the VH ID.
              </p>
              <div className="mt-3 space-y-2">
                {missingVhIds.map((gap, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="font-medium text-amber-900">{gap.name}</span>
                    <span className="text-amber-600">{gap.diocese}</span>
                    {gap.receiving_from && (
                      <span className="text-amber-500 text-xs">Receiving: {gap.receiving_from}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-amber-600 mt-3">
                To fix manually: search for the position on{' '}
                <a href="https://vocationhub.episcopalchurch.org/PositionSearch" target="_blank" rel="noopener noreferrer" className="underline">
                  Vocation Hub
                </a>
                , click it, copy the VH ID from the URL, and add it to <code className="bg-amber-100 px-1 rounded">manual-vh-ids.json</code>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Discovery Stats */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Discovery & Backfill Status</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Pending Backfill"
            value={discovery?.pending ?? missingVhIds.length}
            color={discovery?.pending || missingVhIds.length > 0 ? 'text-amber-700' : 'text-gray-900'}
            subtitle="Waiting for retry"
          />
          <StatCard
            label="Permanently Failed"
            value={discovery?.failed ?? 0}
            color={discovery?.failed ? 'text-red-700' : 'text-gray-900'}
            subtitle="5+ attempts, needs manual fix"
          />
          <StatCard
            label="Resolved by Backfill"
            value={discovery?.resolved ?? 0}
            color="text-green-700"
            subtitle="Auto-recovered"
          />
          <StatCard
            label="Missing Church Match"
            value={missingChurch.length}
            color={missingChurch.length > 10 ? 'text-amber-700' : 'text-gray-900'}
            subtitle="Has VH ID but no directory data"
          />
        </div>
      </div>

      {/* Last Scrape Info */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Last Scrape</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Status"
            value={meta.lastScrape?.status === 'success' ? 'OK' : (meta.lastScrape?.status || 'N/A')}
            color={meta.lastScrape?.status === 'success' ? 'text-green-700' : 'text-red-700'}
            isText
          />
          <StatCard
            label="Positions Found"
            value={meta.lastScrape?.total_found ?? 0}
          />
          <StatCard
            label="Duration"
            value={meta.lastScrape ? `${(meta.lastScrape.duration_ms / 1000).toFixed(0)}s` : 'N/A'}
            isText
          />
          <StatCard
            label="Last Updated"
            value={meta.lastUpdated ? new Date(meta.lastUpdated).toLocaleDateString() : 'N/A'}
            isText
          />
        </div>
      </div>

      {/* Church Matching Coverage */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Church Matching Coverage</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Positions" value={Object.keys(positionMap.mappings).length} />
          <StatCard label="Auto-matched" value={totalMapped} color="text-green-700" />
          <StatCard label="Manually Assigned" value={assignedCount} color="text-blue-700" />
          <StatCard label="Flagged / Unmatched" value={positionMap.meta.totalFlagged} color="text-amber-700" />
        </div>
        <div className="mt-3 bg-gray-100 rounded-full h-3 overflow-hidden">
          <div
            className="bg-green-500 h-full transition-all"
            style={{ width: `${((totalMapped + assignedCount) / Math.max(Object.keys(positionMap.mappings).length, 1) * 100).toFixed(1)}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {((totalMapped + assignedCount) / Math.max(Object.keys(positionMap.mappings).length, 1) * 100).toFixed(1)}% coverage
          ({totalMapped} auto + {assignedCount} manual of {Object.keys(positionMap.mappings).length})
        </p>
      </div>

      {/* Gap Report Details */}
      {gapReport && missingChurch.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Active Positions Missing Church Data ({missingChurch.length})
          </h2>
          <p className="text-sm text-gray-500 mb-3">
            These positions have a VH ID but could not be matched to a church in the directory.
            They lack address, parochial report, and contact information.
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">VH ID</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Diocese</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {missingChurch.slice(0, 50).map((gap, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-600">
                      {gap.vh_id ? (
                        <a
                          href={`https://vocationhub.episcopalchurch.org/PositionView/${gap.vh_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-600 hover:underline"
                        >
                          {gap.vh_id}
                        </a>
                      ) : 'N/A'}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">{gap.name}</td>
                    <td className="px-3 py-2 text-gray-600">{gap.diocese}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{gap.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {missingChurch.length > 50 && (
              <div className="px-3 py-2 bg-gray-50 text-xs text-gray-500 text-center">
                Showing 50 of {missingChurch.length}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Review Tab (existing position review) ---

function ReviewTab({
  flaggedItems,
  overrides,
  saveOverrides,
  registry,
  positionMap,
  totalMapped,
  reviewedCount,
  assignedCount,
}: {
  flaggedItems: Array<{ vhId: string; profile: Profile; mapping: Mapping }>;
  overrides: Record<string, ReviewAction>;
  saveOverrides: (next: Record<string, ReviewAction>) => void;
  registry: RegistryData;
  positionMap: MapData;
  totalMapped: number;
  reviewedCount: number;
  assignedCount: number;
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'reviewed' | 'has-name'>('all');
  const [dioceseFilter, setDioceseFilter] = useState('');
  const [searchChurch, setSearchChurch] = useState('');
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const nonChurchCount = Object.values(overrides).filter(v => v === 'non-church').length;

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
    saveOverrides({ ...overrides, [vhId]: 'non-church' as const });
    setAssigningId(null);
  }

  function markSkip(vhId: string) {
    saveOverrides({ ...overrides, [vhId]: 'skip' as const });
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

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total Positions" value={Object.keys(positionMap.mappings).length} />
        <StatCard label="Auto-matched" value={totalMapped} color="text-green-700" />
        <StatCard label="Flagged" value={flaggedItems.length} color="text-amber-700" />
        <StatCard label="Reviewed" value={reviewedCount} color="text-blue-700" />
        <StatCard label="Assigned" value={assignedCount} color="text-green-700" />
      </div>

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

// --- Shared Components ---

function StatCard({ label, value, color, subtitle, isText }: {
  label: string;
  value: number | string;
  color?: string;
  subtitle?: string;
  isText?: boolean;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
      <p className={`${isText ? 'text-lg' : 'text-2xl'} font-bold ${color || 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}
