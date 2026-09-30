#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import { BrowserCapture } from './capture.js';
import { compareImages } from './diff.js';
import { computeStructuralEmbedding, cosineSimilarity } from './perceptual.js';
import { resolveOutputPaths, imageName, ensureDir, fileExists } from './baseline.js';
import { resolveViewport, VIEWPORT_PRESETS } from './viewports.js';
import { summarize, writeJsonReport, writeMarkdownReport, writeHtmlReport } from './report.js';
import { login } from './auth.js';
async function testOne(capture, target, viewport, outputDir, opts) {
    const start = Date.now();
    const paths = resolveOutputPaths(outputDir);
    ensureDir(paths.baselinesDir);
    ensureDir(paths.currentDir);
    ensureDir(paths.diffsDir);
    const fileName = imageName(target.name, viewport);
    const baselinePath = path.join(paths.baselinesDir, fileName);
    const currentPath = path.join(paths.currentDir, fileName);
    const diffPath = path.join(paths.diffsDir, fileName);
    await capture.capture(target.url, target.name, viewport, currentPath, {
        fullPage: target.fullPage,
        waitForSelector: target.waitForSelector,
        waitForTimeout: target.waitForTimeout,
        hideSelectors: target.hideSelectors,
        maskSelectors: target.maskSelectors,
        clickSelectors: target.clickSelectors,
        storageStatePath: opts.storageStatePath,
    });
    const currentBuf = fs.readFileSync(currentPath);
    if (!fileExists(baselinePath) || opts.updateBaseline) {
        fs.writeFileSync(baselinePath, currentBuf);
        const png = PNG.sync.read(currentBuf);
        return {
            name: target.name,
            viewport: viewport.name,
            url: target.url,
            status: opts.updateBaseline ? 'baseline-updated' : 'baseline-created',
            passed: true,
            similarity: 1,
            diffPixelCount: 0,
            totalPixels: png.width * png.height,
            diffPercentage: 0,
            threshold: opts.threshold,
            width: png.width,
            height: png.height,
            regions: [],
            baselinePath,
            currentPath,
            durationMs: Date.now() - start,
        };
    }
    const baselineBuf = fs.readFileSync(baselinePath);
    const cmp = compareImages(baselineBuf, currentBuf, opts.pixelSensitivity);
    let perceptualSimilarity;
    if (!cmp.sizeMismatch) {
        const embA = computeStructuralEmbedding(PNG.sync.read(baselineBuf));
        const embB = computeStructuralEmbedding(PNG.sync.read(currentBuf));
        perceptualSimilarity = cosineSimilarity(embA, embB);
    }
    let diffImagePath;
    if (cmp.diffImageBuffer && cmp.diffPixelCount > 0) {
        fs.writeFileSync(diffPath, cmp.diffImageBuffer);
        diffImagePath = diffPath;
    }
    const diffPercentage = cmp.totalPixels > 0 ? (cmp.diffPixelCount / cmp.totalPixels) * 100 : 0;
    const passed = !cmp.sizeMismatch && cmp.similarity >= 1 - opts.threshold;
    return {
        name: target.name,
        viewport: viewport.name,
        url: target.url,
        status: cmp.sizeMismatch
            ? 'size-mismatch'
            : cmp.diffPixelCount === 0
                ? 'identical'
                : passed
                    ? 'passed'
                    : 'failed',
        passed,
        similarity: cmp.similarity,
        perceptualSimilarity,
        diffPixelCount: cmp.diffPixelCount,
        totalPixels: cmp.totalPixels,
        diffPercentage,
        threshold: opts.threshold,
        width: cmp.width,
        height: cmp.height,
        regions: cmp.regions,
        baselinePath,
        currentPath,
        diffImagePath,
        durationMs: Date.now() - start,
    };
}
async function runConfig(config) {
    const outputDir = config.outputDir ?? '.visual-tests';
    const threshold = config.threshold ?? 0.01;
    const pixelSensitivity = config.pixelSensitivity ?? 0.1;
    const viewports = config.viewports.map(resolveViewport);
    const capture = new BrowserCapture();
    const results = [];
    const start = Date.now();
    let storageStatePath;
    if (config.auth) {
        const configuredPath = config.auth.storageStatePath ?? '.visual-tests/auth/storageState.json';
        if (config.auth.reuseExisting !== false && fileExists(configuredPath)) {
            console.log(`Reusing existing session: ${configuredPath}`);
            storageStatePath = configuredPath;
        }
        else {
            console.log(`Logging in via ${config.auth.loginUrl} ...`);
            storageStatePath = await login(config.auth);
            console.log(`Session saved: ${storageStatePath}`);
        }
    }
    try {
        for (const target of config.pages) {
            const url = config.baseUrl ? new URL(target.url, config.baseUrl).toString() : target.url;
            for (const viewport of viewports) {
                console.log(`Testing ${target.name} @ ${viewport.name} (${viewport.width}x${viewport.height})`);
                const result = await testOne(capture, { ...target, url }, viewport, outputDir, {
                    threshold,
                    pixelSensitivity,
                    updateBaseline: config.updateBaselines ?? false,
                    storageStatePath,
                });
                results.push(result);
                console.log(`  -> ${result.status} (similarity ${(result.similarity * 100).toFixed(2)}%)`);
            }
        }
    }
    finally {
        await capture.close();
    }
    const summary = summarize(results, Date.now() - start);
    const paths = resolveOutputPaths(outputDir);
    writeJsonReport(summary, path.join(paths.reportsDir, 'latest.json'));
    writeMarkdownReport(summary, path.join(paths.reportsDir, 'latest.md'));
    writeHtmlReport(summary, path.join(paths.reportsDir, 'latest.html'));
    console.log('');
    console.log(`Total: ${summary.totalTests}  Passed: ${summary.passed}  Failed: ${summary.failed}  New baselines: ${summary.newBaselines}`);
    console.log(`Report: ${path.join(paths.reportsDir, 'latest.md')}`);
    console.log(`Report (visual): ${path.join(paths.reportsDir, 'latest.html')}`);
    if (summary.failed > 0)
        process.exitCode = 1;
}
const program = new Command();
program
    .name('visual-test')
    .description('Standalone visual regression testing agent (extracted from agentic-qe qe-visual-tester)');
program
    .command('run')
    .description('Run a visual regression suite from a JSON config file')
    .requiredOption('-c, --config <path>', 'Path to run config JSON')
    .option('--update-baselines', 'Overwrite all baselines with current captures')
    .action(async (opts) => {
    const raw = fs.readFileSync(path.resolve(opts.config), 'utf-8');
    const config = JSON.parse(raw);
    if (opts.updateBaselines)
        config.updateBaselines = true;
    await runConfig(config);
});
program
    .command('test')
    .description('Capture and compare a single page against its baseline')
    .requiredOption('-u, --url <url>', 'URL to test')
    .requiredOption('-n, --name <name>', 'Baseline name')
    .option('-v, --viewport <spec>', 'Viewport preset or WIDTHxHEIGHT[xScale]', 'desktop')
    .option('--full-page', 'Capture full scrollable page', false)
    .option('-t, --threshold <ratio>', 'Max allowed diff ratio (0-1)', '0.01')
    .option('--hide <selectors...>', 'CSS selectors to hide before capture')
    .option('--mask <selectors...>', 'CSS selectors to mask before capture')
    .option('--click <selectors...>', 'CSS selectors to click in sequence before capture (e.g. to switch tabs)')
    .option('--wait-for <selector>', 'CSS selector to wait for before capture')
    .option('--storage-state <path>', 'Playwright storageState JSON to reuse a logged-in session (see the login command)')
    .option('--update-baseline', 'Overwrite the existing baseline', false)
    .option('-o, --output-dir <dir>', 'Output directory', '.visual-tests')
    .action(async (opts) => {
    const capture = new BrowserCapture();
    try {
        const viewport = resolveViewport(opts.viewport);
        const result = await testOne(capture, {
            name: opts.name,
            url: opts.url,
            fullPage: opts.fullPage,
            hideSelectors: opts.hide,
            maskSelectors: opts.mask,
            clickSelectors: opts.click,
            waitForSelector: opts.waitFor,
        }, viewport, opts.outputDir, {
            threshold: Number(opts.threshold),
            pixelSensitivity: 0.1,
            updateBaseline: opts.updateBaseline,
            storageStatePath: opts.storageState,
        });
        console.log(JSON.stringify(result, null, 2));
        if (!result.passed && result.status !== 'baseline-created')
            process.exitCode = 1;
    }
    finally {
        await capture.close();
    }
});
program
    .command('login')
    .description('Log into an app once and save the session (cookies + localStorage) for reuse by other commands')
    .requiredOption('--url <url>', 'Login page URL')
    .requiredOption('--user-selector <selector>', 'CSS selector for the username/email field')
    .requiredOption('--pass-selector <selector>', 'CSS selector for the password field')
    .requiredOption('--submit-selector <selector>', 'CSS selector for the submit button')
    .requiredOption('--username <value>', 'Username/email to log in with')
    .requiredOption('--password <value>', 'Password to log in with')
    .option('--wait-for <selector>', 'CSS selector that confirms a successful login (e.g. a dashboard element)')
    .option('--storage-state <path>', 'Where to save the session JSON', '.visual-tests/auth/storageState.json')
    .action(async (opts) => {
    const config = {
        loginUrl: opts.url,
        usernameSelector: opts.userSelector,
        passwordSelector: opts.passSelector,
        submitSelector: opts.submitSelector,
        username: opts.username,
        password: opts.password,
        waitForSelector: opts.waitFor,
        storageStatePath: opts.storageState,
    };
    const savedPath = await login(config);
    console.log(`Session saved to ${savedPath}`);
    console.log(`Reuse it with: --storage-state ${savedPath}`);
});
program
    .command('list-viewports')
    .description('List built-in viewport presets')
    .action(() => {
    for (const [key, vp] of Object.entries(VIEWPORT_PRESETS)) {
        console.log(`${key.padEnd(12)} ${vp.width}x${vp.height}  scale=${vp.deviceScaleFactor}  mobile=${vp.isMobile}`);
    }
});
await program.parseAsync(process.argv);
