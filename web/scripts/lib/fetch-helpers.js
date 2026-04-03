/**
 * Shared fetch utilities for ECDPlus data-refresh scripts.
 */

'use strict';

const MAX_RETRIES = 4;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry and exponential backoff on 5xx / network errors.
 * Retries up to MAX_RETRIES times with delays of 2s, 4s, 8s, 16s.
 * @param {string} url
 * @param {string} label - for logging
 * @returns {Promise<Response|null>} response or null if all retries exhausted
 */
async function fetchWithRetry(url, label) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        const delay = 2000 * Math.pow(2, attempt);
        console.warn(`  ${label}: HTTP ${response.status}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      // 4xx or final 5xx attempt
      console.warn(`  Skipping ${label}: HTTP ${response.status}`);
      return null;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const delay = 2000 * Math.pow(2, attempt);
        console.warn(`  ${label}: ${err.message}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      console.warn(`  Skipping ${label}: ${err.message} (exhausted retries)`);
      return null;
    }
  }
  return null;
}

/**
 * Process items with controlled concurrency.
 * @param {Array} items - Items to process
 * @param {number} concurrency - Max concurrent operations
 * @param {Function} fn - Async function to process each item, receives (item, index)
 * @returns {Promise<Array>} Results (may contain undefined for skipped items)
 */
async function fetchConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = { sleep, fetchWithRetry, fetchConcurrent };
