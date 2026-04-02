'use client';

import { useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

import { Position } from '@/lib/types';

// Fix default marker icons broken by webpack/Next.js bundling
L.Icon.Default.mergeOptions({
  iconUrl: iconUrl.src ?? iconUrl,
  iconRetinaUrl: iconRetinaUrl.src ?? iconRetinaUrl,
  shadowUrl: shadowUrl.src ?? shadowUrl,
});

interface MapViewProps {
  positions: Position[];
  onNavigateToPosition?: (id: string) => void;
}

function buildPopupHtml(pos: Position): string {
  const church = pos.church_infos?.[0];
  const name = church?.name || pos.name || 'Unknown';
  const city = church?.city || pos.city || '';
  const st = church?.state || pos.state || '';
  const type = pos.position_types?.join(', ') || pos.position_type || '';
  const status = pos.visibility === 'public' ? 'Active' : 'Unlisted';
  const statusColor = status === 'Active'
    ? 'background:#dcfce7;color:#15803d'
    : 'background:#dbeafe;color:#1d4ed8';

  // ASA
  const firstParochial = pos.parochials?.[0];
  let asaStr = '';
  if (firstParochial?.years) {
    const years = Object.keys(firstParochial.years).sort();
    const latest = years.length > 0 ? firstParochial.years[years[years.length - 1]] : null;
    if (latest?.averageAttendance != null) {
      asaStr = `ASA: ${latest.averageAttendance}`;
    }
  }

  // Comp
  const compStr = pos.estimated_total_comp
    ? `Comp: $${Math.round(pos.estimated_total_comp / 1000)}k`
    : '';

  const statsLine = [asaStr, compStr].filter(Boolean).join('&nbsp;&nbsp;&nbsp;&nbsp;');

  return `
    <div style="min-width:220px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.4">
      <div style="font-weight:600;font-size:14px;margin-bottom:2px">${name}</div>
      <div style="color:#6b7280;margin-bottom:4px">${type}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:11px;font-weight:500;${statusColor}">${status}</span>
        <span style="color:#6b7280;font-size:12px">${city}${st ? ', ' + st : ''}</span>
      </div>
      ${statsLine ? `<div style="color:#374151;margin-bottom:8px">${statsLine}</div>` : ''}
      <button onclick="window.__vhNavigate && window.__vhNavigate('${pos.id}')"
        style="display:block;width:100%;padding:6px 0;background:#1e40af;color:white;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer">
        View full details
      </button>
    </div>
  `;
}

export default function MapView({ positions, onNavigateToPosition }: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  const mappable = positions.filter(
    (p) => p.church_infos?.[0]?.lat != null && p.church_infos?.[0]?.lng != null
  );

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current).fitBounds([
      [24.5, -125],
      [49.5, -66.5],
    ]);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  // Register navigation callback on window
  useEffect(() => {
    (window as Record<string, unknown>).__vhNavigate = (id: string) => {
      onNavigateToPosition?.(id);
    };
    return () => {
      delete (window as Record<string, unknown>).__vhNavigate;
    };
  }, [onNavigateToPosition]);

  // Update markers when positions change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old cluster group
    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
      clusterRef.current = null;
    }

    const cluster = L.markerClusterGroup();

    for (const pos of mappable) {
      const lat = pos.church_infos![0].lat!;
      const lng = pos.church_infos![0].lng!;
      const marker = L.marker([lat, lng]);
      marker.bindPopup(buildPopupHtml(pos), { maxWidth: 300 });
      marker.addTo(cluster);
    }

    cluster.addTo(map);
    clusterRef.current = cluster;

    if (mappable.length > 0) {
      const bounds = L.latLngBounds(mappable.map(p => {
        const c = p.church_infos?.[0];
        return [c!.lat!, c!.lng!] as [number, number];
      }));
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    } else {
      map.fitBounds([[24.5, -125], [49.5, -66.5]]);
    }
  }, [mappable.length, positions]);

  return (
    <div>
      <p className="text-sm text-gray-500 mb-2">
        {mappable.length} of {positions.length} positions have coordinates
      </p>
      <div
        ref={mapContainerRef}
        style={{ height: '600px' }}
        className="w-full border border-gray-200 rounded-lg"
      />
    </div>
  );
}
