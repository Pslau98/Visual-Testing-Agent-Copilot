import * as fs from 'node:fs';
import * as path from 'node:path';
export function summarize(results, durationMs) {
    return {
        totalTests: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        newBaselines: results.filter((r) => r.status === 'baseline-created').length,
        durationMs,
        results,
    };
}
export function writeJsonReport(summary, filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(summary, null, 2));
}
export function writeMarkdownReport(summary, filePath) {
    const lines = [];
    lines.push('# Visual Regression Test Report');
    lines.push('');
    lines.push(`- Total: ${summary.totalTests}`);
    lines.push(`- Passed: ${summary.passed}`);
    lines.push(`- Failed: ${summary.failed}`);
    lines.push(`- New baselines: ${summary.newBaselines}`);
    lines.push(`- Duration: ${summary.durationMs}ms`);
    lines.push('');
    lines.push('| Test | Viewport | Status | Similarity | Diff % | Regions |');
    lines.push('|------|----------|--------|-----------|--------|---------|');
    for (const r of summary.results) {
        lines.push(`| ${r.name} | ${r.viewport} | ${r.status} | ${(r.similarity * 100).toFixed(2)}% | ${r.diffPercentage.toFixed(3)}% | ${r.regions.length} |`);
    }
    const failing = summary.results.filter((r) => !r.passed && r.status !== 'baseline-created');
    if (failing.length) {
        lines.push('');
        lines.push('## Regressions');
        for (const r of failing) {
            lines.push('');
            lines.push(`### ${r.name} (${r.viewport})`);
            lines.push(`- Status: ${r.status}`);
            lines.push(`- Similarity: ${(r.similarity * 100).toFixed(2)}%`);
            lines.push(`- Diff pixels: ${r.diffPixelCount} / ${r.totalPixels}`);
            if (r.diffImagePath)
                lines.push(`- Diff image: ${r.diffImagePath}`);
            if (r.regions.length) {
                lines.push('- Regions:');
                for (const region of r.regions.slice(0, 5)) {
                    lines.push(`  - (${region.x}, ${region.y}) ${region.width}x${region.height} — ${region.significance} significance, ${region.diffPixelCount}px`);
                }
            }
        }
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.join('\n'));
}
function relImg(reportDir, imagePath) {
    return path.relative(reportDir, imagePath).split(path.sep).join('/');
}
function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function regionOverlays(r) {
    if (!r.width || !r.height)
        return '';
    return r.regions
        .map((region) => {
        const left = (region.x / r.width) * 100;
        const top = (region.y / r.height) * 100;
        const width = (region.width / r.width) * 100;
        const height = (region.height / r.height) * 100;
        const color = region.significance === 'high' ? '#ff3b30' : region.significance === 'medium' ? '#ff9500' : '#ffcc00';
        return `<div class="region region-${region.significance}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%;border-color:${color}" title="${region.significance} — ${region.diffPixelCount}px"></div>`;
    })
        .join('');
}
/**
 * Self-contained HTML report with baseline/current/diff images side by side
 * per failing test, and the detected regions drawn as overlays scaled to
 * the displayed image size. Meant to be opened directly in a browser, or
 * embedded/linked from a host test framework's own failure report.
 */
export function writeHtmlReport(summary, filePath) {
    const reportDir = path.dirname(filePath);
    const rows = summary.results
        .map((r) => {
        const statusClass = r.passed ? 'pass' : 'fail';
        return `<tr class="${statusClass}">
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.viewport)}</td>
        <td>${escapeHtml(r.status)}</td>
        <td>${(r.similarity * 100).toFixed(2)}%</td>
        <td>${r.diffPercentage.toFixed(3)}%</td>
        <td>${r.regions.length}</td>
      </tr>`;
    })
        .join('\n');
    const failing = summary.results.filter((r) => !r.passed && r.status !== 'baseline-created');
    const diffCards = failing
        .map((r) => {
        const baselineSrc = relImg(reportDir, r.baselinePath);
        const currentSrc = relImg(reportDir, r.currentPath);
        const diffSrc = r.diffImagePath ? relImg(reportDir, r.diffImagePath) : null;
        const regionsList = r.regions
            .slice(0, 10)
            .map((region) => `<li><span class="tag tag-${region.significance}">${region.significance}</span> (${region.x}, ${region.y}) ${region.width}×${region.height}px — ${region.diffPixelCount}px changed</li>`)
            .join('');
        return `<section class="diff-card">
        <h3>${escapeHtml(r.name)} <span class="muted">@ ${escapeHtml(r.viewport)}</span></h3>
        <p class="muted">${r.status} — similarity ${(r.similarity * 100).toFixed(2)}%, ${r.diffPixelCount} / ${r.totalPixels} px differ${r.perceptualSimilarity !== undefined ? `, structural similarity ${(r.perceptualSimilarity * 100).toFixed(2)}%` : ''}</p>
        <div class="images">
          <figure><img src="${baselineSrc}" alt="baseline"><figcaption>Baseline</figcaption></figure>
          <figure><img src="${currentSrc}" alt="current"><figcaption>Current</figcaption></figure>
          <figure class="overlay-figure">
            <div class="overlay-wrap">
              <img src="${diffSrc ?? currentSrc}" alt="diff">
              ${regionOverlays(r)}
            </div>
            <figcaption>Diff${diffSrc ? '' : ' (no pixel diff image — size mismatch)'}</figcaption>
          </figure>
        </div>
        ${regionsList ? `<ul class="regions">${regionsList}</ul>` : ''}
      </section>`;
    })
        .join('\n');
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Visual Regression Report</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; background: #0b0d12; color: #e6e8eb; }
  h1 { font-size: 20px; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0 32px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #262a33; font-size: 13px; }
  tr.fail td:nth-child(3) { color: #ff5b52; font-weight: 600; }
  tr.pass td:nth-child(3) { color: #34d399; }
  .muted { color: #9aa0aa; font-weight: normal; font-size: 13px; }
  .diff-card { border: 1px solid #262a33; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
  .images { display: flex; gap: 16px; flex-wrap: wrap; }
  figure { margin: 0; flex: 1 1 280px; max-width: 420px; }
  figure img { width: 100%; border: 1px solid #262a33; border-radius: 4px; display: block; }
  figcaption { text-align: center; font-size: 12px; color: #9aa0aa; margin-top: 4px; }
  .overlay-wrap { position: relative; line-height: 0; }
  .region { position: absolute; border: 2px solid; background: rgba(255,59,48,0.12); pointer-events: none; }
  .regions { font-size: 12px; margin-top: 12px; padding-left: 18px; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; text-transform: uppercase; margin-right: 6px; }
  .tag-high { background: #ff3b30; color: #fff; }
  .tag-medium { background: #ff9500; color: #fff; }
  .tag-low { background: #ffcc00; color: #333; }
</style>
</head>
<body>
  <h1>Visual Regression Report</h1>
  <p class="muted">Total ${summary.totalTests} · Passed ${summary.passed} · Failed ${summary.failed} · New baselines ${summary.newBaselines} · ${summary.durationMs}ms</p>
  <table>
    <thead><tr><th>Test</th><th>Viewport</th><th>Status</th><th>Similarity</th><th>Diff %</th><th>Regions</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${failing.length ? `<h2>Regressions</h2>${diffCards}` : '<p>No regressions.</p>'}
</body>
</html>`;
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(filePath, html);
}
