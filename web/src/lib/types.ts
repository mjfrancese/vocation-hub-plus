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
