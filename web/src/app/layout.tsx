import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vocation Hub+',
  description: 'Nationwide search for Episcopal Church positions',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-14">
              <div className="flex items-center gap-8">
                <Link href="/" className="text-lg font-bold text-primary-700 flex items-center gap-0.5">
                  Vocation Hub
                  <CrossIcon className="w-2.5 h-2.5 text-primary-700 ml-0.5" />
                </Link>
                <div className="hidden sm:flex gap-6">
                  <NavLink href="/">Positions</NavLink>
                  <NavLink href="/analytics/">Analytics</NavLink>
                  <NavLink href="/about/">About</NavLink>
                </div>
              </div>
              <div className="flex items-center sm:hidden">
                <MobileMenu />
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</main>
        <footer className="border-t border-gray-200 mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center text-sm text-gray-500">
            Vocation Hub+ is an unofficial tool. Data sourced from the{' '}
            <a
              href="https://vocationhub.episcopalchurch.org/PositionSearch"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 hover:underline"
            >
              Episcopal Church Vocation Hub
            </a>
            .
          </div>
        </footer>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
    >
      {children}
    </Link>
  );
}

function CrossIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <polygon points="95.1,40.4 95.1,37.5 88.1,37.5 88.1,41.4 58.5,41.4 58.5,11.9 62.5,11.9 62.5,4.9 59.6,4.9 51.7,0 48.7,0 40.4,4.9 37.5,4.9 37.5,11.9 41.4,11.9 41.4,41.4 11.8,41.4 11.8,37.5 4.9,37.5 4.9,40.4 0,48.3 0,51.3 4.9,59.5 4.9,62.5 11.8,62.5 11.8,58.5 41.4,58.5 41.4,88.1 37.5,88.1 37.5,95.1 40.4,95.1 48.3,100 51.3,100 59.5,95.1 62.5,95.1 62.5,88.1 58.5,88.1 58.5,58.5 88.1,58.5 88.1,62.5 95.1,62.5 95.1,59.6 100,51.7 100,48.7 95.1,40.4"/>
    </svg>
  );
}

function MobileMenu() {
  return (
    <details className="relative">
      <summary className="list-none cursor-pointer p-2">
        <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </summary>
      <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-2">
        <Link href="/" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Positions</Link>
        <Link href="/analytics/" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Analytics</Link>
        <Link href="/about/" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">About</Link>
      </div>
    </details>
  );
}
