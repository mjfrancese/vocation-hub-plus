'use client';

import { Position } from '@/lib/types';
import UnifiedStatusBadge from '../UnifiedStatusBadge';
import { isInterimPosition, timeOnMarket } from '@/lib/narrative-helpers';

interface DetailHeaderProps {
  pos: Position;
}

/**
 * Position header: church name, canonical type pills, status badge,
 * location, date line, and external links.
 */
export default function DetailHeader({ pos }: DetailHeaderProps) {
  const churchName = pos.church_infos?.[0]?.name || pos.name;
  const multiNames = pos.church_infos && pos.church_infos.length > 1
    ? pos.church_infos.map(c => c.name).filter(Boolean)
    : null;
  const displayName = multiNames && multiNames.length > 1
    ? multiNames.join(' & ')
    : churchName;

  const city = pos.church_infos?.[0]?.city || pos.city || '';
  const state = pos.church_infos?.[0]?.state || pos.state || '';
  const location = [city, state].filter(Boolean).join(', ');

  const canonicalTypes = pos.position_types || [];
  const isInterim = isInterimPosition(pos);
  const market = timeOnMarket(pos);

  // Parse receiving dates for display
  const receivingFrom = pos.receiving_names_from
    ? pos.receiving_names_from.split(' to ')[0].split(' - ')[0].trim()
    : '';
  const receivingTo = pos.receiving_names_to || '';
  const endLabel = receivingTo ? receivingTo : 'Open ended';

  const websiteUrl = pos.website_url || pos.church_infos?.[0]?.website || '';
  const normalizedUrl = websiteUrl && !websiteUrl.startsWith('http') ? `https://${websiteUrl}` : websiteUrl;

  return (
    <div className="space-y-1.5">
      {/* Row 1: Church name + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 leading-tight">{displayName}</h2>
        </div>
        <div className="flex-shrink-0">
          <UnifiedStatusBadge vhStatus={pos.vh_status || pos.status} visibility={pos.visibility} />
        </div>
      </div>

      {/* Row 2: Type pills + work type + location + diocese */}
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {canonicalTypes.map(t => (
          <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
            {t}
          </span>
        ))}
        {isInterim && (
          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
            Interim
          </span>
        )}
        {location && (
          <span className="text-gray-500 text-xs">{location}</span>
        )}
        {pos.diocese && (
          <span className="text-gray-400 text-xs">
            {location ? ' \u00B7 ' : ''}{pos.diocese}
          </span>
        )}
      </div>

      {/* Row 3: Date line */}
      {receivingFrom && (
        <div className="text-xs text-gray-500">
          Receiving names since {receivingFrom}
          {' | '}{endLabel}
          {market && <> | Posted {market}</>}
        </div>
      )}

      {/* Row 4: External links */}
      <div className="flex gap-3 text-xs">
        {pos.profile_url && (
          <a
            href={pos.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline"
            onClick={(e) => e.stopPropagation()}
          >
            VocationHub
          </a>
        )}
        {normalizedUrl && (
          <a
            href={normalizedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline"
            onClick={(e) => e.stopPropagation()}
          >
            Church website
          </a>
        )}
      </div>
    </div>
  );
}
