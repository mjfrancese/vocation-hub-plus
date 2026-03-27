/**
 * Mapping of Episcopal Church diocese names to US state abbreviations.
 * Used to derive the state from the diocese column since the Vocation Hub
 * results table does not include a State column.
 */
export const DIOCESE_TO_STATE: Record<string, string> = {
  // Alabama
  "Alabama": "AL",
  "Central Gulf Coast": "AL",

  // Alaska
  "Alaska": "AK",

  // Arizona
  "Arizona": "AZ",
  "Navajoland": "AZ",

  // Arkansas
  "Arkansas": "AR",

  // California
  "California": "CA",
  "El Camino Real": "CA",
  "Los Angeles": "CA",
  "Northern California": "CA",
  "San Diego": "CA",
  "San Joaquin": "CA",

  // Colorado
  "Colorado": "CO",

  // Connecticut
  "Connecticut": "CT",

  // Delaware
  "Delaware": "DE",

  // Florida
  "Central Florida": "FL",
  "Florida": "FL",
  "Southeast Florida": "FL",
  "Southwest Florida": "FL",

  // Georgia
  "Atlanta": "GA",
  "Georgia": "GA",

  // Hawaii
  "Hawaii": "HI",

  // Idaho
  "Idaho": "ID",

  // Illinois
  "Chicago": "IL",
  "Quincy": "IL",
  "Springfield": "IL",

  // Indiana
  "Indianapolis": "IN",
  "Northern Indiana": "IN",

  // Iowa
  "Iowa": "IA",

  // Kansas
  "Kansas": "KS",
  "Western Kansas": "KS",

  // Kentucky
  "Kentucky": "KY",
  "Lexington": "KY",

  // Louisiana
  "Louisiana": "LA",
  "Western Louisiana": "LA",

  // Maine
  "Maine": "ME",

  // Maryland
  "Easton": "MD",
  "Maryland": "MD",

  // Massachusetts
  "Massachusetts": "MA",
  "Western Massachusetts": "MA",

  // Michigan
  "Eastern Michigan": "MI",
  "Michigan": "MI",
  "Northern Michigan": "MI",
  "Western Michigan": "MI",

  // Minnesota
  "Minnesota": "MN",

  // Mississippi
  "Mississippi": "MS",

  // Missouri
  "Missouri": "MO",
  "West Missouri": "MO",

  // Montana
  "Montana": "MT",

  // Nebraska
  "Nebraska": "NE",

  // Nevada
  "Nevada": "NV",

  // New Hampshire
  "New Hampshire": "NH",

  // New Jersey
  "New Jersey": "NJ",
  "Newark": "NJ",

  // New Mexico
  "Rio Grande": "NM",

  // New York
  "Albany": "NY",
  "Central New York": "NY",
  "Long Island": "NY",
  "New York": "NY",
  "Rochester": "NY",
  "Western New York": "NY",

  // North Carolina
  "East Carolina": "NC",
  "North Carolina": "NC",
  "Western North Carolina": "NC",

  // North Dakota
  "North Dakota": "ND",

  // Ohio
  "Ohio": "OH",
  "Southern Ohio": "OH",

  // Oklahoma
  "Oklahoma": "OK",

  // Oregon
  "Eastern Oregon": "OR",
  "Oregon": "OR",

  // Pennsylvania
  "Bethlehem": "PA",
  "Central Pennsylvania": "PA",
  "Northwestern Pennsylvania": "PA",
  "Pennsylvania": "PA",
  "Pittsburgh": "PA",

  // Rhode Island
  "Rhode Island": "RI",

  // South Carolina
  "South Carolina": "SC",
  "Upper South Carolina": "SC",

  // South Dakota
  "South Dakota": "SD",

  // Tennessee
  "East Tennessee": "TN",
  "Tennessee": "TN",
  "West Tennessee": "TN",

  // Texas
  "Dallas": "TX",
  "Fort Worth": "TX",
  "Northwest Texas": "TX",
  "Texas": "TX",
  "West Texas": "TX",

  // Utah
  "Utah": "UT",

  // Vermont
  "Vermont": "VT",

  // Virginia
  "Southern Virginia": "VA",
  "Southwestern Virginia": "VA",
  "Virginia": "VA",

  // Washington State
  "Olympia": "WA",
  "Spokane": "WA",

  // Washington DC
  "Washington": "DC",

  // West Virginia
  "West Virginia": "WV",

  // Wisconsin
  "Eau Claire": "WI",
  "Fond du Lac": "WI",
  "Milwaukee": "WI",

  // Wyoming
  "Wyoming": "WY",
};

/**
 * Look up the US state abbreviation for a diocese name.
 * Falls back to empty string if the diocese is not recognized.
 */
export function getStateForDiocese(diocese: string): string {
  if (!diocese) return '';

  // Try exact match first
  const exact = DIOCESE_TO_STATE[diocese];
  if (exact) return exact;

  // Try case-insensitive match
  const lower = diocese.toLowerCase();
  for (const [key, value] of Object.entries(DIOCESE_TO_STATE)) {
    if (key.toLowerCase() === lower) return value;
  }

  // Try partial match (diocese name might have extra text)
  for (const [key, value] of Object.entries(DIOCESE_TO_STATE)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return value;
    }
  }

  return '';
}
