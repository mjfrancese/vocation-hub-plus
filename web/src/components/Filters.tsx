'use client';

interface FiltersProps {
  states: string[];
  dioceses: string[];
  positionTypes: string[];
  selectedState: string;
  selectedDiocese: string;
  selectedType: string;
  selectedStatus: string;
  onStateChange: (value: string) => void;
  onDioceseChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onClear: () => void;
}

export default function Filters({
  states,
  dioceses,
  positionTypes,
  selectedState,
  selectedDiocese,
  selectedType,
  selectedStatus,
  onStateChange,
  onDioceseChange,
  onTypeChange,
  onStatusChange,
  onClear,
}: FiltersProps) {
  const hasFilters = selectedState || selectedDiocese || selectedType || selectedStatus;

  return (
    <div className="flex flex-wrap gap-3 items-end">
      <FilterSelect
        label="State"
        value={selectedState}
        options={states}
        onChange={onStateChange}
      />
      <FilterSelect
        label="Diocese"
        value={selectedDiocese}
        options={dioceses}
        onChange={onDioceseChange}
      />
      <FilterSelect
        label="Position Type"
        value={selectedType}
        options={positionTypes}
        onChange={onTypeChange}
      />
      <FilterSelect
        label="Status"
        value={selectedStatus}
        options={['active', 'new', 'expired']}
        onChange={onStatusChange}
      />
      {hasFilters && (
        <button
          onClick={onClear}
          className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900
                     border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col">
      <label className="text-xs font-medium text-gray-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-40 py-2 px-3 border border-gray-300 rounded-md text-sm
                   text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500
                   focus:border-primary-500 bg-white"
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}
