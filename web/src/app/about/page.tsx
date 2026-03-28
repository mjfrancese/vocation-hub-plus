'use client';

import { useMemo } from 'react';
import { getPositions } from '@/lib/data';
import { isClosedStatus, isActiveStatus, isDevelopingStatus, isInterimStatus } from '@/lib/status-helpers';

export default function AboutPage() {
  const positions = useMemo(() => getPositions(), []);

  const total = positions.length;
  const receiving = positions.filter(p => isActiveStatus(p.vh_status || '')).length;
  const developing = positions.filter(p => isDevelopingStatus(p.vh_status || '')).length;
  const interim = positions.filter(p => isInterimStatus(p.vh_status || '')).length;
  const closed = positions.filter(p => isClosedStatus(p.vh_status || '')).length;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">About Vocation Hub+</h1>
        <p className="mt-2 text-gray-600">
          An unofficial, enhanced search tool for Episcopal Church clergy and staff positions.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">What is this?</h2>
        <p className="text-gray-600">
          The Episcopal Church maintains a job board called{' '}
          <a
            href="https://vocationhub.episcopalchurch.org/PositionSearch"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:underline"
          >
            Vocation Hub
          </a>{' '}
          where churches and dioceses post open clergy and staff positions. While
          Vocation Hub is a valuable resource, its search interface can be limiting.
          You can only filter by one state or diocese at a time, making it difficult
          to get a full picture of open positions across the country.
        </p>
        <p className="text-gray-600">
          Vocation Hub+ provides a better way to browse those same positions. All
          listings are collected automatically and presented here with full-text
          search, multi-field filtering, and the ability to export results. Whether
          you are a priest exploring a call to a new parish or a vestry member
          researching comparable positions, Vocation Hub+ makes the process easier.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">How it works</h2>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <ol className="list-decimal list-inside space-y-2 text-gray-600">
            <li>An automated process collects position listings and detailed profile data from Vocation Hub</li>
            <li>Each position is enriched with church directory data, parochial reports, and location information</li>
            <li>The results are published here so you can search, filter, and compare positions freely</li>
          </ol>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Features</h2>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <ul className="list-disc list-inside space-y-2 text-gray-600">
            <li>Search across all positions by keyword (name, diocese, position type, and more)</li>
            <li>Filter by state, diocese, position type, compensation, status, and more</li>
            <li>View detailed profile data including compensation, benefits, and community narratives</li>
            <li>Church directory integration with addresses and parochial report trends</li>
            <li>Analytics dashboard with charts on compensation, geography, and attendance</li>
            <li>Quick-filter chips to jump to new, receiving, developing, or closed positions</li>
            <li>Export any filtered view to CSV</li>
            <li>Mobile friendly</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Current Data</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Total Positions" value={total} />
          <StatCard label="Receiving" value={receiving} />
          <StatCard label="Developing" value={developing} />
          <StatCard label="Interim" value={interim} />
          <StatCard label="Closed" value={closed} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Disclaimer</h2>
        <p className="text-gray-600 text-sm">
          Vocation Hub+ is an independent project and is not affiliated with,
          endorsed by, or connected to the Episcopal Church or Vocation Hub.
          All position data originates from the publicly accessible Vocation Hub
          website. For official information, always refer to the{' '}
          <a
            href="https://vocationhub.episcopalchurch.org/PositionSearch"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:underline"
          >
            Episcopal Church Vocation Hub
          </a>
          .
        </p>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}
