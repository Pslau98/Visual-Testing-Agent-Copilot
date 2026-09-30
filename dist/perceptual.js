/**
 * Deterministic structural-similarity heuristic: average RGB per grid cell
 * (spatial pooling), compared by cosine similarity. Tolerates minor
 * anti-aliasing/font-rendering noise that a strict pixel diff would flag.
 * This is plain math, not a trained model — it should never be described
 * as "AI" without that caveat.
 */
export function computeStructuralEmbedding(png, gridSize = 8) {
    const { width, height, data } = png;
    const cellW = width / gridSize;
    const cellH = height / gridSize;
    const embedding = new Float32Array(gridSize * gridSize * 3);
    const counts = new Float32Array(gridSize * gridSize);
    for (let y = 0; y < height; y++) {
        const gy = Math.min(gridSize - 1, Math.floor(y / cellH));
        for (let x = 0; x < width; x++) {
            const gx = Math.min(gridSize - 1, Math.floor(x / cellW));
            const cell = gy * gridSize + gx;
            const idx = (width * y + x) * 4;
            embedding[cell * 3] += data[idx];
            embedding[cell * 3 + 1] += data[idx + 1];
            embedding[cell * 3 + 2] += data[idx + 2];
            counts[cell]++;
        }
    }
    for (let cell = 0; cell < gridSize * gridSize; cell++) {
        const count = counts[cell] || 1;
        embedding[cell * 3] /= count;
        embedding[cell * 3 + 1] /= count;
        embedding[cell * 3 + 2] /= count;
    }
    return embedding;
}
export function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error(`Embedding length mismatch: ${a.length} vs ${b.length}`);
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 1 : dot / denom;
}
