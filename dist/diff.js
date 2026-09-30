import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
const CELL_SIZE = 24;
const CELL_ACTIVATION_MIN_PIXELS = 3;
export function compareImages(baselineBuf, currentBuf, pixelSensitivity) {
    const baseline = PNG.sync.read(baselineBuf);
    const current = PNG.sync.read(currentBuf);
    if (baseline.width !== current.width || baseline.height !== current.height) {
        return {
            sizeMismatch: true,
            width: current.width,
            height: current.height,
            diffPixelCount: Math.max(baseline.width * baseline.height, current.width * current.height),
            totalPixels: Math.max(baseline.width * baseline.height, current.width * current.height),
            similarity: 0,
            regions: [],
        };
    }
    const { width, height } = baseline;
    const diff = new PNG({ width, height });
    const diffPixelCount = pixelmatch(baseline.data, current.data, diff.data, width, height, {
        threshold: pixelSensitivity,
    });
    const totalPixels = width * height;
    const similarity = 1 - diffPixelCount / totalPixels;
    // pixelmatch's default (visual) output paints every pixel — a faded grey
    // for matches, the diff color for real differences — so its alpha channel
    // isn't a valid "did this pixel change" mask. Run it a second time with
    // diffMask:true, which is fully transparent except on real diff pixels,
    // purely to build the mask that region clustering needs.
    const mask = new PNG({ width, height });
    pixelmatch(baseline.data, current.data, mask.data, width, height, {
        threshold: pixelSensitivity,
        diffMask: true,
    });
    const regions = clusterDiffRegions(mask, width, height, diffPixelCount);
    return {
        sizeMismatch: false,
        width,
        height,
        diffPixelCount,
        totalPixels,
        similarity,
        regions,
        diffImageBuffer: PNG.sync.write(diff),
    };
}
/**
 * Connected-component clustering over a coarse grid of the pixelmatch diff
 * mask. Produces real bounding boxes from actual differing pixels — the
 * original framework this was extracted from generated fake region
 * coordinates from a hash of the URL string.
 */
function clusterDiffRegions(diff, width, height, totalDiffPixels) {
    const cols = Math.ceil(width / CELL_SIZE);
    const rows = Math.ceil(height / CELL_SIZE);
    const cellCounts = new Int32Array(cols * rows);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (width * y + x) * 4;
            const alpha = diff.data[idx + 3];
            if (alpha > 0) {
                const cellX = Math.floor(x / CELL_SIZE);
                const cellY = Math.floor(y / CELL_SIZE);
                cellCounts[cellY * cols + cellX]++;
            }
        }
    }
    const visited = new Uint8Array(cols * rows);
    const regions = [];
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            const cellIdx = cy * cols + cx;
            if (visited[cellIdx] || cellCounts[cellIdx] < CELL_ACTIVATION_MIN_PIXELS)
                continue;
            let minCx = cx;
            let maxCx = cx;
            let minCy = cy;
            let maxCy = cy;
            let regionDiffPixels = 0;
            const stack = [[cx, cy]];
            visited[cellIdx] = 1;
            while (stack.length) {
                const [x, y] = stack.pop();
                const idx = y * cols + x;
                regionDiffPixels += cellCounts[idx];
                minCx = Math.min(minCx, x);
                maxCx = Math.max(maxCx, x);
                minCy = Math.min(minCy, y);
                maxCy = Math.max(maxCy, y);
                const neighbors = [
                    [x - 1, y],
                    [x + 1, y],
                    [x, y - 1],
                    [x, y + 1],
                ];
                for (const [nx, ny] of neighbors) {
                    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows)
                        continue;
                    const nIdx = ny * cols + nx;
                    if (!visited[nIdx] && cellCounts[nIdx] >= CELL_ACTIVATION_MIN_PIXELS) {
                        visited[nIdx] = 1;
                        stack.push([nx, ny]);
                    }
                }
            }
            const rx = minCx * CELL_SIZE;
            const ry = minCy * CELL_SIZE;
            const rw = Math.min((maxCx - minCx + 1) * CELL_SIZE, width - rx);
            const rh = Math.min((maxCy - minCy + 1) * CELL_SIZE, height - ry);
            const share = totalDiffPixels > 0 ? regionDiffPixels / totalDiffPixels : 0;
            regions.push({
                x: rx,
                y: ry,
                width: rw,
                height: rh,
                diffPixelCount: regionDiffPixels,
                significance: share > 0.4 ? 'high' : share > 0.15 ? 'medium' : 'low',
            });
        }
    }
    return regions.sort((a, b) => b.diffPixelCount - a.diffPixelCount);
}
