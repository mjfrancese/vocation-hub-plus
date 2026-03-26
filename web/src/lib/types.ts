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
  status: 'active' | 'expired' | 'new';
  details_url: string;

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
