/**
 * Deterministic demo chart series. Same seed, same curve: range flips redraw
 * a stable shape instead of a random one, and server and client agree.
 */

/** Small deterministic PRNG (mulberry32). */
export function mulberry(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(key: string): number {
  let seed = 7;
  for (const ch of key) {
    seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  }
  return seed;
}

/**
 * Random-walk series for a range key. `endValue` pins the last point (the
 * live price) by scaling the walk progressively toward it, so the curve
 * always lands exactly on the number the ticker shows.
 */
export function buildRangeSeries(
  key: string,
  pointCount: number,
  endValue: number,
): number[] {
  const random = mulberry(seedOf(key));
  const values: number[] = [];
  let value = endValue * (0.86 + random() * 0.06);
  for (let index = 0; index < pointCount; index += 1) {
    value = value * (1 + (random() - 0.465) * 0.014);
    values.push(value);
  }
  const scale = endValue / values[pointCount - 1];
  return values.map((walked, index) =>
    walked * Math.pow(scale, index / (pointCount - 1)),
  );
}
