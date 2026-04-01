# Multi-Congregation Position Support

**Date:** 2026-04-01
**Status:** Approved

## Problem

Vocation Hub+ has positions where a single clergy person serves 2+ churches (multi-point calls). Currently the enrichment pipeline matches only the first parish found and discards the rest. This means users see incomplete data for these positions.

Current data:
- 3 `CongregationMP` positions in public data (matched to only 1 parish each)
- 1 "and"-separated position typed as `Congregation` ("Trinity and Old Swedes (Wilmington)")
- 10 newline-separated positions in extended data (e.g., "St Paul (Virginia City)\nTrinity (Ennis)")

## Design Decisions

1. **Always-array data model** -- `church_info` and `parish_context` become `church_infos: ChurchInfo[]` and `parish_contexts: ParishContext[]`. Single-parish positions get 1-element arrays. No backward-compat shims; all consumers updated at once.

2. **Show what we have** -- Display parish context for matched parishes even if not all constituent parishes could be matched. Note unmatched ones (e.g., "Data not available for 1 congregation").

3. **Always attempt parsing** -- Do not gate multi-parish parsing on `organization_type`. Always try splitting on `\n` and ` and `, then validate by checking if split parts produce more DB matches than the unsplit name. Falls back to unsplit match if splitting doesn't help. This maximizes match coverage.

4. **Combined name in row, side-by-side in detail** -- Collapsed row shows combined church names ("Trinity Torrington & Trinity Lime Rock"). Expanded detail shows parish context/church directory in a 2-column grid that collapses to 1 column on mobile.

5. **2-column grid for all counts** -- 3+ parishes use standard grid flow; the last card sits alone in the left column. No special layout for odd counts.

## Data Model Changes

### types.ts

Remove singular fields, add arrays:

```typescript
// Remove:
church_info?: { ... };
parish_context?: ParishContext;

// Add:
church_infos?: ChurchInfo[];
parish_contexts?: ParishContext[];
```

The `parochial` field also becomes an array since it's per-parish:

```typescript
// Remove:
parochial?: { ... };

// Add:
parochials?: ParochialData[];  // parallel with church_infos
```

ChurchInfo becomes a named interface (currently inline):

```typescript
export interface ChurchInfo {
  nid?: number;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  website: string;
  type: string;
  lat: number | null;
  lng: number | null;
}
```

ParishContext interface unchanged.

## Enrichment Script Changes

### New function: `matchPositionToParishes(position)`

Orchestrator that wraps existing `matchPositionToParish()`:

1. **Split name into candidate parts:**
   - Split on `\n` first (unambiguous delimiter)
   - Then split each part on ` and `
   - Each part carries its own city hint from parentheses

2. **Match each part independently** using `matchPositionToParish()`, passing a synthetic position object with the original diocese, contact info, etc.

3. **Compare split vs unsplit results:**
   - If splitting produced more distinct matched parishes (by ID), use the split results
   - Otherwise fall back to the unsplit match
   - Deduplicate by parish ID

4. **Build arrays:** For each matched parish, call `buildChurchInfo()` and `computeParishContext()`. Return `{ church_infos: [...], parish_contexts: [...] }`.

5. **Logging:** Log when splitting changes the match result for audit purposes.

### Output changes

The enrichment pipeline outputs arrays instead of singular fields:
- `pos.church_infos = [buildChurchInfo(parish1), buildChurchInfo(parish2)]`
- `pos.parish_contexts = [computeParishContext(parish1.id), computeParishContext(parish2.id)]`

Single-parish positions produce 1-element arrays.

## Frontend Changes

### PositionTable.tsx

**Collapsed row:**
- `getChurchName()` joins names from `church_infos` array with " & "
- `getCity()` joins distinct cities with " & "
- `getState()` takes first state (they'll be the same diocese)
- ASA displays the first parish's value (not combined)

**Expanded detail (ExpandedDetail component):**
- If `parish_contexts.length > 1`, show header: "This position serves N congregations"
- Parish context and church directory render in a 2-column CSS grid
- Mobile breakpoint collapses to 1 column
- If some parishes unmatched, show "Data not available for N congregation(s)"

### ParishContextSection.tsx

Updated props:
```typescript
interface Props {
  contexts: ParishContext[];
  churchNames?: string[];  // parallel array for labeling each block
}
```

- Array length 1: renders exactly as today (no visual change)
- Array length > 1: renders grid of cards, each with parish name header

### ParochialTrends component

Updated to accept an array of parochial data. When multiple parishes, renders one chart/section per parish within the same grid layout as parish context.

### Shared sections unchanged

Compensation, diocese percentiles, census, similar positions, skills, community hopes remain at the position level.

## Additional Fix

**`/claim` page 404:** `IdentityLink.tsx` links to `/claim` but `trailingSlash: true` is configured. Change to `/claim/`.

## Non-Goals

- Combined/averaged parish metrics (just show side by side)
- Changes to similar positions algorithm
- Changes to comparison modal
- Changes to personal context (clergy claim) flow
- Multi-parish detection in the scraper itself

## Risks

The "and"-splitting heuristic could match a wrong parish if a name fragment happens to match something in the same diocese. Mitigated by: only using split results when they produce more total matches than the unsplit name, and logging when splitting changes results for manual audit.
