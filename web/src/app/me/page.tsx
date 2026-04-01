'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { PersonalData, Position } from '@/lib/types';
import CompensationRadar from '@/components/CompensationRadar';
import CareerTimeline from '@/components/CareerTimeline';
import { ME_TOKEN_KEY } from '@/lib/constants';

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [userData, setUserData] = useState<PersonalData | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'compensation' | 'career' | 'positions'>('compensation');

  useEffect(() => {
    const urlToken = searchParams.get('me');
    const savedToken = localStorage.getItem(ME_TOKEN_KEY);
    const token = urlToken || savedToken;

    if (!token) {
      router.push('/claim');
      return;
    }

    // Save token to localStorage if from URL
    if (urlToken) {
      localStorage.setItem(ME_TOKEN_KEY, urlToken);
    }

    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    Promise.all([
      fetch(`${base}/data/clergy-tokens.json`).then(r => r.json()),
      fetch(`${base}/data/enriched-positions.json`).then(r => r.json()),
    ]).then(([tokenMap, posData]) => {
      const data = tokenMap[token];
      if (!data) {
        localStorage.removeItem(ME_TOKEN_KEY);
        router.push('/claim');
        return;
      }
      setUserData(data);
      setPositions(posData);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [searchParams, router]);

  // Recommended positions: scored and sorted
  const recommended = useMemo(() => {
    if (!userData || !positions.length) return [];

    return positions
      .filter(p => p.status !== 'Closed' && p.status !== 'Expired')
      .map(p => {
        let score = 0;
        // Same position type or progression
        const userType = userData.current_position?.title?.toLowerCase() || '';
        const posType = (p.position_type || '').toLowerCase();
        if (userType && posType && userType === posType) score += 3;
        else if (posType === 'rector' && (userType.includes('assoc') || userType.includes('assistant') || userType.includes('vicar'))) score += 2;

        // Similar ASA (within 50%)
        if (userData.current_parish?.asa && p.avg_sunday_attendance) {
          const posAsa = parseInt(String(p.avg_sunday_attendance), 10);
          if (posAsa > 0 && userData.current_parish.asa > 0) {
            const ratio = posAsa / userData.current_parish.asa;
            if (ratio >= 0.5 && ratio <= 1.5) score += 2;
          }
        }

        // Same or adjacent state
        if (userData.current_position?.state && p.state) {
          if (userData.current_position.state === p.state) score += 2;
        }

        // Diocese previously served
        if (p.diocese && userData.positions.some(up => up.diocese?.toLowerCase() === p.diocese?.toLowerCase())) {
          score += 1;
        }

        return { position: p, score };
      })
      .filter(r => r.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }, [userData, positions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-gray-500">Loading your dashboard...</p>
      </div>
    );
  }

  if (!userData) return null;

  const cb = userData.compensation_benchmarks;

  return (
    <div className="max-w-4xl mx-auto py-6">
      {/* Summary Bar */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <h1 className="text-xl font-bold text-gray-900">{userData.name}</h1>
        {userData.current_position && (
          <p className="text-gray-600">
            {userData.current_position.title}, {userData.current_position.parish}
            {userData.current_position.diocese ? ` \u00b7 Diocese of ${userData.current_position.diocese}` : ''}
          </p>
        )}
        <div className="flex flex-wrap gap-6 mt-3">
          {cb?.diocese_median != null && (
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">${Math.round(cb.diocese_median / 1000)}K</div>
              <div className="text-xs text-gray-500">Diocese Median</div>
            </div>
          )}
          {userData.ordination_year && (
            <div className="text-center">
              <div className="text-lg font-bold text-amber-600">{userData.ordination_year}</div>
              <div className="text-xs text-gray-500">Ordained</div>
            </div>
          )}
          {userData.experience_years != null && (
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">{userData.experience_years} yrs</div>
              <div className="text-xs text-gray-500">Experience</div>
            </div>
          )}
          {userData.current_parish?.asa != null && (
            <div className="text-center">
              <div className="text-lg font-bold text-purple-600">{userData.current_parish.asa}</div>
              <div className="text-xs text-gray-500">Parish ASA</div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {(['compensation', 'career', 'positions'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'compensation' ? 'Compensation' : tab === 'career' ? 'Career' : 'Positions'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'compensation' && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Compensation Benchmark</h2>
          <CompensationRadar benchmarks={userData.compensation_benchmarks} />
        </div>
      )}

      {activeTab === 'career' && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Career Timeline</h2>
          <CareerTimeline positions={userData.positions} ordinationYear={userData.ordination_year} />
        </div>
      )}

      {activeTab === 'positions' && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Recommended Positions ({recommended.length})
          </h2>
          {recommended.length === 0 ? (
            <p className="text-gray-500">No positions match your profile right now. Check back later.</p>
          ) : (
            <div className="space-y-3">
              {recommended.map(({ position: p, score }) => (
                <a
                  key={p.id}
                  href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/?me=${searchParams.get('me') || localStorage.getItem(ME_TOKEN_KEY)}#${p.id}`}
                  className="block border border-gray-200 rounded-lg p-3 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-gray-900">{p.name}</h3>
                      <p className="text-sm text-gray-600">{p.diocese}{p.state ? `, ${p.state}` : ''}</p>
                      {p.position_type && <p className="text-xs text-gray-500">{p.position_type}</p>}
                    </div>
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded font-medium">
                      {score} match points
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><p className="text-gray-500">Loading...</p></div>}>
      <DashboardContent />
    </Suspense>
  );
}
