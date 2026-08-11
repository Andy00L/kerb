"use client";

/**
 * Signature A: the per-digit blur-morph ticker.
 *
 * Each glyph sits in its own cell holding an invisible ghost (width) plus the
 * visible span. When the value changes, only the digits that actually changed
 * animate: the old one blurs out downward, the new one drops in from above.
 * Separators never move. `masked` renders dots while the ghosts keep holding
 * the real widths, so toggling privacy shifts zero pixels of layout.
 */

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from "react";

const GLYPH = /[0-9•]/;

interface TickerProps {
  readonly value: string;
  readonly masked?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function Ticker({ value, masked = false, className, style }: TickerProps) {
  const display = masked ? value.replace(/[0-9]/g, "•") : value;
  const prevRef = useRef<string | null>(null);
  const prev = prevRef.current;

  // Commits after paint so both StrictMode renders see the same previous value.
  useEffect(() => {
    prevRef.current = display;
  });

  const cells = [...display].map((ch, index) => {
    if (!GLYPH.test(ch)) {
      return (
        <span key={`s${index}`} className="sep">
          {ch === " " ? " " : ch}
        </span>
      );
    }
    const ghost = masked ? (value[index] ?? ch) : ch;
    const old = prev?.[index];
    const changed =
      prev !== null &&
      prev !== display &&
      old !== undefined &&
      old !== ch &&
      GLYPH.test(old);
    return (
      <span key={`c${index}`} className="cell">
        <span aria-hidden className="ghost">
          {ghost}
        </span>
        {changed ? (
          <Fragment key={display}>
            <span className="live out">{old}</span>
            <span className="live in">{ch}</span>
          </Fragment>
        ) : (
          <span className="live">{ch}</span>
        )}
      </span>
    );
  });

  return (
    <span
      aria-hidden
      className={className === undefined ? "tk num" : `tk num ${className}`}
      style={style}
    >
      {cells}
    </span>
  );
}

/**
 * Whole-word blur-morph (Sell to Buy in the create summary). The single cell
 * carries an explicit width measured from the ghost, so the width glides with
 * the same 280ms ease as the digits.
 */
export function WordMorph({
  word,
  className,
}: {
  readonly word: string;
  readonly className?: string;
}) {
  const prevRef = useRef<string | null>(null);
  const cellRef = useRef<HTMLSpanElement>(null);
  const ghostRef = useRef<HTMLSpanElement>(null);
  const prev = prevRef.current;
  const changed = prev !== null && prev !== word;

  useEffect(() => {
    prevRef.current = word;
  });

  // Pins the cell width to the ghost width; explicit-to-explicit transitions.
  useLayoutEffect(() => {
    const cell = cellRef.current;
    const ghost = ghostRef.current;
    if (cell === null || ghost === null) {
      return;
    }
    cell.style.width = `${ghost.offsetWidth}px`;
  }, [word]);

  return (
    <span
      aria-hidden
      className={className === undefined ? "tk" : `tk ${className}`}
    >
      <span ref={cellRef} className="cell">
        <span ref={ghostRef} aria-hidden className="ghost">
          {word}
        </span>
        {changed ? (
          <Fragment key={word}>
            <span className="live out">{prev}</span>
            <span className="live in">{word}</span>
          </Fragment>
        ) : (
          <span className="live">{word}</span>
        )}
      </span>
    </span>
  );
}
