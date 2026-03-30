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
}

export default function MapView({ positions }: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  const mappable = positions.filter(
    (p) => p.church_info?.lat != null && p.church_info?.lng != null
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

    for (const p of mappable) {
      const lat = p.church_info!.lat!;
      const lng = p.church_info!.lng!;
      const churchName = p.church_info?.name || p.name;
      const cityState = [p.church_info?.city, p.church_info?.state]
        .filter(Boolean)
        .join(', ');

      const profileLink = p.profile_url
        ? `<a href="${p.profile_url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline">View Profile</a>`
        : '';

      const popup = `
        <div class="text-sm leading-relaxed">
          <div class="font-semibold">${churchName}</div>
          ${cityState ? `<div class="text-gray-600">${cityState}</div>` : ''}
          <div class="text-gray-600">${p.diocese}</div>
          <div class="text-gray-500 text-xs mt-1">${p.position_type}</div>
          ${profileLink ? `<div class="mt-1">${profileLink}</div>` : ''}
        </div>
      `;

      L.marker([lat, lng]).bindPopup(popup).addTo(cluster);
    }

    cluster.addTo(map);
    clusterRef.current = cluster;
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
