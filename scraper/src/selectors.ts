/**
 * Centralized CSS selectors for the Vocation Hub Blazor/Telerik UI.
 * All selectors used by the scraper MUST be imported from this file.
 */
export const SELECTORS = {
  // Page
  pageTitle: 'text=Position Search',

  // Community name text input (supports * and ? wildcards)
  communityNameInput: 'input[type="text"]',
  communityNameLabel: 'text=Community name',

  // State(s) MultiSelect
  stateInput: 'input.k-input-inner[placeholder*="state" i]',
  stateWrapper: '.telerik-blazor.k-multiselect.k-input',
  stateLabel: 'label:has-text("State(s)")',

  // Diocese(s) MultiSelect
  dioceseInput: 'input.k-input-inner[placeholder*="diocese" i]',
  dioceseLabel: 'label:has-text("Diocese(s)")',

  // Position Type(s) MultiSelect
  positionTypeLabel: 'label:has-text("Position Type(s)")',

  // Organization Type(s) MultiSelect
  orgTypeInput: 'input.k-input-inner[placeholder*="organization" i]',

  // Telerik MultiSelect Popup (appears in DOM when dropdown opens)
  popupContainer: '.k-animation-container',
  popupList: '.k-list-ul',
  listItem: 'li.k-list-item',
  listItemUnselected: 'li.k-list-item:not(.k-selected)',
  listItemSelected: 'li.k-list-item.k-selected',

  // Chips (selected items shown in the input)
  chip: '.k-chip',
  chipLabel: '.k-chip-label',

  // Search controls
  searchButton: 'button:has-text("Search")',
  newSearchButton: 'button:has-text("New Search")',

  // Results
  resultsGrid: '.k-grid',
  resultsTable: '.k-grid-table, table.k-table',
  resultsRow: 'tbody tr',
  resultsCell: 'td',
  resultsHeader: 'thead th',
  noResults: 'text=No records matching',
  itemCount: 'text=/\\d+ - \\d+ of \\d+ items/',
  zeroItems: 'text=0 - 0 of 0 items',

  // Pagination
  pager: '.k-pager',
  pagerNext: '.k-pager button[aria-label="Go to the next page"]',
  pagerInfo: '.k-pager-info',
} as const;
