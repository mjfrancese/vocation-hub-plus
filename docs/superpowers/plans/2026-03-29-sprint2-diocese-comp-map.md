# Sprint 2: Diocese Rankings, Compensation & Map View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add diocese-level percentile context, normalized compensation estimates, and a Leaflet map view to Vocation Hub+.

**Architecture:** All new data computations happen in the build-time enrichment pipeline (`enrich-positions.js`), writing to the existing enriched JSON files. The frontend reads these pre-computed values and displays them. The map view is a new component that renders alongside the existing table, toggled by user selection.

**Tech Stack:** Node.js (build scripts), Next.js 14, React 18, TypeScript, Tailwind CSS, Leaflet + react-leaflet + react-leaflet-cluster

---

## File Structure

### Item 4: Diocese Percentile Rankings
- **Modify:** `web/scripts/enrich-positions.js` -- add `computeDiocesePercentiles()` function and attach `diocese_percentiles` to each position
- **Modify:** `web/src/lib/types.ts` -- add `diocese_percentiles` to Position interface
- **Modify:** `web/src/components/PositionTable.tsx` -- add `DioceseContext` component to ExpandedDetail

### Item 5: Compensation Normalization
- **Modify:** `web/scripts/enrich-positions.js` -- add `computeEstimatedTotalComp()` function and attach `estimated_total_comp` to each position
- **Modify:** `web/src/lib/types.ts` -- add `estimated_total_comp` and `comp_breakdown` to Position interface
- **Modify:** `web/src/components/PositionTable.tsx` -- update ExpandedDetail to show comp breakdown, add comp column to table
- **Modify:** `web/src/lib/data.ts` -- pass through `estimated_total_comp` and `comp_breakdown` from enriched data
- **Modify:** `web/src/app/page.tsx` -- update sorting to support estimated_total_comp

### Item 6: Map View
- **Create:** `web/src/components/MapView.tsx` -- Leaflet map with clustered markers and popups
- **Modify:** `web/src/app/page.tsx` -- add Table/Map toggle, conditionally render MapView or PositionTable

---

## Task 1: Diocese Percentile Rankings -- Enrichment Pipeline

**Files:**
- Modify: `web/scripts/enrich-positions.js`

- [ ] **Step 1: Read `enrich-positions.js` and add `computeDiocesePercentiles()` before `main()`**

Add this function after the `load()` helper (after line 47):

```javascript
/**
 * Compute diocese-level percentile rankings for each position that has parochial data.
 * Percentile = fraction of congregations in the same diocese with a LOWER value.
 */
function computeDiocesePercentiles(positions) {
  // Load parochial data directly
  const parochialData = load('parochial-data.json');
  if (!parochialData || !parochialData.congregations) return;

  // Build diocese -> metric arrays from ALL congregations (not just matched positions)
  const dioceseMetrics = {}; // { dioceseName: { asa: [values], platePledge: [values], membership: [values] } }

  for (const cong of parochialData.congregations) {
    const diocese = cong.diocese;
    if (!diocese) continue;

    // Get most recent year with data
    const years = Object.keys(cong.years).sort();
    if (years.length === 0) continue;

    // Find most recent year with at least one non-null metric
    let recentData = null;
    for (let i = years.length - 1; i >= 0; i--) {
      const yd = cong.years[years[i]];
      if (yd.averageAttendance !== null || yd.plateAndPledge !== null || yd.membership !== null) {
        recentData = yd;
        break;
      }
    }
    if (!recentData) continue;

    if (!dioceseMetrics[diocese]) {
      dioceseMetrics[diocese] = { asa: [], platePledge: [], membership: [] };
    }
    if (recentData.averageAttendance !== null && recentData.averageAttendance > 0) {
      dioceseMetrics[diocese].asa.push(recentData.averageAttendance);
    }
    if (recentData.plateAndPledge !== null && recentData.plateAndPledge > 0) {
      dioceseMetrics[diocese].platePledge.push(recentData.plateAndPledge);
    }
    if (recentData.membership !== null && recentData.membership > 0) {
      dioceseMetrics[diocese].membership.push(recentData.membership);
    }
  }

  // Sort each metric array for percentile computation
  for (const diocese of Object.keys(dioceseMetrics)) {
    dioceseMetrics[diocese].asa.sort((a, b) => a - b);
    dioceseMetrics[diocese].platePledge.sort((a, b) => a - b);
    dioceseMetrics[diocese].membership.sort((a, b) => a - b);
  }

  // Helper: compute percentile of a value within a sorted array
  function percentileOf(sortedArr, value) {
    if (sortedArr.length === 0) return null;
    let count = 0;
    for (const v of sortedArr) {
      if (v < value) count++;
      else break;
    }
    return Math.round((count / sortedArr.length) * 100);
  }

  // Attach percentiles to each position that has parochial data and a diocese
  let attached = 0;
  for (const pos of positions) {
    if (!pos.parochial || !pos.diocese) continue;

    const metrics = dioceseMetrics[pos.diocese];
    if (!metrics) continue;

    // Get most recent year of this congregation's data
    const years = Object.keys(pos.parochial.years).sort();
    let recentData = null;
    for (let i = years.length - 1; i >= 0; i--) {
      const yd = pos.parochial.years[years[i]];
      if (yd.averageAttendance !== null || yd.plateAndPledge !== null || yd.membership !== null) {
        recentData = yd;
        break;
      }
    }
    if (!recentData) continue;

    const percentiles = {};
    if (recentData.averageAttendance !== null && recentData.averageAttendance > 0) {
      percentiles.asa = percentileOf(metrics.asa, recentData.averageAttendance);
      percentiles.asa_value = recentData.averageAttendance;
    }
    if (recentData.plateAndPledge !== null && recentData.plateAndPledge > 0) {
      percentiles.plate_pledge = percentileOf(metrics.platePledge, recentData.plateAndPledge);
      percentiles.plate_pledge_value = recentData.plateAndPledge;
    }
    if (recentData.membership !== null && recentData.membership > 0) {
      percentiles.membership = percentileOf(metrics.membership, recentData.membership);
      percentiles.membership_value = recentData.membership;
    }

    if (Object.keys(percentiles).length > 0) {
      pos.diocese_percentiles = percentiles;
      attached++;
    }
  }

  console.log(`  Diocese percentiles: ${attached} positions`);
}
```

- [ ] **Step 2: Call `computeDiocesePercentiles()` in `main()` for both public and extended positions**

In `main()`, after the public positions loop (after line 190, before writing enriched-positions.json), add:

```javascript
  // Compute diocese percentile rankings
  computeDiocesePercentiles(positions);
```

After the extended positions loop (after line 357, before writing enriched-extended.json), add:

```javascript
    // Compute diocese percentile rankings for extended
    computeDiocesePercentiles(extended);
```

- [ ] **Step 3: Verify build compiles**

Run: `cd web && npm run build`
Expected: Build succeeds. Console shows "Diocese percentiles: N positions" for both public and extended.

- [ ] **Step 4: Commit**

```bash
git add web/scripts/enrich-positions.js
git commit -m "feat: compute diocese-level percentile rankings in enrichment pipeline"
```

---

## Task 2: Diocese Percentile Rankings -- Frontend Types & Display

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/data.ts`
- Modify: `web/src/components/PositionTable.tsx`

- [ ] **Step 1: Add `diocese_percentiles` to Position interface in types.ts**

After the `parochial` field (line 79), add:

```typescript
  // Diocese-level percentile rankings (computed at build time)
  diocese_percentiles?: {
    asa?: number;
    asa_value?: number;
    plate_pledge?: number;
    plate_pledge_value?: number;
    membership?: number;
    membership_value?: number;
  };
```

- [ ] **Step 2: Pass through `diocese_percentiles` in data.ts**

In `getPositions()` for extended positions (around line 144), add `diocese_percentiles` to the push object:

```typescript
        diocese_percentiles: e.diocese_percentiles as Position['diocese_percentiles'],
```

(Public positions already spread `...pos` which includes `diocese_percentiles` from enriched JSON.)

- [ ] **Step 3: Add `DioceseContext` component to PositionTable.tsx**

Add this component before `ExpandedDetail`:

```typescript
function DioceseContext({ pos }: { pos: Position }) {
  if (!pos.diocese_percentiles || !pos.diocese) return null;
  const p = pos.diocese_percentiles;
  const diocese = pos.diocese;

  const items: string[] = [];
  if (p.asa !== undefined && p.asa_value !== undefined) {
    items.push(`ASA of ${p.asa_value} \u2014 larger than ${p.asa}% of parishes in the Diocese of ${diocese}`);
  }
  if (p.plate_pledge !== undefined && p.plate_pledge_value !== undefined) {
    const formatted = p.plate_pledge_value >= 1000
      ? `$${Math.round(p.plate_pledge_value / 1000)}k`
      : `$${p.plate_pledge_value.toLocaleString()}`;
    items.push(`Annual giving of ${formatted} \u2014 ${p.plate_pledge}${p.plate_pledge === 1 ? 'st' : p.plate_pledge === 2 ? 'nd' : p.plate_pledge === 3 ? 'rd' : 'th'} percentile in diocese`);
  }
  if (p.membership !== undefined && p.membership_value !== undefined) {
    items.push(`Membership of ${p.membership_value} \u2014 ${p.membership}${p.membership === 1 ? 'st' : p.membership === 2 ? 'nd' : p.membership === 3 ? 'rd' : 'th'} percentile in diocese`);
  }

  if (items.length === 0) return null;

  return (
    <div className="border border-blue-200 rounded-lg p-3 bg-blue-50 text-sm text-blue-800">
      <div className="font-medium text-blue-700 mb-1">Diocese Context</div>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Insert `<DioceseContext>` into both ExpandedDetail branches**

In the `ExpandedDetail` component, in the no-deep-data branch (after `<ParishSnapshot pos={pos} />`):

```tsx
        <DioceseContext pos={pos} />
```

In the has-deep-data branch (after `<ParishSnapshot pos={pos} />`):

```tsx
      <DioceseContext pos={pos} />
```

- [ ] **Step 5: Build and verify**

Run: `cd web && npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/data.ts web/src/components/PositionTable.tsx
git commit -m "feat: display diocese percentile rankings in expanded detail view"
```

---

## Task 3: Compensation Normalization -- Enrichment Pipeline

**Files:**
- Modify: `web/scripts/enrich-positions.js`

- [ ] **Step 1: Add `computeEstimatedTotalComp()` function after `computeDiocesePercentiles()`**

```javascript
/**
 * Parse a stipend string into a number. Returns null if unparseable.
 * Handles: "$50,000", "50000", "$50,000.00", "DOE", "Negotiable", etc.
 */
function parseStipend(str) {
  if (!str || typeof str !== 'string') return null;
  // Skip non-numeric values
  if (/^(DOE|TBD|Negotiable|N\/A|See|Contact|Varies)/i.test(str.trim())) return null;
  // Extract numeric value: strip $, commas, spaces
  const cleaned = str.replace(/[$,\s]/g, '');
  const match = cleaned.match(/^(\d+(\.\d+)?)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return val > 0 ? val : null;
}

/**
 * Compute estimated total compensation for positions with stipend data.
 * Adds estimated_total_comp and comp_breakdown to each position.
 */
function computeEstimatedTotalComp(positions, profileFields) {
  const HOUSING_VALUE = 20000;
  let computed = 0;

  for (const pos of positions) {
    // Try position-level fields first, then deep scrape fields
    let minStipend = parseStipend(pos.minimum_stipend);
    let maxStipend = parseStipend(pos.maximum_stipend);

    // Also check deep scrape / profile fields for stipend data
    const vhId = pos.vh_id;
    const fields = (profileFields && vhId) ? profileFields[String(vhId)] : (pos.deep_scrape_fields || []);
    if (fields && (!minStipend && !maxStipend)) {
      for (const f of (Array.isArray(fields) ? fields : [])) {
        const label = (f.label || '').toLowerCase();
        if (label.includes('minimum') && label.includes('stipend')) {
          minStipend = minStipend || parseStipend(f.value);
        }
        if (label.includes('maximum') && label.includes('stipend')) {
          maxStipend = maxStipend || parseStipend(f.value);
        }
      }
    }

    if (minStipend === null && maxStipend === null) continue;

    // Compute midpoint
    let basePay;
    if (minStipend !== null && maxStipend !== null) {
      basePay = (minStipend + maxStipend) / 2;
    } else {
      basePay = minStipend || maxStipend;
    }

    // Check housing type
    const housingRaw = pos.housing_type || '';
    const housingLower = housingRaw.toLowerCase();
    const hasHousing = housingLower.includes('rectory') ||
      housingLower.includes('housing provided') ||
      housingLower.includes('bed') ||
      housingLower.includes('bath') ||
      (housingLower.includes('required') && !housingLower.includes('no housing'));

    let totalComp = basePay;
    const breakdown = { stipend: Math.round(basePay) };
    if (hasHousing) {
      totalComp += HOUSING_VALUE;
      breakdown.housing = HOUSING_VALUE;
    }

    pos.estimated_total_comp = Math.round(totalComp);
    pos.comp_breakdown = breakdown;
    computed++;
  }

  console.log(`  Estimated total comp: ${computed} positions`);
}
```

- [ ] **Step 2: Call `computeEstimatedTotalComp()` in `main()` for both position sets**

After the `computeDiocesePercentiles(positions)` call (public), add:

```javascript
  computeEstimatedTotalComp(positions, profileFields);
```

After the `computeDiocesePercentiles(extended)` call (extended), add:

```javascript
    computeEstimatedTotalComp(extended, profileFields);
```

- [ ] **Step 3: Build and verify**

Run: `cd web && npm run build`
Expected: Console shows "Estimated total comp: N positions".

- [ ] **Step 4: Commit**

```bash
git add web/scripts/enrich-positions.js
git commit -m "feat: compute estimated total compensation in enrichment pipeline"
```

---

## Task 4: Compensation Normalization -- Frontend Display

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/data.ts`
- Modify: `web/src/components/PositionTable.tsx`
- Modify: `web/src/app/page.tsx`

- [ ] **Step 1: Add types to Position interface in types.ts**

After `diocese_percentiles`, add:

```typescript
  // Estimated total compensation (computed at build time)
  estimated_total_comp?: number;
  comp_breakdown?: {
    stipend: number;
    housing?: number;
  };
```

Add `'estimated_total_comp'` to the `SortField` union type.

- [ ] **Step 2: Pass through comp fields in data.ts for extended positions**

In the `extendedPositions.push()` call, add:

```typescript
        estimated_total_comp: e.estimated_total_comp as number | undefined,
        comp_breakdown: e.comp_breakdown as Position['comp_breakdown'],
```

- [ ] **Step 3: Add Compensation column to PositionTable.tsx**

In the `COLUMNS` array, add after `'position_type'`:

```typescript
  { key: 'estimated_total_comp', label: 'Est. Comp' },
```

Update the sorting logic in the `sorted` computation to handle numeric sorting for `estimated_total_comp`:

```typescript
    if (sortField === 'estimated_total_comp') {
      const aNum = a.estimated_total_comp || 0;
      const bNum = b.estimated_total_comp || 0;
      return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
    }
```

Add the table cell in the desktop table body (after position_type td):

```tsx
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {pos.estimated_total_comp ? (
                      <span title={
                        pos.comp_breakdown
                          ? `Stipend: $${pos.comp_breakdown.stipend.toLocaleString()}${pos.comp_breakdown.housing ? ` + Housing: ~$${pos.comp_breakdown.housing.toLocaleString()}` : ''}`
                          : undefined
                      }>
                        ${pos.estimated_total_comp.toLocaleString()} est.
                      </span>
                    ) : null}
                  </td>
```

Update the `colSpan` in the expanded detail row from `8` to `9`.

Add estimated comp display in the mobile card view (in the flex row with position_type and receiving_names_from):

```tsx
                {pos.estimated_total_comp && (
                  <span className="text-green-700 font-medium">&middot; ${pos.estimated_total_comp.toLocaleString()}</span>
                )}
```

- [ ] **Step 4: Update ExpandedDetail to show compensation breakdown**

In the "Key highlights" grid, update the Compensation DetailField to prefer estimated_total_comp:

```tsx
        <DetailField
          label="Compensation"
          value={
            pos.estimated_total_comp
              ? `$${pos.estimated_total_comp.toLocaleString()} est. total${
                  pos.comp_breakdown?.housing ? ` (Stipend: $${pos.comp_breakdown.stipend.toLocaleString()} + Housing: ~$${pos.comp_breakdown.housing.toLocaleString()})` : ''
                }`
              : salary
          }
          highlight
        />
```

- [ ] **Step 5: Build and verify**

Run: `cd web && npm run build`
Expected: Build succeeds. New column appears in table.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/data.ts web/src/components/PositionTable.tsx web/src/app/page.tsx
git commit -m "feat: display estimated total compensation with breakdown"
```

---

## Task 5: Map View -- Install Dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install Leaflet dependencies**

```bash
cd web && npm install leaflet react-leaflet react-leaflet-cluster && npm install -D @types/leaflet
```

- [ ] **Step 2: Verify install succeeded**

Run: `cd web && npm run build`
Expected: Build still succeeds with new deps.

- [ ] **Step 3: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "feat: install leaflet, react-leaflet, and clustering dependencies"
```

---

## Task 6: Map View -- MapView Component

**Files:**
- Create: `web/src/components/MapView.tsx`

- [ ] **Step 1: Create MapView.tsx**

```tsx
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Position } from '@/lib/types';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icons in webpack/next.js environments
import icon from 'leaflet/dist/images/marker-icon.png';
import icon2x from 'leaflet/dist/images/marker-icon-2x.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

interface MapViewProps {
  positions: Position[];
  onSelectPosition?: (pos: Position) => void;
}

// Continental US bounds
const US_BOUNDS: L.LatLngBoundsExpression = [
  [24.5, -125],
  [49.5, -66.5],
];

export default function MapView({ positions, onSelectPosition }: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  const mappable = useMemo(
    () => positions.filter(p => p.church_info?.lat && p.church_info?.lng),
    [positions],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    // Fix default icon paths
    delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl: typeof icon === 'string' ? icon : (icon as { src: string }).src,
      iconRetinaUrl: typeof icon2x === 'string' ? icon2x : (icon2x as { src: string }).src,
      shadowUrl: typeof iconShadow === 'string' ? iconShadow : (iconShadow as { src: string }).src,
    });

    if (mapRef.current) return; // already initialized

    const map = L.map(containerRef.current).fitBounds(US_BOUNDS);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Dynamic import of markercluster (it references window)
    import('leaflet.markercluster').then(() => {
      // Remove old cluster layer
      if (clusterRef.current) {
        map.removeLayer(clusterRef.current);
      }

      const cluster = L.markerClusterGroup();

      for (const pos of mappable) {
        const lat = pos.church_info!.lat!;
        const lng = pos.church_info!.lng!;
        const name = pos.church_info?.name || pos.name;
        const city = pos.church_info?.city || '';
        const state = pos.church_info?.state || pos.state || '';
        const location = [city, state].filter(Boolean).join(', ');

        const marker = L.marker([lat, lng]);
        marker.bindPopup(`
          <div style="min-width:180px">
            <strong>${name}</strong><br/>
            ${location ? `${location}<br/>` : ''}
            ${pos.diocese ? `Diocese of ${pos.diocese}<br/>` : ''}
            ${pos.position_type ? `<em>${pos.position_type}</em><br/>` : ''}
            ${pos.profile_url ? `<a href="${pos.profile_url}" target="_blank" rel="noopener noreferrer" style="color:#2563eb">View profile</a>` : ''}
          </div>
        `);

        cluster.addLayer(marker);
      }

      map.addLayer(cluster);
      clusterRef.current = cluster;
    });
  }, [mappable]);

  return (
    <div>
      <p className="text-sm text-gray-500 mb-2">
        {mappable.length} of {positions.length} positions have coordinates
      </p>
      <div
        ref={containerRef}
        className="w-full border border-gray-200 rounded-lg"
        style={{ height: '600px' }}
      />
    </div>
  );
}
```

**NOTE:** This uses vanilla Leaflet + leaflet.markercluster instead of react-leaflet wrappers to avoid SSR issues with Next.js. The dynamic import of markercluster ensures it only loads on the client.

- [ ] **Step 2: Install leaflet.markercluster instead of react-leaflet-cluster**

Since we're using vanilla Leaflet for SSR compatibility:

```bash
cd web && npm uninstall react-leaflet react-leaflet-cluster && npm install leaflet.markercluster && npm install -D @types/leaflet.markercluster
```

Update package.json if `@types/leaflet.markercluster` doesn't exist on npm -- in that case, create a type declaration file at `web/src/types/leaflet.markercluster.d.ts`:

```typescript
declare module 'leaflet.markercluster' {
  import * as L from 'leaflet';
  // Augment leaflet namespace
}
```

- [ ] **Step 3: Build and verify component compiles**

Run: `cd web && npm run build`
Expected: Build succeeds.

---

## Task 7: Map View -- Page Integration & Toggle

**Files:**
- Modify: `web/src/app/page.tsx`

- [ ] **Step 1: Add imports and state for view toggle**

Add import at top of page.tsx:

```typescript
import dynamic from 'next/dynamic';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });
```

Add state after the `showNewOnly` state:

```typescript
  const [viewMode, setViewMode] = useState<'table' | 'map'>('table');
```

- [ ] **Step 2: Add toggle button near the top of the page**

In the header area (after the ExportButton div, around line 231), add the toggle:

```tsx
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'map' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Map
            </button>
          </div>
```

- [ ] **Step 3: Conditionally render MapView or PositionTable**

Replace `<PositionTable positions={displayedPositions} />` with:

```tsx
      {viewMode === 'table' ? (
        <PositionTable positions={displayedPositions} />
      ) : (
        <MapView positions={displayedPositions} />
      )}
```

- [ ] **Step 4: Build and verify**

Run: `cd web && npm run build`
Expected: Build succeeds. Both table and map views should work.

- [ ] **Step 5: Commit all map work**

```bash
git add web/src/components/MapView.tsx web/src/app/page.tsx web/package.json web/package-lock.json
git commit -m "feat: add Leaflet map view with marker clustering and table/map toggle"
```

---

## Task 8: Final Verification & Push

- [ ] **Step 1: Full build verification**

```bash
cd web && npm run build
```

Expected: Clean build with no errors.

- [ ] **Step 2: Push to branch**

```bash
git push -u origin claude/explore-church-finder-data-FANHX
```
