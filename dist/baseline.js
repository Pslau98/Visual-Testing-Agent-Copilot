import * as fs from 'node:fs';
import * as path from 'node:path';
import { viewportKey } from './viewports.js';
export function resolveOutputPaths(outputDir) {
    return {
        baselinesDir: path.join(outputDir, 'baselines'),
        currentDir: path.join(outputDir, 'current'),
        diffsDir: path.join(outputDir, 'diffs'),
        reportsDir: path.join(outputDir, 'reports'),
    };
}
function sanitize(name) {
    return name.replace(/[^A-Za-z0-9_-]/g, '_');
}
export function imageName(name, viewport) {
    return `${sanitize(name)}__${viewportKey(viewport)}.png`;
}
export function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
export function fileExists(filePath) {
    return fs.existsSync(filePath);
}
