import fs from 'fs';
import path from 'path';
import { getAllPositionsWithDetails, getRecentChanges, getDetailHistory, getScrapeStats, getDiscoveryStats } from './db.js';
import { CONFIG } from './config.js';
import { logger } from './logger.js';

/**
 * Export database contents to static JSON files for the frontend.
 * Writes to both scraper/output/ and web/public/data/.
 */
export function exportJson(): void {
  const positions = getAllPositionsWithDetails();
  const changes = getRecentChanges(500);
  const detailHistory = getDetailHistory(500);
  const stats = getScrapeStats();

  const discovery = getDiscoveryStats();

  const meta = {
    lastUpdated: new Date().toISOString(),
    totalPositions: positions.length,
    activeCount: positions.filter((p) => p.status === 'active' || p.status === 'new').length,
    expiredCount: positions.filter((p) => p.status === 'expired').length,
    newCount: positions.filter((p) => p.status === 'new').length,
    lastScrape: stats || null,
    discoveryStatus: discovery,
  };

  const outputDirs = [
    CONFIG.outputPath,
    path.resolve(__dirname, '../../web/public/data'),
  ];

  for (const dir of outputDirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(path.join(dir, 'positions.json'), JSON.stringify(positions, null, 2));
    fs.writeFileSync(path.join(dir, 'changes.json'), JSON.stringify(changes, null, 2));
    fs.writeFileSync(path.join(dir, 'detail-history.json'), JSON.stringify(detailHistory, null, 2));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

    logger.info('JSON exported', { directory: dir });
  }

  logger.info('Export complete', {
    positions: positions.length,
    changes: changes.length,
    detailHistory: detailHistory.length,
  });
}
