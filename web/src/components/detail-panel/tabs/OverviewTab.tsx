'use client';

import { useState } from 'react';
import { Position } from '@/lib/types';
import {
  extractParochialMetrics,
  trendDescription,
  trendColorClass,
  givingPerAttendeeDescription,
  formatDollar,
  formatDollarFull,
  isInterimPosition,
  findField,
  timeOnMarket,
  compToLocalIncomeRatio,
  diocesePercentileDescription,
} from '@/lib/narrative-helpers';

interface OverviewTabProps {
  pos: Position;
  churchIndex: number;
  onNavigate: (id: string) => void;
}

type SimilarSort = 'best' | 'size' | 'nearby' | 'comp' | 'type';

const SIMILAR_SORT_OPTIONS: Array<{ value: SimilarSort; label: string }> = [
  { value: 'best', label: 'Best match' },
  { value: 'size', label: 'Similar size' },
  { value: 'nearby', label: 'Nearby' },
  { value: 'comp', label: 'Similar comp' },
  { value: 'type', label: 'Same type' },
];

const MATCH_REASON_LABELS: Record<string, string> = {
  asa: 'Similar size',
  comp: 'Similar comp',
  state: 'Same state',
  type: 'Same type',
  housing: 'Same housing',
};

/**
 * Overview tab: the integrated narrative view that synthesizes data
 * from all sources into priest-relevant insights.
 */
export default function OverviewTab({ pos, churchIndex, onNavigate }: OverviewTabProps) {
  const [similarSort, setSimilarSort] = useState<SimilarSort>('best');
  const metrics = extractParochialMetrics(pos, churchIndex);
  const fields = pos.deep_scrape_fields || [];
  const isInterim = isInterimPosition(pos);
  const dp = pos.diocese_percentiles;

  return (
    <div className="space-y-6">
      {/* At-a-Glance Metrics */}
      <AtAGlanceRow pos={pos} metrics={metrics} isInterim={isInterim} />

      {/* Parish Health */}
      <NarrativeSection pos={pos} metrics={metrics} dp={dp} />

      {/* Clergy Stability */}
      <ClergyStability pos={pos} fields={fields} isInterim={isInterim} />

      {/* What They're Looking For */}
      <WhatTheyWant fields={fields} />

      {/* Search Timeline */}
      <SearchTimeline pos={pos} />

      {/* Church & Community */}
      <ChurchCommunity pos={pos} churchIndex={churchIndex} />

      {/* Similar Positions */}
      <SimilarPositionsSection
        pos={pos}
        sort={similarSort}
        onSortChange={setSimilarSort}
        onNavigate={onNavigate}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// At-a-Glance Metrics Row
// ---------------------------------------------------------------------------

function AtAGlanceRow({
  pos,
  metrics,
  isInterim,
}: {
  pos: Position;
  metrics: ReturnType<typeof extractParochialMetrics>;
  isInterim: boolean;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Compensation */}
      <div className={`rounded-lg p-3 ${isInterim ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}>
        <div className="text-xs text-gray-500">Compensation</div>
        <div className={`text-lg font-semibold ${isInterim ? 'text-amber-700' : 'text-gray-900'}`}>
          {pos.estimated_total_comp
            ? formatDollar(pos.estimated_total_comp)
            : isInterim
              ? 'Interim Position'
              : '--'}
        </div>
        {pos.comp_breakdown?.housing ? (
          <div className="text-xs text-gray-400">Includes housing</div>
        ) : pos.estimated_total_comp ? (
          <div className="text-xs text-gray-400">Stipend only</div>
        ) : null}
      </div>

      {/* ASA */}
      <div className="bg-gray-50 rounded-lg p-3">
        <div className="text-xs text-gray-500">Avg Sunday Attendance</div>
        <div className="text-lg font-semibold text-gray-900">
          {metrics.latestAsa ?? '--'}
        </div>
        {metrics.asaTrend && (
          <div className={`text-xs ${trendColorClass(metrics.asaTrend)}`}>
            {trendDescription(metrics.asaTrend)}
          </div>
        )}
      </div>

      {/* Annual Giving */}
      <div className="bg-gray-50 rounded-lg p-3">
        <div className="text-xs text-gray-500">Annual Giving</div>
        <div className="text-lg font-semibold text-gray-900">
          {metrics.latestPlatePledge != null ? formatDollar(metrics.latestPlatePledge) : '--'}
        </div>
        {metrics.givingTrend && (
          <div className={`text-xs ${trendColorClass(metrics.givingTrend)}`}>
            {trendDescription(metrics.givingTrend)}
          </div>
        )}
      </div>

      {/* Giving per Attendee */}
      <div className="bg-gray-50 rounded-lg p-3">
        <div className="text-xs text-gray-500">Giving per Attendee</div>
        <div className="text-lg font-semibold text-gray-900">
          {metrics.givingPerAttendee != null ? formatDollar(metrics.givingPerAttendee) : '--'}
        </div>
        <div className="text-xs text-gray-400">Annual plate & pledge / ASA</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parish Health Narrative
// ---------------------------------------------------------------------------

function NarrativeSection({
  pos,
  metrics,
  dp,
}: {
  pos: Position;
  metrics: ReturnType<typeof extractParochialMetrics>;
  dp: Position['diocese_percentiles'];
}) {
  const hasAnyData = metrics.latestAsa != null || metrics.latestPlatePledge != null;
  if (!hasAnyData) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Parish Health
      </h3>
      <div className="text-sm text-gray-700 space-y-1.5">
        {/* ASA */}
        {metrics.latestAsa != null && (
          <p>
            Average Sunday attendance is{' '}
            <span className="font-semibold text-primary-900">{metrics.latestAsa}</span>
            {metrics.asaTrend && (
              <span className={trendColorClass(metrics.asaTrend)}>
                {', '}{trendDescription(metrics.asaTrend)}
              </span>
            )}
            {dp?.asa != null && (
              <span className="text-gray-500">
                {' '}- larger than {dp.asa}% of parishes in the diocese
              </span>
            )}
            .
          </p>
        )}

        {/* Giving */}
        {metrics.latestPlatePledge != null && (
          <p>
            Annual plate and pledge giving is{' '}
            <span className="font-semibold text-primary-900">
              {formatDollarFull(metrics.latestPlatePledge)}
            </span>
            {metrics.givingTrend && (
              <span className={trendColorClass(metrics.givingTrend)}>
                {', '}{trendDescription(metrics.givingTrend)}
              </span>
            )}
            {dp?.plate_pledge != null && (
              <span className="text-gray-500">
                {' '}- {dp.plate_pledge}th percentile in the diocese
              </span>
            )}
            .
            {/* Contextualize against attendance trend */}
            {metrics.asaTrend && metrics.givingTrend &&
              metrics.asaTrend.direction !== metrics.givingTrend.direction &&
              metrics.asaTrend.direction !== 'flat' && metrics.givingTrend.direction !== 'flat' && (
              <span className="text-gray-500">
                {' '}Giving has moved in the opposite direction from attendance.
              </span>
            )}
          </p>
        )}

        {/* Giving per attendee */}
        {metrics.givingPerAttendee != null && (
          <p>
            That works out to{' '}
            <span className="font-semibold text-primary-900">
              {formatDollarFull(metrics.givingPerAttendee)}
            </span>
            {' '}per attendee in annual giving, a signal of congregational commitment.
          </p>
        )}

        {/* Membership */}
        {metrics.latestMembership != null && (
          <p>
            Membership is{' '}
            <span className="font-semibold text-primary-900">
              {metrics.latestMembership.toLocaleString()}
            </span>
            {metrics.latestMembershipYear && metrics.latestMembershipYear !== metrics.latestAsaYear && (
              <span className="text-gray-400"> (as of {metrics.latestMembershipYear})</span>
            )}
            {metrics.membershipTrend && (
              <span className={trendColorClass(metrics.membershipTrend)}>
                {', '}{trendDescription(metrics.membershipTrend)}
              </span>
            )}
            .
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clergy Stability
// ---------------------------------------------------------------------------

function ClergyStability({
  pos,
  fields,
  isInterim,
}: {
  pos: Position;
  fields: Array<{ label: string; value: string }>;
  isInterim: boolean;
}) {
  const hasClergyData = pos.current_clergy || pos.parish_clergy_history;
  const order = findField(fields, 'Order', 'Ministry');

  if (!hasClergyData && !order) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Clergy Stability
      </h3>
      <div className="text-sm text-gray-700 space-y-1.5">
        {pos.current_clergy && (
          <p>
            Current clergy: <span className="font-semibold text-primary-900">{pos.current_clergy.name}</span>
            {pos.current_clergy.position_title && ` (${pos.current_clergy.position_title})`}
            {pos.current_clergy.years_tenure > 0 && `, ${pos.current_clergy.years_tenure} years`}
            .
          </p>
        )}
        {pos.parish_clergy_history && pos.parish_clergy_history.avg_tenure_years > 0 && (
          <p>
            Over the past decade, this parish has had{' '}
            <span className="font-semibold text-primary-900">{pos.parish_clergy_history.recent_count}</span>
            {' '}clergy with an average tenure of{' '}
            <span className="font-semibold text-primary-900">{pos.parish_clergy_history.avg_tenure_years} years</span>.
          </p>
        )}
        {isInterim && (
          <p>
            <span className="inline-flex items-center px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
              Interim
            </span>
            <span className="ml-1">This is an interim position.</span>
          </p>
        )}
        {order && (
          <p>Orders required: <span className="font-semibold text-primary-900">{order}</span></p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// What They're Looking For
// ---------------------------------------------------------------------------

function WhatTheyWant({ fields }: { fields: Array<{ label: string; value: string }> }) {
  const communityHopes = findField(fields, 'hopes for this position', 'qualities');
  const description = findField(fields, 'Description');
  const desiredSkills = findField(fields, 'Leadership skills', 'Ministry skills');
  const howToApply = findField(fields, 'How to Apply', 'Application', 'Submit');
  const contactName = findField(fields, 'Contact Name', 'Contact Person');
  const contactTitle = findField(fields, 'Contact Title');
  const contactEmail = findField(fields, 'Contact Email', 'Email');

  if (!communityHopes && !description && !desiredSkills && !howToApply && !contactName) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        What They&apos;re Looking For
      </h3>
      <div className="text-sm text-gray-700 space-y-2">
        {(communityHopes || description) && (
          <p className="whitespace-pre-line">
            {communityHopes || description}
          </p>
        )}
        {desiredSkills && (
          <p>
            <span className="text-gray-500">Desired skills: </span>
            {desiredSkills}
          </p>
        )}
        {howToApply && (
          <p>
            <span className="text-gray-500">How to apply: </span>
            {howToApply}
          </p>
        )}
        {contactName && (
          <p>
            <span className="text-gray-500">Contact: </span>
            {contactName}
            {contactTitle && `, ${contactTitle}`}
            {contactEmail && (
              <>
                {' - '}
                <a
                  href={`mailto:${contactEmail}`}
                  className="text-primary-600 underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {contactEmail}
                </a>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search Timeline
// ---------------------------------------------------------------------------

function SearchTimeline({ pos }: { pos: Position }) {
  const receivingFrom = pos.receiving_names_from
    ? pos.receiving_names_from.split(' to ')[0].split(' - ')[0].trim()
    : '';
  const receivingTo = pos.receiving_names_to || '';
  const market = timeOnMarket(pos);

  if (!receivingFrom && !market) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Search Timeline
      </h3>
      <div className="text-sm text-gray-700 space-y-1">
        {receivingFrom && <p>Receiving names since <span className="font-semibold text-primary-900">{receivingFrom}</span></p>}
        <p>{receivingTo ? `End date: ${receivingTo}` : 'Open-ended search'}</p>
        {market && <p>Time on market: <span className="font-semibold text-primary-900">{market}</span></p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Church & Community
// ---------------------------------------------------------------------------

function ChurchCommunity({ pos, churchIndex }: { pos: Position; churchIndex: number }) {
  const church = pos.church_infos?.[churchIndex];
  const census = pos.census;
  const fields = pos.deep_scrape_fields || [];
  const setting = findField(fields, 'Ministry Setting', 'Setting');
  const incomeRatio = compToLocalIncomeRatio(pos.estimated_total_comp, census?.median_household_income);

  if (!church && !census && !setting) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Church & Community
      </h3>
      <div className="text-sm text-gray-700 space-y-1.5">
        {church?.street && (
          <p>
            {church.street}, {church.city}, {church.state} {church.zip}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {church?.website && (
            <a
              href={church.website.startsWith('http') ? church.website : `https://${church.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 underline text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              {church.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          )}
          {church?.email && (
            <a href={`mailto:${church.email}`} className="text-primary-600 underline text-xs" onClick={(e) => e.stopPropagation()}>
              {church.email}
            </a>
          )}
          {church?.phone && (
            <span className="text-xs text-gray-500">{church.phone}</span>
          )}
        </div>
        {setting && <p>Ministry setting: <span className="font-semibold text-primary-900">{setting}</span></p>}
        {census?.median_household_income != null && (
          <p>
            Area median household income:{' '}
            <span className="font-semibold text-primary-900">
              {formatDollarFull(census.median_household_income)}
            </span>
          </p>
        )}
        {census?.population != null && (
          <p>Area population: <span className="font-semibold text-primary-900">{census.population.toLocaleString()}</span></p>
        )}
        {incomeRatio && <p className="text-gray-500">{incomeRatio}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Similar Positions
// ---------------------------------------------------------------------------

function SimilarPositionsSection({
  pos,
  sort,
  onSortChange,
  onNavigate,
}: {
  pos: Position;
  sort: SimilarSort;
  onSortChange: (s: SimilarSort) => void;
  onNavigate: (id: string) => void;
}) {
  const candidates = pos.similar_positions;
  if (!candidates || candidates.length === 0) return null;

  // Sort candidates based on selected criterion
  const sorted = [...candidates].sort((a, b) => {
    if (sort === 'best') return b.score - a.score;

    // For other sorts: give +10 weight to the selected criterion, then composite score as tiebreaker
    const weight = (item: typeof a): number => {
      const reasons = item.match_reasons;
      if (!reasons) return item.score;
      let bonus = 0;
      if (sort === 'size' && reasons.asa) bonus = 10;
      if (sort === 'nearby' && reasons.state) bonus = 10;
      if (sort === 'comp' && reasons.comp) bonus = 10;
      if (sort === 'type' && reasons.type) bonus = 10;
      return bonus + item.score;
    };

    return weight(b) - weight(a);
  });

  const displayed = sorted.slice(0, 3);

  return (
    <div className="border-t border-gray-200 pt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Similar Positions
        </h3>
        <select
          value={sort}
          onChange={(e) => { e.stopPropagation(); onSortChange(e.target.value as SimilarSort); }}
          onClick={(e) => e.stopPropagation()}
          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-600"
        >
          {SIMILAR_SORT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {displayed.map(sim => (
          <button
            key={sim.id}
            onClick={(e) => { e.stopPropagation(); onNavigate(sim.id); }}
            className="text-left border border-gray-200 rounded-lg p-3 bg-white hover:bg-gray-50 transition-colors"
          >
            <div className="font-medium text-gray-900 text-sm truncate">{sim.name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {sim.city && <>{sim.city}, </>}{sim.state}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{sim.position_type}</div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              {sim.asa != null && <span>ASA {sim.asa}</span>}
              {sim.estimated_total_comp != null && (
                <span className="text-green-700">{formatDollar(sim.estimated_total_comp)}</span>
              )}
            </div>

            {/* Match reason tags */}
            {sim.match_reasons && (
              <div className="flex flex-wrap gap-1 mt-2">
                {Object.entries(sim.match_reasons)
                  .filter(([, v]) => v)
                  .map(([key]) => (
                    <span
                      key={key}
                      className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]"
                    >
                      {MATCH_REASON_LABELS[key] || key}
                    </span>
                  ))
                }
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
