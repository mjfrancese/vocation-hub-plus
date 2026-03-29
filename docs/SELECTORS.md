# CSS Selectors Reference

All selectors used by the scraper are centralized in
`scraper/src/selectors.ts`. This document explains each selector and
how it maps to the Vocation Hub's Telerik Blazor UI components.

## Page Identification

| Selector | Value | Purpose |
|----------|-------|---------|
| `pageTitle` | `text=Position Search` | Confirms we are on the correct page |

## Search Input

The scraper triggers a full nationwide search by clearing all filters and
entering a single space into the Community Name field, which the Vocation Hub
treats as a wildcard that matches all records.

| Selector | Value | Purpose |
|----------|-------|---------|
| `communityNameInput` | `input[type="text"]` | The community name text input field |
| `communityNameLabel` | `text=Community name` | The label for the community name field |

## MultiSelect Dropdowns

The Vocation Hub uses Telerik Blazor `TelerikMultiSelect` components for
filtering by state, diocese, position type, and organization type.

### State(s)

| Selector | Value | Purpose |
|----------|-------|---------|
| `stateInput` | `input.k-input-inner[placeholder*="state" i]` | The text input inside the state multiselect |
| `stateWrapper` | `.telerik-blazor.k-multiselect.k-input` | The outer wrapper of the state multiselect |
| `stateLabel` | `label:has-text("State(s)")` | The label element for the state field |

**Note**: The scraper does not select individual states. State is not a column
in the results table. Instead, state is derived from the Diocese field using
an internal diocese-to-state mapping after scraping.

### Diocese(s)

| Selector | Value | Purpose |
|----------|-------|---------|
| `dioceseInput` | `input.k-input-inner[placeholder*="diocese" i]` | The text input inside the diocese multiselect |
| `dioceseLabel` | `label:has-text("Diocese(s)")` | The label element for the diocese field |

### Position Type(s)

| Selector | Value | Purpose |
|----------|-------|---------|
| `positionTypeLabel` | `label:has-text("Position Type(s)")` | The label element for the position type field |

### Organization Type(s)

| Selector | Value | Purpose |
|----------|-------|---------|
| `orgTypeInput` | `input.k-input-inner[placeholder*="organization" i]` | The text input inside the org type multiselect |

## Telerik Popup Components

When a multiselect dropdown is clicked, Telerik renders a popup overlay
containing the list items. These selectors target that popup.

| Selector | Value | Purpose |
|----------|-------|---------|
| `popupContainer` | `.k-animation-container` | The animated overlay that holds the dropdown list |
| `popupList` | `.k-list-ul` | The `<ul>` element inside the popup |
| `listItem` | `li.k-list-item` | Any list item (selected or not) |
| `listItemUnselected` | `li.k-list-item:not(.k-selected)` | Items not yet selected |
| `listItemSelected` | `li.k-list-item.k-selected` | Items that are already selected |

**Important behavior**: The dropdown auto-closes after each selection. The
scraper must re-open it for every item it wants to select.

## Chips

Selected items appear as "chips" (small tags) inside the multiselect input.

| Selector | Value | Purpose |
|----------|-------|---------|
| `chip` | `.k-chip` | A selected item chip |
| `chipLabel` | `.k-chip-label` | The text label inside a chip |

These are used to verify selections by counting chips after each click.

## Search Controls

| Selector | Value | Purpose |
|----------|-------|---------|
| `searchButton` | `button:has-text("Search"):not(:has-text("New"))` | The main search submit button (exact match to avoid matching "New Search") |
| `newSearchButton` | `button:has-text("New Search")` | Resets the form |

## Results Grid

The search results are displayed in a Telerik `TelerikGrid` component.

| Selector | Value | Purpose |
|----------|-------|---------|
| `resultsGrid` | `.k-grid` | The outer grid container |
| `resultsTable` | `.k-grid-table, table.k-table` | The HTML table inside the grid |
| `resultsRow` | `tbody tr` | Individual result rows |
| `resultsCell` | `td` | Table cells within a row |
| `resultsHeader` | `thead th` | Header cells, used to determine column order |
| `noResults` | `text=No records matching` | Text shown when no results match |
| `itemCount` | `text=/\d+ - \d+ of \d+ items/` | Matches the item count display |
| `zeroItems` | `text=0 - 0 of 0 items` | Matches when the result set is empty |

### Table Column Order

Based on inspection, the results table columns are:

| Index | Content |
|-------|---------|
| 0 | Name (church/organization) |
| 1 | Diocese |
| 2 | Organization Type |
| 3 | Position Type |
| 4 | Receiving Names From |
| 5 | Receiving Names To |
| 6 | Updated (date) |

**Note**: There is no State column in the results table. State is derived
from the Diocese field after extraction using an internal diocese-to-state
mapping.

## Pagination

For large result sets, the grid is paginated.

| Selector | Value | Purpose |
|----------|-------|---------|
| `pager` | `.k-pager` | The pagination control container |
| `pagerNext` | `.k-pager button[aria-label="Go to the next page"]` | Next page button |
| `pagerInfo` | `.k-pager-info` | Shows "X - Y of Z items" text |

## Maintaining Selectors

If the Vocation Hub updates their UI, selectors may break. To diagnose:

1. Run the scraper with `SCREENSHOT_ON_FAILURE=true`
2. Check the screenshot to see what the page looks like
3. Use browser DevTools on the live site to find updated selectors
4. Update `scraper/src/selectors.ts` (the single source of truth)
5. Update this document to match
