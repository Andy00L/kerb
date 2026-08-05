"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./HeroArtifact.module.css";

const ARTIFACT_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["Pair", "XRP/USD"],
  ["Trigger", "2.6500"],
  ["Slice", "100.00 XRP"],
  ["Jitter", "15%"],
  ["Max slippage", "0.50%"],
  ["Expiry", "Aug 12, 14:30"],
];

function computeBarWidth(value: string): number {
  return Math.min(140, Math.max(40, value.length * 9));
}

/**
 * The hero artifact: a mandate document whose values are readable for a
 * beat, then wipe into redaction bars. Rendered SEALED by default, so a
 * viewer without JavaScript (or with reduced motion) sees the resolved,
 * truthful state; the unseal loop is progressive enhancement.
 */
export function HeroArtifact() {
  const [sealed, setSealed] = useState(true);
  const [instant, setInstant] = useState(true);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  // Synchronizes with matchMedia and wall-clock timers for the loop.
  useEffect(() => {
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      return;
    }
    const timers = timersRef.current;
    const schedule = (delayMs: number, run: () => void): void => {
      timers.push(setTimeout(run, delayMs));
    };
    const loop = (): void => {
      // Unseal with a clean cut, hold readable, then wipe sealed again.
      schedule(1_000, () => {
        setInstant(true);
        setSealed(false);
        schedule(4_200, () => {
          setInstant(false);
          setSealed(true);
          schedule(4_800, loop);
        });
      });
    };
    loop();
    return () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
    };
  }, []);

  return (
    <div className={styles.artifact}>
      <div className={styles.artifactHead}>
        <span className="chip">Mandate #7</span>
        <span
          className={`${styles.capSealed} mono`}
          style={{ opacity: sealed ? 1 : 0 }}
        >
          Sealed in TEE
        </span>
      </div>
      <div className="hairlineSolid" style={{ margin: "16px 0 4px" }} />
      {ARTIFACT_ROWS.map(([label, value], index) => {
        const durationMs = instant ? 0 : 400;
        const delayMs = instant ? 0 : index * 40;
        return (
          <div
            key={label}
            className={styles.artifactRow}
            style={index === 0 ? { borderTop: "none" } : undefined}
          >
            <span className={styles.artifactLabel}>{label}</span>
            <span className={`${styles.artifactValue} mono`}>
              <span
                style={{
                  opacity: sealed ? 0 : 1,
                  transition: `opacity ${durationMs}ms cubic-bezier(0.4,0,0.2,1) ${delayMs}ms`,
                }}
              >
                {value}
              </span>
              <span
                className={styles.artifactBar}
                style={{
                  width: `${computeBarWidth(value)}px`,
                  clipPath: sealed ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
                  transition: `clip-path ${durationMs}ms cubic-bezier(0,0,0.2,1) ${delayMs}ms`,
                }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
