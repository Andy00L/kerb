import { buildThreadPoints } from "@/lib/thread";
import styles from "./PriceThread.module.css";

interface PriceThreadProps {
  readonly heightPx: number;
  readonly bandTopPx: number;
  readonly bandHeightPx: number;
  readonly caption?: string;
  /** Draw-on entrance (the detail screen's single hero move). */
  readonly drawOnEnter?: boolean;
  /** Slow horizontal drift for the marketing surface. */
  readonly drifting?: boolean;
}

/**
 * The live price thread crossed by the hatched occlusion band: a trigger
 * zone exists, but where the line sits inside it stays unreadable. The
 * band's edges are feathered by a mask so the exact threshold cannot be
 * inferred.
 */
export function PriceThread({
  heightPx,
  bandTopPx,
  bandHeightPx,
  caption,
  drawOnEnter = false,
  drifting = false,
}: PriceThreadProps) {
  const points = buildThreadPoints(72, 1020, heightPx * 0.31, 0.52);

  return (
    <div className={styles.stage} style={{ height: `${heightPx}px` }}>
      <svg
        viewBox={`0 0 1020 ${heightPx}`}
        preserveAspectRatio="none"
        className={drifting ? styles.threadDrifting : styles.thread}
        aria-hidden="true"
      >
        <polyline
          points={points}
          pathLength={1}
          fill="none"
          stroke="var(--ink-muted)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          className={drawOnEnter ? styles.drawn : undefined}
        />
      </svg>
      <div
        className={drawOnEnter ? `${styles.band} ${styles.bandLate}` : styles.band}
        style={{ top: `${bandTopPx}px`, height: `${bandHeightPx}px` }}
      >
        {caption === undefined ? null : (
          <span className={`eyebrow ${styles.caption}`}>{caption}</span>
        )}
      </div>
    </div>
  );
}
