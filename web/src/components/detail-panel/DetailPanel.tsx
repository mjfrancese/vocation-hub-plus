'use client';

import { useState } from 'react';
import { Position } from '@/lib/types';
import type { PersonalData } from '@/lib/types';
import DetailHeader from './DetailHeader';
import ChurchSelector from './ChurchSelector';
import DetailTabs, { type TabConfig } from './DetailTabs';
import OverviewTab from './tabs/OverviewTab';
import ParishDataTab from './tabs/ParishDataTab';
import CompensationTab from './tabs/CompensationTab';
import ProfileTab from './tabs/ProfileTab';

interface DetailPanelProps {
  pos: Position;
  onNavigate: (id: string) => void;
  meData: PersonalData | null;
}

/**
 * Main detail panel container.
 * Renders sticky header (church name, metadata, church selector, tab bar)
 * and the active tab's content.
 */
export default function DetailPanel({ pos, onNavigate, meData }: DetailPanelProps) {
  const [churchIndex, setChurchIndex] = useState(0);
  const churches = pos.church_infos || [];
  const isMultiChurch = churches.length > 1;

  const tabs: TabConfig[] = [
    {
      id: 'overview',
      label: 'Overview',
      content: <OverviewTab pos={pos} churchIndex={churchIndex} onNavigate={onNavigate} />,
    },
    {
      id: 'parish',
      label: 'Parish Data',
      content: <ParishDataTab pos={pos} churchIndex={churchIndex} />,
    },
    {
      id: 'compensation',
      label: 'Compensation',
      content: <CompensationTab pos={pos} />,
    },
    {
      id: 'profile',
      label: 'Profile',
      content: <ProfileTab pos={pos} />,
    },
  ];

  return (
    <div>
      {/* Sticky header area */}
      <div className="sticky top-0 bg-white z-10 pb-0 -mx-4 px-4 border-b border-gray-100">
        <DetailHeader pos={pos} />
        {isMultiChurch && (
          <ChurchSelector
            churches={churches}
            selectedIndex={churchIndex}
            onSelect={setChurchIndex}
          />
        )}
      </div>

      {/* Tab bar + content */}
      <div className="mt-3">
        <DetailTabs tabs={tabs} defaultTab="overview" />
      </div>
    </div>
  );
}
