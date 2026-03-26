import { getMeta } from '@/lib/data';

export default function AboutPage() {
  const meta = getMeta();

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
          where churches post open clergy and staff positions. The official search interface
          only lets you select one state or diocese at a time from dropdown menus, making
          it tedious to browse positions across the country.
        </p>
        <p className="text-gray-600">
          Vocation Hub+ solves this by automatically scraping all positions and presenting
          them in a modern, searchable interface. You can search across all fields, filter by
          state, diocese, position type, and status, and export results to CSV.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">How it works</h2>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <ol className="list-decimal list-inside space-y-2 text-gray-600">
            <li>A Playwright-based scraper visits Vocation Hub twice daily</li>
            <li>It selects all 50 states and extracts every position listing</li>
            <li>Results are stored in SQLite with full change tracking</li>
            <li>New, updated, and expired positions are automatically detected</li>
            <li>Static JSON files are generated and deployed to this site</li>
          </ol>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Statistics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Positions" value={meta.totalPositions} />
          <StatCard label="Active" value={meta.activeCount} />
          <StatCard label="New" value={meta.newCount} />
          <StatCard label="Expired" value={meta.expiredCount} />
        </div>
        {meta.lastScrape && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Last Scrape</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Time:</span>{' '}
                <span className="text-gray-900">{new Date(meta.lastScrape.scraped_at).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-500">Status:</span>{' '}
                <span className="text-gray-900">{meta.lastScrape.status}</span>
              </div>
              <div>
                <span className="text-gray-500">Found:</span>{' '}
                <span className="text-gray-900">{meta.lastScrape.total_found}</span>
              </div>
              <div>
                <span className="text-gray-500">Duration:</span>{' '}
                <span className="text-gray-900">{(meta.lastScrape.duration_ms / 1000).toFixed(1)}s</span>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Disclaimer</h2>
        <p className="text-gray-600 text-sm">
          This is an unofficial, independently maintained tool. It is not affiliated with,
          endorsed by, or connected to the Episcopal Church or Vocation Hub. All position data
          originates from the publicly available Vocation Hub website. For official information,
          please visit the{' '}
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
