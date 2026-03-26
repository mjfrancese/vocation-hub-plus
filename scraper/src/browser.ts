import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import fs from 'fs';
import path from 'path';

export async function launchBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  logger.info('Launching browser');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  logger.info('Browser launched successfully');
  return { browser, context, page };
}

export async function takeScreenshot(page: Page, name: string): Promise<void> {
  try {
    if (!fs.existsSync(CONFIG.screenshotDir)) {
      fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
    }
    const filepath = path.join(CONFIG.screenshotDir, `${name}-${Date.now()}.png`);
    await page.screenshot({ path: filepath, fullPage: true });
    logger.info('Screenshot saved', { path: filepath });
  } catch (err) {
    logger.warn('Failed to save screenshot', { error: String(err) });
  }
}

export async function closeBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close();
    logger.info('Browser closed');
  } catch (err) {
    logger.warn('Error closing browser', { error: String(err) });
  }
}
