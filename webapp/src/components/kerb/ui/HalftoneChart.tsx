"use client";

/**
 * Signature C: the halftone line chart. The area under the line is a gradient
 * masked by a 2x2 dot pattern (tiny dots fading downward), the line is drawn
 * twice (soft glow underneath, crisp on top), and the last point carries the
 * pulsing cursor. `swapKey` remounts the paths with a 300ms fade on range
 * changes; an optional crosshair reports the hovered point.
 */

import { useId, useMemo, useState, type PointerEvent } from "react";

interface ChartPoint {
  readonly x: number;
  readonly y: number;
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
  hoverLabels,
  onHoverPoint,
}: HalftoneChartProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { linePath, areaPath, points } = useMemo(() => {
    const count = series.length;
    if (count < 2) {
      return { linePath: "", areaPath: "", points: [] as ChartPoint[] };
    }
    let min = series[0];
    let max = series[0];
    for (const value of series) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const range = max - min || 1;
    const pts = series.map((value, index) => ({
      x: (index / (count - 1)) * width,
      y: padTop + (1 - (value - min) / range) * (height - padTop - padBottom),
    }));
    const line = `M${pts
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join(" L")}`;
    return {
      linePath: line,
      areaPath: `${line} L${width},${height} L0,${height} Z`,
      points: pts,
    };
  }, [series, width, height, padTop, padBottom]);

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
