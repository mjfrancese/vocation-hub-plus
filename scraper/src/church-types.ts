/**
 * Types for the Episcopal Church directory scraped from episcopalassetmap.org.
 */

export interface Church {
  nid: number;
  name: string;
  diocese: string;
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

export interface ChurchDirectory {
  meta: {
    lastUpdated: string;
    totalChurches: number;
  };
  churches: Church[];
}

// --- Parochial Report Types ---

export interface ParochialRecord {
  congregationCity: string; // "Name (City)" format from Power BI
  diocese: string;
  year: number;
  averageAttendance: number | null;
  plateAndPledge: number | null;
  membership: number | null;
}

export interface ParochialCongregation {
  congregationCity: string;
  diocese: string;
  years: Record<number, {
    averageAttendance: number | null;
    plateAndPledge: number | null;
    membership: number | null;
  }>;
}

export interface ParochialData {
  meta: {
    lastUpdated: string;
    totalCongregations: number;
    yearRange: [number, number];
  };
  congregations: ParochialCongregation[];
}
