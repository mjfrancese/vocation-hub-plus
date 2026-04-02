'use client';

import { useState, type ReactNode } from 'react';

export interface TabConfig {
  id: string;
  label: string;
  content: ReactNode;
}

interface DetailTabsProps {
  tabs: TabConfig[];
  defaultTab?: string;
}

/**
 * Generic tab bar + content area.
 * Adding a tab = adding a TabConfig entry. The tab bar and content switching
 * are handled here; each tab's content is rendered by its parent.
 */
export default function DetailTabs({ tabs, defaultTab }: DetailTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id || '');

  const active = tabs.find(t => t.id === activeTab) || tabs[0];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={(e) => { e.stopPropagation(); setActiveTab(tab.id); }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab.id === active?.id
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="pt-4">
        {active?.content}
      </div>
    </div>
  );
}
