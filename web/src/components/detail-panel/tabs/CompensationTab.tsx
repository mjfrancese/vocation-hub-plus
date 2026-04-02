'use client';

import { Position } from '@/lib/types';
import {
  findField,
  isInterimPosition,
  formatDollarFull,
  compToLocalIncomeRatio,
} from '@/lib/narrative-helpers';
import { getCpgDisplayType } from '@/lib/cpg-mapping';

interface CompensationTabProps {
  pos: Position;
}

/**
 * Compensation tab: all compensation and benefits data with diocese context.
 */
export default function CompensationTab({ pos }: CompensationTabProps) {
  const fields = pos.deep_scrape_fields || [];
  const isInterim = isInterimPosition(pos);

  const salary = findField(fields, 'Range', 'Stipend', 'Compensation', 'Salary');
  const housing = findField(fields, 'Housing');
  const budget = findField(fields, 'Annual Budget', 'Budget');
  const order = findField(fields, 'Order', 'Ministry');

  const pension = findField(fields, 'Pension');
  const healthcare = findField(fields, 'Healthcare');
  const vacation = findField(fields, 'Vacation');
  const contEd = findField(fields, 'Continuing Education', 'Education');
  const reimbursement = findField(fields, 'Reimbursement', 'Travel', 'Auto');

  const hasBenefits = pension || healthcare || vacation || contEd;

  const comp = pos.compensation;
  const cpgType = pos.cpg_position_type || getCpgDisplayType(pos.position_types || [], pos.parochials?.[0]?.years
    ? (() => {
        const yk = Object.keys(pos.parochials[0].years).sort();
        const latest = pos.parochials[0].years[yk[yk.length - 1]];
        return latest?.averageAttendance ?? null;
      })()
    : null
  );

  const incomeRatio = compToLocalIncomeRatio(pos.estimated_total_comp, pos.census?.median_household_income);

  return (
    <div className="space-y-6">
      {/* Summary Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard
          label="Estimated Total Comp"
          value={pos.estimated_total_comp ? formatDollarFull(pos.estimated_total_comp) : (salary || '--')}
          subtitle={pos.comp_breakdown?.housing ? `Stipend: ${formatDollarFull(pos.comp_breakdown.stipend)} + Housing: ~${formatDollarFull(pos.comp_breakdown.housing)}` : undefined}
          isInterim={isInterim}
        />
        <SummaryCard
          label="Housing"
          value={housing || 'Not specified'}
        />
        <SummaryCard
          label="Annual Budget"
          value={budget ? (isNaN(Number(budget.replace(/[,$]/g, ''))) ? budget : `$${Number(budget.replace(/[,$]/g, '')).toLocaleString()}`) : 'Not specified'}
        />
        <SummaryCard
          label="Orders Required"
          value={order || 'Not specified'}
        />
      </div>

      {/* Benefits Grid */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Benefits
        </h3>
        {hasBenefits ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <BenefitCard label="Pension" value={pension} />
            <BenefitCard label="Healthcare" value={healthcare} />
            <BenefitCard label="Vacation" value={vacation} />
            <BenefitCard label="Continuing Education" value={contEd} />
          </div>
        ) : (
          <p className="text-sm text-gray-500">No detailed benefits data available</p>
        )}
      </div>

      {/* Additional Benefits */}
      {reimbursement && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Additional Benefits
          </h3>
          <div className="text-sm text-gray-700">{reimbursement}</div>
        </div>
      )}

      {/* Diocese Compensation Context */}
      {comp && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Diocese Compensation Context
          </h3>
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
            {/* Position-type-specific benchmark */}
            {comp.position_type_median && comp.position_type_label ? (
              <div>
                <span className="text-gray-600">The diocese median for </span>
                <span className="font-semibold text-primary-900">{comp.position_type_label}s</span>
                <span className="text-gray-600"> is </span>
                <span className="font-semibold text-primary-900">{formatDollarFull(comp.position_type_median)}</span>
                {pos.estimated_total_comp && (
                  <span className={pos.estimated_total_comp >= comp.position_type_median ? 'text-green-600 ml-1' : 'text-amber-600 ml-1'}>
                    ({pos.estimated_total_comp >= comp.position_type_median ? 'Above' : 'Below'} median)
                  </span>
                )}
              </div>
            ) : cpgType ? (
              <div className="text-gray-500 text-xs">
                No position-specific benchmark available for {cpgType}s in this diocese.
              </div>
            ) : null}

            {/* Diocese-wide median */}
            <div>
              <span className="text-gray-600">Diocese-wide median clergy compensation: </span>
              <span className="font-semibold text-primary-900">{formatDollarFull(comp.diocese_median)}</span>
              {pos.estimated_total_comp && (
                <span className={pos.estimated_total_comp >= comp.diocese_median ? 'text-green-600 ml-1' : 'text-amber-600 ml-1'}>
                  ({pos.estimated_total_comp >= comp.diocese_median ? 'Above' : 'Below'} median)
                </span>
              )}
            </div>

            {/* Metadata */}
            <div className="text-xs text-gray-400">
              {comp.year} data | {comp.diocese_clergy_count} clergy in diocese
            </div>
          </div>
        </div>
      )}

      {/* Local income context */}
      {incomeRatio && (
        <div className="text-sm text-gray-600">
          {incomeRatio}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  subtitle,
  isInterim,
}: {
  label: string;
  value: string;
  subtitle?: string;
  isInterim?: boolean;
}) {
  return (
    <div className={`rounded-lg p-3 ${
      isInterim ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'
    }`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-sm font-semibold ${isInterim ? 'text-amber-700' : 'text-gray-900'}`}>
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-gray-400 mt-0.5">{subtitle}</div>
      )}
    </div>
  );
}

function BenefitCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <div className="text-gray-500 text-xs mb-0.5">{label}</div>
      <div className="text-gray-900">{value || 'Not specified'}</div>
    </div>
  );
}
