/**
 * Deterministic price-thread geometry.
 *
 * The landing and detail threads are drawn from a fixed pseudo-waveform so
 * server and client render identical markup (no hydration drift) and the
 * occlusion band can sit at a stable position.
 */

export function buildThreadPoints(
  pointCount: number,
  width: number,
  baseY: number,
  slope: number,
): string {
  const points: string[] = [];
  for (let index = 0; index <= pointCount; index += 1) {
    const x = (index / pointCount) * width;
    const y =
      baseY +
      index * slope +
      7 * Math.sin(index * 0.55 + 1.2) +
      5 * Math.sin(index * 0.21 + 0.4) +
      2.5 * Math.sin(index * 1.7);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}
