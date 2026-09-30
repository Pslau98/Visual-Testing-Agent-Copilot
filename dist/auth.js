import { chromium } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
/**
 * Logs in once with a real browser and saves cookies + localStorage
 * (Playwright's "storage state") to a JSON file. Every subsequent capture
 * loads that file into a fresh browser context instead of logging in again —
 * the standard Playwright pattern for testing authenticated apps.
 */
export async function login(config) {
    const username = config.username ?? (config.usernameEnv ? process.env[config.usernameEnv] : undefined);
    const password = config.password ?? (config.passwordEnv ? process.env[config.passwordEnv] : undefined);
    if (!username || !password) {
        throw new Error('Login requires a username/password, either inline (username/password) or via env vars (usernameEnv/passwordEnv).');
    }
    const storageStatePath = config.storageStatePath ?? '.visual-tests/auth/storageState.json';
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(config.loginUrl, { waitUntil: 'networkidle' });
        await page.fill(config.usernameSelector, username);
        await page.fill(config.passwordSelector, password);
        await page.click(config.submitSelector);
        if (config.waitForSelector) {
            await page.waitForSelector(config.waitForSelector, { timeout: config.waitForTimeout ?? 10000 });
        }
        else {
            await page.waitForTimeout(config.waitForTimeout ?? 2000);
        }
        fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
        await context.storageState({ path: storageStatePath });
        return storageStatePath;
    }
    finally {
        await browser.close();
    }
}
