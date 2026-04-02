export interface Position {
  id: string;
  name: string;
  diocese: string;
  state: string;
  organization_type: string;
  position_type: string;
  // Canonical normalized types derived from position_type (e.g. ['Rector', 'Vicar', 'Priest-in-Charge'])
  position_types?: string[];
  receiving_names_from: string;
  receiving_names_to: string;
  updated_on_hub: string;
  first_seen: string;
  last_seen: string;
  status: string;
  details_url: string;

  // Visibility: 'public' = in VH search results, 'extended' = directory listing,
  // 'extended_hidden' = directory listing below quality threshold
  visibility?: 'public' | 'extended' | 'extended_hidden';
  // Quality score (0-100) computed at build time
  quality_score?: number;
  // Scoring components that contributed to the quality score
  quality_components?: string[];
  // VH's own status field (e.g. "Receiving names", "Search complete")
  vh_status?: string;
  // Match confidence from position-church mapping
  match_confidence?: 'exact' | 'high' | 'manual' | 'none';
  // Computed: is this position recently opened?
  is_new?: boolean;

  // Detail fields (from Position Profile page)
  vh_id?: number;
  profile_url?: string;
  address?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  position_title?: string;
  full_part_time?: string;
  position_description?: string;
  minimum_stipend?: string;
  maximum_stipend?: string;
  housing_type?: string;
  housing_description?: string;
  benefits?: string;
  community_description?: string;
  worship_style?: string;
  avg_sunday_attendance?: string;
  church_school_size?: string;
  desired_skills?: string;
  challenges?: string;
  website_url?: string;
  social_media_links?: string;
  narrative_reflections?: string;

  // Deep scrape fields (raw field arrays from profile pages)
  deep_scrape_fields?: Array<{ label: string; value: string }>;

  // Enriched church data (from church directory cross-reference)
  // Always an array: single-parish = [one], multi-parish = [one, two, ...]
  church_infos?: ChurchInfo[];

  // Diocese-level percentile rankings (computed at build time)
  diocese_percentiles?: {
    asa?: number;
    asa_value?: number;
    plate_pledge?: number;
    plate_pledge_value?: number;
    membership?: number;
    membership_value?: number;
  };

  // Estimated total compensation (computed at build time)
  estimated_total_comp?: number;
  comp_breakdown?: {
    stipend: number;
    housing?: number;
  };

  compensation?: {
    diocese_median: number;
    diocese_female_median: number;
    diocese_male_median: number;
    diocese_clergy_count: number;
    year: number;
    position_type_median?: number;
    position_type_count?: number;
    position_type_label?: string;
  };

  current_clergy?: {
    name: string;
    position_title: string;
    start_date: string;
    years_tenure: number;
  } | null;

  parish_clergy_history?: {
    recent_count: number;
    avg_tenure_years: number;
  };

  // CPG position type mapping (e.g., 'Solo Rector', 'Assistant')
  cpg_position_type?: string;

  // Census/demographic data (attached at build time)
  census?: {
    median_household_income?: number;
    population?: number;
  };

  // Similar positions (computed at build time)
  similar_positions?: Array<{
    id: string;
    vh_id?: number;
    name: string;
    city: string;
    state: string;
    position_type: string;
    asa?: number;
    estimated_total_comp?: number;
    score: number;
    match_reasons?: {
      asa: boolean;
      comp: boolean;
      state: boolean;
      type: boolean;
      housing: boolean;
    };
  }>;

  // Parochial report data (parallel with church_infos)
  parochials?: ParochialData[];

  // Neutral parish context (parallel with church_infos)
  parish_contexts?: ParishContext[];
}

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

export interface ParochialData {
  congregationCity: string;
  years: Record<string, {
    averageAttendance: number | null;
    plateAndPledge: number | null;
    membership: number | null;
  }>;
}

export interface PositionChange {
  id: number;
  position_id: string;
  change_type: 'new' | 'expired' | 'reappeared' | 'updated';
  changed_at: string;
  details: string | null;
  name: string;
  diocese: string;
  position_type: string;
}

export interface Meta {
  lastUpdated: string | null;
  totalPositions: number;
  activeCount: number;
  expiredCount: number;
  newCount: number;
  lastScrape: {
    scraped_at: string;
    total_found: number;
    new_count: number;
    expired_count: number;
    duration_ms: number;
    status: string;
  } | null;
}

/** Precomputed data for a claimed clergy member (from clergy-tokens.json) */
export interface PersonalData {
  name: string;
  clergy_guid: string;
  current_position: {
    title: string;
    parish: string;
    parish_id: number | null;
    start_date: string | null;
    diocese: string;
    city: string | null;
    state: string | null;
  } | null;
  ordination_year: number | null;
  experience_years: number | null;
  positions: Array<{
    title: string;
    parish: string;
    parish_id: number | null;
    diocese: string;
    city: string | null;
    state: string | null;
    start_year: number | null;
    end_year: number | null;
    is_current: boolean;
  }>;
  compensation_benchmarks: CompBenchmarks;
  current_parish: {
    asa: number | null;
    plate_pledge: number | null;
    membership: number | null;
    operating_revenue: number | null;
    lat: number | null;
    lng: number | null;
    census_median_income: number | null;
    census_population: number | null;
    clergy_count_10yr: number;
    avg_tenure_years: number | null;
  } | null;
}

/** Compensation benchmark medians across multiple dimensions */
export interface CompBenchmarks {
  diocese_median: number | null;
  diocese_female_median: number | null;
  diocese_male_median: number | null;
  asa_bucket_median: number | null;
  position_type_median: number | null;
  experience_bracket_median: number | null;
  year: number | null;
}

/** Entry in clergy-search-index.json for the claim page */
export interface ClaimSearchEntry {
  token: string;
  name: string;
  diocese: string | null;
  current_position: string | null;
  current_parish: string | null;
  city: string | null;
  state: string | null;
  ordination_year: number | null;
}

/** Parish context data computed at build time, shown to all users */
export interface ParishContext {
  clergy_count_10yr: number;
  avg_tenure_years: number | null;
  current_clergy_count: number;
  attendance_trend: 'growing' | 'declining' | 'stable' | null;
  attendance_change_pct: number | null;
  giving_trend: 'growing' | 'declining' | 'stable' | null;
  giving_change_pct: number | null;
  membership_trend: 'growing' | 'declining' | 'stable' | null;
  membership_change_pct: number | null;
  latest_operating_revenue: number | null;
  years_of_data: number;
}

export type SortField =
  | 'name'
  | 'diocese'
  | 'date'        // receiving_names_from (renamed from 'receiving_names_from')
  | 'updated'     // updated_on_hub
  | 'firstseen'   // first_seen
  | 'quality_score';

export type SortDirection = 'asc' | 'desc';
