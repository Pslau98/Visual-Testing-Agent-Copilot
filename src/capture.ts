import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CaptureOptions, Screenshot, Viewport } from './types.js';

/**
 * Scrolls to the bottom of the page in steps and back to the top, giving
 * scroll-triggered/lazy-loaded content (common in responsive layouts) a
 * chance to load before a full-page screenshot is taken.
 */
async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const distance = 400;
      let total = 0;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        total += distance;
        if (total >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
}

export class BrowserCapture {
  private browser: Browser | null = null;

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  async capture(
    url: string,
    name: string,
    viewport: Viewport,
    outputPath: string,
    options: CaptureOptions = {}
  ): Promise<Screenshot> {
    const start = Date.now();
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
      userAgent: viewport.userAgent,
      storageState: options.storageStatePath,
      // Freezes CSS animations/transitions (menu toggles, carousels, etc.) so
      // responsive components that animate between states don't cause flaky diffs.
      reducedMotion: 'reduce',
    });

    try {
      const page = await context.newPage();
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: options.navigationTimeout ?? 30000,
      });

      if (options.clickSelectors?.length) {
        for (const selector of options.clickSelectors) {
          await page.click(selector);
          await page.waitForTimeout(300);
        }
      }

      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, {
          timeout: options.waitForTimeout ?? 5000,
        });
      } else if (options.waitForTimeout) {
        await page.waitForTimeout(options.waitForTimeout);
      }

      // Many responsive layouts lazy-load images/sections as they scroll into
      // view (IntersectionObserver, srcset swaps). Walk the page once so a
      // full-page capture reflects the fully-loaded state, not just the fold.
      if (options.fullPage) {
        await autoScroll(page);
      }

      // Wait for web fonts so text reflow (line breaks, wrapping) has settled
      // before the screenshot — responsive text wrapping is sensitive to this.
      await page.evaluate(() => document.fonts?.ready).catch(() => undefined);

      if (options.hideSelectors?.length) {
        await page.evaluate((selectors) => {
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach((el) => {
              (el as HTMLElement).style.visibility = 'hidden';
            });
          }
        }, options.hideSelectors);
      }

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      const mask = options.maskSelectors?.map((sel) => page.locator(sel));

      await page.screenshot({
        path: outputPath,
        fullPage: options.fullPage ?? false,
        mask,
        // Belt-and-suspenders alongside context-level reducedMotion: forces
        // CSS animations/transitions/infinite animations to their end state.
        animations: 'disabled',
      });

      return {
        id: randomUUID(),
        name,
        url,
        viewport,
        path: outputPath,
        timestamp: new Date().toISOString(),
        fullPage: options.fullPage ?? false,
        captureTimeMs: Date.now() - start,
      };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
