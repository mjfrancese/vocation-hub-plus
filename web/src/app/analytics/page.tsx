'use client';

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { categorizeStatus, getStatusLabel, getStatusStyle, StatusCategory } from '@/lib/status-helpers';
import { DIOCESE_TO_STATE } from '@/lib/diocese-lookup';

interface Profile {
  vh_id: number;
  diocese: string;
  congregation: string;
  position_type: string;
  status: string;
  geographic_location: string;
  ministry_setting: string;
  avg_sunday_attendance: string;
  annual_budget: string;
  salary_range: string;
  housing_type: string;
  healthcare: string;
  all_fields: Array<{ label: string; value: string }>;
}

import profilesData from '../../../public/data/all-profiles.json';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1'];

export default function AnalyticsPage() {
  const profiles = useMemo(() => profilesData as unknown as Profile[], []);
  const [showActive, setShowActive] = useState(false);

  const filtered = useMemo(() => {
    if (!showActive) return profiles;
    return profiles.filter(p => ['Receiving names', 'Reopened'].includes(p.status));
  }, [profiles, showActive]);

  // Status breakdown
  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of filtered) {
      const cat = getStatusLabel(categorizeStatus(p.status));
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Positions by diocese (top 20)
  const dioceseData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of filtered) {
      if (p.diocese) counts[p.diocese] = (counts[p.diocese] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);
  }, [filtered]);

  // Positions by state
  const stateData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of filtered) {
      const state = DIOCESE_TO_STATE[p.diocese] || '';
      if (state) counts[state] = (counts[state] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 25);
  }, [filtered]);

  // Compensation distribution
  const compensationData = useMemo(() => {
    const ranges = [
      '$0 - $25,000',
      '$25,001 - $50,000',
      '$50,001 - $75,000',
      '$75,001 - $100,000',
      '$100,001 - $125,000',
      '$125,001 - $150,000',
      '$150,001 - $175,000',
      '$175,001 - $200,000',
      '$200,001 and above',
    ];
    const counts: Record<string, number> = {};
    for (const r of ranges) counts[r] = 0;

    for (const p of filtered) {
      if (p.salary_range && ranges.includes(p.salary_range)) {
        counts[p.salary_range]++;
      }
    }
    return ranges
      .map(name => ({ name: name.replace('$', '').replace(',000', 'K').replace(',001', 'K'), value: counts[name] }))
      .filter(d => d.value > 0);
  }, [filtered]);

  // Ministry setting
  const settingData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of filtered) {
      if (p.ministry_setting) counts[p.ministry_setting] = (counts[p.ministry_setting] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Region
  const regionData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of filtered) {
      if (p.geographic_location) counts[p.geographic_location] = (counts[p.geographic_location] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Position type breakdown
  const positionTypeData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of filtered) {
      if (p.position_type) counts[p.position_type] = (counts[p.position_type] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Attendance distribution
  const attendanceData = useMemo(() => {
    const buckets = [
      { label: '0-25', min: 0, max: 25 },
      { label: '26-50', min: 26, max: 50 },
      { label: '51-100', min: 51, max: 100 },
      { label: '101-200', min: 101, max: 200 },
      { label: '201-500', min: 201, max: 500 },
      { label: '500+', min: 501, max: 99999 },
    ];
    const counts: Record<string, number> = {};
    for (const b of buckets) counts[b.label] = 0;

    for (const p of filtered) {
      const asa = parseInt(p.avg_sunday_attendance, 10);
      if (!asa || asa === 0) continue;
      for (const b of buckets) {
        if (asa >= b.min && asa <= b.max) {
          counts[b.label]++;
          break;
        }
      }
    }
    return buckets.map(b => ({ name: b.label, value: counts[b.label] })).filter(d => d.value > 0);
  }, [filtered]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Position Analytics</h1>
          <p className="text-sm text-gray-500">
            Data from {filtered.length} positions
            {showActive ? ' (active only)' : ' (all historical)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowActive(false)}
            className={`px-3 py-1.5 text-sm rounded-md ${!showActive ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            All Positions ({profiles.length})
          </button>
          <button
            onClick={() => setShowActive(true)}
            className={`px-3 py-1.5 text-sm rounded-md ${showActive ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Active Only ({profiles.filter(p => ['Receiving names', 'Reopened'].includes(p.status)).length})
          </button>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChartCard title="Position Status">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={statusData} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Compensation Distribution">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={compensationData} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
              <Tooltip />
              <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Diocese and State */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChartCard title="Top 20 Dioceses by Position Count">
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={dioceseData} layout="vertical" margin={{ left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
              <Tooltip />
              <Bar dataKey="value" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Top 25 States by Position Count">
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={stateData} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={40} />
              <Tooltip />
              <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Setting, Region, Position Type */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <ChartCard title="Ministry Setting">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={settingData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                {settingData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Geographic Region">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={regionData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                {regionData.map((_, i) => <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Average Sunday Attendance">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={attendanceData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Position Type */}
      <ChartCard title="Position Types">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={positionTypeData} margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="#ec4899" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}
