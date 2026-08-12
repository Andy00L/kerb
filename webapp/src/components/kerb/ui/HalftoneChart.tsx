"use client";

/**
 * Signature C: the halftone line chart. The area under the line is a gradient
 * masked by a 2x2 dot pattern (tiny dots fading downward), the line is drawn
 * twice (soft glow underneath, crisp on top), and the last point carries the
 * pulsing cursor. `swapKey` remounts the paths with a 300ms fade on range
 * changes; an optional crosshair reports the hovered point. The candles
 * variant buckets the same series into OHLC bodies and wicks.
 */

import { useId, useMemo, useState, type PointerEvent } from "react";

interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

interface Candle {
  readonly x: number;
  readonly bodyWidth: number;
  readonly yBody: number;
  readonly bodyHeight: number;
  readonly yHigh: number;
  readonly yLow: number;
  readonly up: boolean;
}

interface HalftoneChartProps {
  readonly series: readonly number[];
  readonly width?: number;
  readonly height?: number;
  readonly padTop?: number;
  readonly padBottom?: number;
  readonly swapKey?: string;
  readonly className?: string;
  readonly heightPx?: number;
  readonly variant?: "line" | "candles";
  /** Label shown at the crosshair per point index; enables hover when set. */
  readonly hoverLabels?: readonly string[];
  readonly onHoverPoint?: (index: number | null) => void;
}

export function HalftoneChart({
  series,
  width = 916,
  height = 248,
  padTop = 18,
  padBottom = 14,
  swapKey = "",
  className,
  heightPx,
  variant = "line",
  hoverLabels,
  onHoverPoint,
}: HalftoneChartProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { linePath, areaPath, points, valueToY } = useMemo(() => {
    const count = series.length;
    const flatY = (): number => height / 2;
    if (count < 2) {
      return {
        linePath: "",
        areaPath: "",
        points: [] as ChartPoint[],
        valueToY: flatY,
      };
    }
    let min = series[0];
    let max = series[0];
    for (const value of series) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const range = max - min || 1;
    const toY = (value: number): number =>
      padTop + (1 - (value - min) / range) * (height - padTop - padBottom);
    const pts = series.map((value, index) => ({
      x: (index / (count - 1)) * width,
      y: toY(value),
    }));
    const line = `M${pts
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join(" L")}`;
    return {
      linePath: line,
      areaPath: `${line} L${width},${height} L0,${height} Z`,
      points: pts,
      valueToY: toY,
    };
  }, [series, width, height, padTop, padBottom]);

  // Candles reuse the exact same value-to-y scale as the line, so toggling
  // styles never rescales the chart under the viewer.
  const candles = useMemo((): Candle[] => {
    const count = series.length;
    if (variant !== "candles" || count < 2 || points.length !== count) {
      return [];
    }
    const bucketSize = Math.max(2, Math.floor(count / 24));
    const result: Candle[] = [];
    for (let start = 0; start < count; start += bucketSize) {
      const bucket = series.slice(start, start + bucketSize);
      const open = bucket[0];
      const close = bucket[bucket.length - 1];
      let high = bucket[0];
      let low = bucket[0];
      for (const value of bucket) {
        high = Math.max(high, value);
        low = Math.min(low, value);
      }
      const xStart = points[start].x;
      const xEnd =
        points[Math.min(count - 1, start + bucketSize - 1)].x || xStart;
      const slotWidth = Math.max(4, xEnd - xStart);
      const yOpen = valueToY(open);
      const yClose = valueToY(close);
      result.push({
        x: xStart + slotWidth * 0.2,
        bodyWidth: slotWidth * 0.6,
        yBody: Math.min(yOpen, yClose),
        bodyHeight: Math.max(1.5, Math.abs(yOpen - yClose)),
        yHigh: valueToY(high),
        yLow: valueToY(low),
        up: close >= open,
      });
    }
    return result;
  }, [variant, series, points, valueToY]);

  const last = points.length > 0 ? points[points.length - 1] : null;
  const hoverEnabled = hoverLabels !== undefined && points.length > 1;

  const handleMove = (event: PointerEvent<SVGSVGElement>): void => {
    if (!hoverEnabled) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const index = Math.max(
      0,
      Math.min(points.length - 1, Math.round((x / width) * (points.length - 1))),
    );
    setHoverIndex(index);
    onHoverPoint?.(index);
  };

  const handleLeave = (): void => {
    if (!hoverEnabled) {
      return;
    }
    setHoverIndex(null);
    onHoverPoint?.(null);
  };

  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{
        width: "100%",
        height: heightPx ?? height,
        display: "block",
        overflow: "visible",
      }}
      aria-hidden
      onPointerMove={hoverEnabled ? handleMove : undefined}
      onPointerLeave={hoverEnabled ? handleLeave : undefined}
    >
      <defs>
        <linearGradient
          id={`${uid}area`}
          x1="0%"
          x2="0%"
          y1="0%"
          y2="100%"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#409652" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#0d0d0d" stopOpacity="0" />
        </linearGradient>
        <pattern
          id={`${uid}dots`}
          x="0"
          y="0"
          width="2"
          height="2"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r="0.5" fill="white" />
        </pattern>
        <mask id={`${uid}mask`}>
          <rect width={width} height={height} fill={`url(#${uid}dots)`} />
        </mask>
      </defs>
      <g key={swapKey} className="chartswap">
        {variant === "candles" ? (
          candles.map((candle) => {
            const color = candle.up ? "#37bc65" : "#e5544b";
            const center = candle.x + candle.bodyWidth / 2;
            return (
              <g key={candle.x}>
                <line
                  x1={center}
                  x2={center}
                  y1={candle.yHigh}
                  y2={candle.yLow}
                  stroke={color}
                  strokeWidth={1}
                  opacity={0.6}
                />
                <rect
                  x={candle.x}
                  y={candle.yBody}
                  width={candle.bodyWidth}
                  height={candle.bodyHeight}
                  rx={1}
                  fill={color}
                />
              </g>
            );
          })
        ) : (
          <>
            <path
              d={areaPath}
              fill={`url(#${uid}area)`}
              mask={`url(#${uid}mask)`}
              strokeWidth={0}
            />
            <path
              d={linePath}
              stroke="#37bc65"
              strokeWidth={1.5}
              fill="transparent"
              opacity={0.2}
            />
            <path d={linePath} stroke="#37bc65" strokeWidth={1.5} fill="transparent" />
          </>
        )}
      </g>
      {hoverPoint !== null && hoverIndex !== null ? (
        <g pointerEvents="none">
          <line
            x1={hoverPoint.x}
            x2={hoverPoint.x}
            y1={0}
            y2={height}
            stroke="rgba(252,252,252,0.14)"
            strokeWidth={1}
          />
          <text
            x={Math.max(28, Math.min(width - 28, hoverPoint.x))}
            y={12}
            fill="#8f8b88"
            fontSize={11}
            textAnchor="middle"
          >
            {hoverLabels?.[hoverIndex]}
          </text>
        </g>
      ) : null}
      {last !== null ? (
        <>
          <circle className="pulse" cx={last.x} cy={last.y} r={3.3} fill="#37bc65" />
          <circle cx={last.x} cy={last.y} r={3.3} fill="#37bc65" />
        </>
      ) : null}
    </svg>
  );
}
