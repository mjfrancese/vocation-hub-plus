/**
 * Scrape parochial report data from the General Convention Power BI dashboard.
 *
 * Queries the public Power BI "publish to web" API per diocese (114 dioceses)
 * to collect historical congregation data: Average Attendance, Plate & Pledge,
 * Membership across all available years (2015-2024).
 *
 * The Power BI compressed response format uses:
 *   - ValueDicts (D0, D1, ...) for string deduplication
 *   - Repeat bitmasks (R) to omit unchanged columns from previous row
 *   - Null bitmasks (null character) for null values
 *   - Schema (S) defining column order
 *
 * Can be run standalone or called from scrape-church-directory.ts.
 *
 * Usage:
 *   tsx src/scrape-parochial-reports.ts              # Full run
 *   tsx src/scrape-parochial-reports.ts test          # Test mode: 3 dioceses
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import type { ParochialRecord, ParochialCongregation, ParochialData } from './church-types.js';

const POWERBI_QUERY_URL = 'https://wabi-us-north-central-b-api.analysis.windows.net/public/reports/querydata?synchronous=true';
const POWERBI_RESOURCE_KEY = '3bd042b4-93dd-4e3d-be8c-cd648059354b';
const DATASET_ID = '0e70c2bf-2d78-46f5-b992-f75a9d25ca35';
const REPORT_ID = '45ca9d48-5ede-45d0-879a-14ec6ceddfb4';
const MODEL_ID = 9538176;

const WEB_DATA_DIR = path.resolve(__dirname, '../../web/public/data');
const OUTPUT_FILE = path.join(WEB_DATA_DIR, 'parochial-data.json');

const CONCURRENT_DIOCESE_FETCHES = 5;
const FETCH_DELAY_MS = 200;

// --- Power BI Query Builder ---

function buildDioceseListQuery(): Record<string, unknown> {
  return {
    version: '1.0.0',
    queries: [{
      Query: {
        Commands: [{
          SemanticQueryDataShapeCommand: {
            Query: {
              Version: 2,
              From: [{ Name: 'r', Entity: 'Raw Data_UPDATED', Type: 0 }],
              Select: [{
                Column: { Expression: { SourceRef: { Source: 'r' } }, Property: 'Diocese' },
                Name: 'Raw Data_UPDATED.Diocese',
              }],
              OrderBy: [{
                Direction: 1,
                Expression: { Column: { Expression: { SourceRef: { Source: 'r' } }, Property: 'Diocese' } },
              }],
            },
            Binding: {
              Primary: { Groupings: [{ Projections: [0] }] },
              DataReduction: { DataVolume: 4, Primary: { Top: { Count: 500 } } },
              Version: 1,
            },
            ExecutionMetricsKind: 1,
          },
        }],
      },
      QueryId: '',
      ApplicationContext: {
        DatasetId: DATASET_ID,
        Sources: [{ ReportId: REPORT_ID, VisualId: '' }],
      },
    }],
    cancelQueries: [],
    modelId: MODEL_ID,
  };
}

function buildDioceseDataQuery(diocese: string): Record<string, unknown> {
  return {
    version: '1.0.0',
    queries: [{
      Query: {
        Commands: [{
          SemanticQueryDataShapeCommand: {
            Query: {
              Version: 2,
              From: [{ Name: 'r', Entity: 'Raw Data_UPDATED', Type: 0 }],
              Select: [
                {
                  Column: { Expression: { SourceRef: { Source: 'r' } }, Property: 'Congregation_City' },
                  Name: 'Raw Data_UPDATED.Congregation_City',
                },
                {
                  Column: { Expression: { SourceRef: { Source: 'r' } }, Property: 'Diocese' },
                  Name: 'Raw Data_UPDATED.Diocese',
                },
                {
                  Column: { Expression: { SourceRef: { Source: 'r' } }, Property: 'Filing Year' },
                  Name: 'Raw Data_UPDATED.Filing Year',
                },
                {
                  Column: { Expression: { SourceRef: { Source: 'r' } }, Property: 'Average Attendance' },
                  Name: 'Raw Data_UPDATED.Average Attendance',
                },
                {
                  Column: { Expression: { SourceRef: { Source: 'r' } }, Property: 'Plate and Pledge' },
                  Name: 'Raw Data_UPDATED.Plate and Pledge',
                },
                {
                  Column: { Expression: { SourceRef: { Source: 'r' } }, Property: 'Membership' },
                  Name: 'Raw Data_UPDATED.Membership',
                },
              ],
              Where: [{
                Condition: {
                  In: {
                    Expressions: [{
                      Column: { Expression: { SourceRef: { Source: 'r' } }, Property: 'Diocese' },
                    }],
                    Values: [[{ Literal: { Value: `'${diocese.replace(/'/g, "''")}'` } }]],
                  },
                },
              }],
            },
            Binding: {
              Primary: { Groupings: [{ Projections: [0, 1, 2, 3, 4, 5] }] },
              DataReduction: { DataVolume: 6, Primary: { Top: { Count: 30000 } } },
              Version: 1,
            },
            ExecutionMetricsKind: 1,
          },
        }],
      },
      QueryId: '',
      ApplicationContext: {
        DatasetId: DATASET_ID,
        Sources: [{ ReportId: REPORT_ID, VisualId: '' }],
      },
    }],
    cancelQueries: [],
    modelId: MODEL_ID,
  };
}

// --- Power BI Response Decoder ---
//
// Power BI compressed format:
//   - First row has S (schema): array of { N: "G0", T: type, DN?: "D0" }
//     DN present = column uses ValueDict for string deduplication
//   - C: array of cell values (only non-repeated columns)
//   - R: bitmask where bit N set = column N repeats from previous row
//   - Null handling: columns may be omitted or null
//
// For the diocese data query, schema is:
//   G0 (Congregation_City, DN: D0), G1 (Diocese, DN: D1),
//   G2 (Filing Year), G3 (Avg Attendance), G4 (Plate & Pledge), G5 (Membership)

interface PowerBIRow {
  C?: unknown[];
  R?: number;
  S?: Array<{ N: string; T?: number; DN?: string }>;
  // Diocese list rows use G0 directly instead of C array
  [key: string]: unknown;
}

interface PowerBIDsr {
  DS: Array<{
    PH: Array<{
      DM0: PowerBIRow[];
    }>;
    ValueDicts?: Record<string, unknown[]>;
  }>;
}

function decodeDioceseList(dsr: PowerBIDsr): string[] {
  const ds = dsr.DS[0];
  if (!ds) return [];

  const rows = ds.PH?.[0]?.DM0 || [];
  const dioceses: string[] = [];

  for (const row of rows) {
    // Diocese list uses G0 property directly (no C array, no ValueDicts)
    const val = row.G0;
    if (typeof val === 'string' && val) {
      dioceses.push(val);
    }
  }

  return dioceses;
}

function decodeParochialRows(dsr: PowerBIDsr): ParochialRecord[] {
  const records: ParochialRecord[] = [];
  const ds = dsr.DS[0];
  if (!ds) return records;

  const valueDicts = ds.ValueDicts || {};
  const rows = ds.PH?.[0]?.DM0 || [];

  // Parse schema from first row to find which columns use which ValueDicts
  let colDicts: Array<string | null> = []; // DN for each column, null = direct value
  const numCols = 6;
  let prevExpanded: unknown[] = new Array(numCols).fill(null);

  for (const row of rows) {
    // First row (or any row with S) defines the schema
    if (row.S) {
      colDicts = row.S.map(s => s.DN || null);
    }

    const cells = row.C || [];
    const repeatMask = row.R ?? 0;

    // Expand: R bitmask tells which columns repeat from prev row
    const expanded: unknown[] = [];
    let cellIdx = 0;

    for (let col = 0; col < numCols; col++) {
      if (repeatMask & (1 << col)) {
        expanded.push(prevExpanded[col]);
      } else {
        expanded.push(cells[cellIdx] ?? null);
        cellIdx++;
      }
    }

    prevExpanded = expanded;

    // Resolve string columns via ValueDicts
    const congregationCity = resolveDict(expanded[0], valueDicts, colDicts[0]);
    const diocese = resolveDict(expanded[1], valueDicts, colDicts[1]);
    const filingYear = toNumber(expanded[2]);
    const avgAttendance = toNullableNumber(expanded[3]);
    const plateAndPledge = toNullableNumber(expanded[4]);
    const membership = toNullableNumber(expanded[5]);

    if (congregationCity && diocese && filingYear) {
      records.push({
        congregationCity,
        diocese,
        year: filingYear,
        averageAttendance: avgAttendance,
        plateAndPledge: plateAndPledge,
        membership: membership,
      });
    }
  }

  return records;
}

function resolveDict(
  value: unknown,
  valueDicts: Record<string, unknown[]>,
  dictKey: string | null,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && dictKey) {
    const dict = valueDicts[dictKey];
    if (dict && value >= 0 && value < dict.length) {
      return String(dict[value]);
    }
  }
  return String(value);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return isNaN(n) ? null : n;
  }
  return null;
}

// --- Concurrency limiter ---

function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      const run = queue.shift()!;
      run();
    }
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Fetching ---

async function queryPowerBI(body: Record<string, unknown>): Promise<unknown> {
  const resp = await fetch(POWERBI_QUERY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PowerBI-ResourceKey': POWERBI_RESOURCE_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    throw new Error(`Power BI query failed: ${resp.status} ${resp.statusText}`);
  }

  return resp.json();
}

async function fetchDioceseList(): Promise<string[]> {
  logger.info('Fetching diocese list from Power BI');
  const data = await queryPowerBI(buildDioceseListQuery()) as Record<string, unknown>;

  const results = data.results as Array<{ result: { data: { dsr: PowerBIDsr } } }>;
  const dsr = results?.[0]?.result?.data?.dsr;
  if (!dsr) {
    throw new Error('No data in Power BI diocese list response');
  }

  const dioceses = decodeDioceseList(dsr);
  logger.info('Found dioceses', { count: dioceses.length });
  return dioceses;
}

async function fetchDioceseData(diocese: string, retries = 3): Promise<ParochialRecord[]> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const data = await queryPowerBI(buildDioceseDataQuery(diocese)) as Record<string, unknown>;
      const results = data.results as Array<{ result: { data: { dsr: PowerBIDsr } } }>;
      const dsr = results?.[0]?.result?.data?.dsr;
      if (!dsr) {
        logger.warn('No data in Power BI response for diocese', { diocese });
        return [];
      }
      return decodeParochialRows(dsr);
    } catch (err) {
      if (attempt < retries) {
        logger.warn('Retrying diocese fetch', { diocese, attempt, error: String(err) });
        await sleep(attempt * 2000);
        continue;
      }
      logger.warn('Failed to fetch diocese data', { diocese, error: String(err) });
      return [];
    }
  }
  return [];
}

// --- Main export ---

export async function scrapeParochialReports(testMode = false): Promise<ParochialData> {
  const startTime = Date.now();
  logger.info('Parochial report scraper starting', { testMode });

  // Step 1: Get list of all dioceses
  const allDioceses = await fetchDioceseList();
  const dioceses = testMode ? allDioceses.slice(0, 3) : allDioceses;

  logger.info('Querying parochial data by diocese', { total: dioceses.length });

  // Step 2: Fetch data per diocese with concurrency limit
  const limit = pLimit(CONCURRENT_DIOCESE_FETCHES);
  const allRecords: ParochialRecord[] = [];
  let completed = 0;
  let errors = 0;

  const promises = dioceses.map(diocese =>
    limit(async () => {
      const records = await fetchDioceseData(diocese);
      completed++;

      if (records.length > 0) {
        allRecords.push(...records);
      } else {
        errors++;
      }

      if (completed % 10 === 0 || completed === dioceses.length) {
        logger.info('Parochial fetch progress', {
          completed,
          total: dioceses.length,
          records: allRecords.length,
          errors,
        });
      }

      await sleep(FETCH_DELAY_MS);
    })
  );

  await Promise.all(promises);

  // Step 3: Group records by congregation
  const congregationMap = new Map<string, ParochialCongregation>();

  for (const record of allRecords) {
    const key = `${record.diocese}|${record.congregationCity}`;
    let congregation = congregationMap.get(key);
    if (!congregation) {
      congregation = {
        congregationCity: record.congregationCity,
        diocese: record.diocese,
        years: {},
      };
      congregationMap.set(key, congregation);
    }

    congregation.years[record.year] = {
      averageAttendance: record.averageAttendance,
      plateAndPledge: record.plateAndPledge,
      membership: record.membership,
    };
  }

  const congregations = Array.from(congregationMap.values());

  // Determine year range
  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const record of allRecords) {
    if (record.year < minYear) minYear = record.year;
    if (record.year > maxYear) maxYear = record.year;
  }

  const parochialData: ParochialData = {
    meta: {
      lastUpdated: new Date().toISOString(),
      totalCongregations: congregations.length,
      yearRange: [minYear === Infinity ? 0 : minYear, maxYear === -Infinity ? 0 : maxYear],
    },
    congregations,
  };

  // Save output
  if (!fs.existsSync(WEB_DATA_DIR)) {
    fs.mkdirSync(WEB_DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(parochialData, null, 2));

  const durationMs = Date.now() - startTime;
  logger.info('Parochial report scrape complete', {
    totalRecords: allRecords.length,
    totalCongregations: congregations.length,
    yearRange: parochialData.meta.yearRange,
    errors,
    durationMs,
  });

  return parochialData;
}

// --- Standalone execution ---

if (require.main === module || process.argv[1]?.endsWith('scrape-parochial-reports.ts')) {
  const testMode = process.argv.includes('test');
  scrapeParochialReports(testMode).catch(err => {
    logger.error('Parochial report scraper failed', { error: String(err) });
    process.exit(1);
  });
}
