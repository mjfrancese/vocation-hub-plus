# Vocation Hub+

Episcopal Church position search tool with enriched data. Deployed to GitHub Pages at https://michaelfrancese.com/vocation-hub-plus/.

## Essential Reading

**Read `docs/business-rules.md` before making changes to the pipeline, scoring, filtering, or display logic.** It documents every threshold, rule, and convention. Do not guess at business rules -- look them up.

## Architecture

- **Frontend:** Next.js App Router, static export to GitHub Pages (`web/`)
- **Scraper:** TypeScript + Playwright (`scraper/`)
- **Enrichment pipeline:** Node.js stages (`web/scripts/stages/`) orchestrated by `web/scripts/run-enrichment.js`
- **Database:** SQLite (`vocationhub.db`) stored as GitHub release artifact (`db-latest`)
- **Data flow:** Scraper -> DB -> Enrichment pipeline -> JSON files -> Next.js static build

## Key Rules

- **Never use em dashes** in any generated text.
- **Extended positions must pass data-quality gate** (quality >= 85, parochial data, recent date) to appear in the default view. This applies regardless of VH status. See `docs/business-rules.md` for details.
- **The regular scraper must not overwrite deep-scrape data.** `export-db.ts` guards profile writes by count.
- **The enrichment entry point is `web/scripts/run-enrichment.js`**, not the deleted `enrich-positions-v2.js`. Never reference the old file.
- **Use `actions/*@v6` where available** (checkout, setup-node, configure-pages). Third-party actions that lack v6 releases (upload-pages-artifact, deploy-pages, setup-python) should use the latest stable version.

## Pipeline

Enrichment stages run in order: match-parishes -> backfill-coordinates -> attach-parochial -> attach-census -> compute-compensation -> compute-percentiles -> find-similar -> clergy-context -> quality-scores.

## Workflows

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| scrape-positions.yml | 6am/6pm UTC | Scrape public search results |
| deep-scrape.yml | Sunday 3am UTC | Deep scrape all profiles, enrich, deploy |
| build-and-deploy.yml | Daily 12pm UTC + on push | Build and deploy to GitHub Pages |
| data-refresh-v2.yml | Monthly 1st at 5am UTC | Refresh external data (Asset Map, ECDPlus, Census, parochial) |
| compensation-update.yml | Manual | Import new CPG compensation PDF |

## Common Gotchas

- Quality scores and visibility are set in `quality-scores.js` (last pipeline stage). If positions appear/disappear unexpectedly, check thresholds there.
- `passesDefaultFilter()` in `filter-defaults.ts` controls the default view. Extended positions are gated by `isQualifyingUnlisted()` in `status-helpers.ts`.
- The DB is shared via GitHub releases (`db-latest`). Workflows download, modify, and re-upload. Race conditions between workflows are prevented by concurrency groups.
- `position_type` mapping to CPG categories depends on ASA (>= 400 = Senior Rector). See `compute-compensation.js`.
