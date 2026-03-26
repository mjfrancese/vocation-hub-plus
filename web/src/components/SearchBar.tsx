'use client';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  resultCount?: number;
}

export default function SearchBar({ value, onChange, resultCount }: SearchBarProps) {
  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <svg
          className="h-5 w-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search positions by name, diocese, state, or type..."
        className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg
                   text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2
                   focus:ring-primary-500 focus:border-primary-500 text-base"
      />
      {value && resultCount !== undefined && (
        <div className="absolute inset-y-0 right-0 pr-3 flex items-center text-sm text-gray-500">
          {resultCount} result{resultCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
