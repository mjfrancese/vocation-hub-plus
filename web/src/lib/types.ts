export interface Position {
  id: string;
  name: string;
  diocese: string;
  state: string;
  organization_type: string;
  position_type: string;
  receiving_names_from: string;
  receiving_names_to: string;
  updated_on_hub: string;
  first_seen: string;
  last_seen: string;
  status: string;
  details_url: string;

  // Visibility: 'public' = in VH search results, 'extended' = only via direct URL
  visibility?: 'public' | 'extended';
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
  church_info?: {
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
  };

  // Enriched parochial data (from Power BI cross-reference)
  parochial?: {
    congregationCity: string;
    years: Record<string, {
      averageAttendance: number | null;
      plateAndPledge: number | null;
      membership: number | null;
    }>;
  };
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

export type SortField =
  | 'name'
  | 'diocese'
  | 'state'
  | 'position_type'
  | 'receiving_names_from'
  | 'updated_on_hub'
  | 'first_seen';

export type SortDirection = 'asc' | 'desc';
