/** 16px stroke icon set from the design returns; 1.8px rounded strokes. */

interface IconProps {
  readonly size?: number;
}

function frame(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export function IconChevronDown({ size = 16 }: IconProps) {
  return (
    <svg
      className="chev"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M11.36 6.36a.9.9 0 0 1 1.28 1.28l-4 4a.9.9 0 0 1-1.28 0l-4-4a.9.9 0 0 1 1.28-1.28L8 9.73l3.36-3.37Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export function IconArrowRight({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" />
    </svg>
  );
}

export function IconPlus({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M7.1 13V8.9H3a.9.9 0 0 1 0-1.8h4.1V3a.9.9 0 0 1 1.8 0v4.1H13a.9.9 0 0 1 0 1.8H8.9V13a.9.9 0 0 1-1.8 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function IconBell({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M8 2a4 4 0 0 1 4 4v2.5l1.2 2.2a.7.7 0 0 1-.6 1.1H3.4a.7.7 0 0 1-.6-1.1L4 8.5V6a4 4 0 0 1 4-4Z" />
      <path d="M6.5 13.5a1.6 1.6 0 0 0 3 0" />
    </svg>
  );
}

export function IconEye({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8Z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

export function IconEyeOff({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8Z" />
      <circle cx="8" cy="8" r="2" />
      <path d="M2.5 2.5l11 11" />
    </svg>
  );
}

export function IconStar({ size = 16, fill = "currentColor" }: IconProps & { fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6.8 1.1a1.5 1.5 0 0 1 2.38 0l.12.18 1.72 3.05 3.43.7a1.5 1.5 0 0 1 .8 2.48l-2.37 2.58.4 3.48a1.5 1.5 0 0 1-2.11 1.54L8 13.65l-3.19 1.46A1.5 1.5 0 0 1 2.7 13.57l.4-3.48L.73 7.51a1.5 1.5 0 0 1 .8-2.48l3.44-.7 1.72-3.05.11-.18Z"
        fill={fill}
      />
    </svg>
  );
}

export function IconCopy({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="2" />
      <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </svg>
  );
}

export function IconCheck({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

export function IconClose({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconHome({ size = 18 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M2.5 6.5 8 2l5.5 4.5V13a1 1 0 0 1-1 1H9.5v-3.5h-3V14H3.5a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

export function IconSearch({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}

export function IconRows({ size = 18 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M5.5 4h8.3M5.5 8h8.3M5.5 12h8.3M2.2 4h.1M2.2 8h.1M2.2 12h.1" />
    </svg>
  );
}

export function IconActivity({ size = 18 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M1.5 8h3l2-4.5 3 9 2-4.5h3" />
    </svg>
  );
}

export function IconSliders({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M2 5h5.5M12.5 5H14M2 11h1.5M8.5 11H14" />
      <circle cx="10" cy="5" r="1.9" />
      <circle cx="6" cy="11" r="1.9" />
    </svg>
  );
}

export function IconCandles({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M5 1.6v2M5 12.4v2M11 2.6v1.6M11 10.2v2.2"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <rect x="3.6" y="4" width="2.8" height="8" rx="1" fill="currentColor" />
      <rect x="9.6" y="4.4" width="2.8" height="5.6" rx="1" fill="currentColor" />
    </svg>
  );
}

export function IconLine({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M2 11.5 6 7.5l2.5 2.5L14 4.5" />
    </svg>
  );
}

export function IconFullscreen({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M6 2.5H4A1.5 1.5 0 0 0 2.5 4v2M10 2.5h2A1.5 1.5 0 0 1 13.5 4v2M6 13.5H4A1.5 1.5 0 0 1 2.5 12v-2M10 13.5h2a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </svg>
  );
}

export function IconRail({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" />
      <path d="M6 2.5v11" />
    </svg>
  );
}

export function IconLock({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <rect x="3" y="6.5" width="10" height="7" rx="2" />
      <path d="M5.5 6.5V5a2.5 2.5 0 0 1 5 0v1.5" />
    </svg>
  );
}

export function IconShield({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M8 1.8 13.5 4v4c0 3.2-2.3 5.4-5.5 6.2C4.8 13.4 2.5 11.2 2.5 8V4Z" />
      <path d="M5.5 8l1.8 1.8L10.8 6" />
    </svg>
  );
}

export function IconSlices({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M2.5 4.5h11M2.5 8h7M2.5 11.5h9.5" />
    </svg>
  );
}

export function IconOpen({ size = 16 }: IconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M5 11l6-6M6.5 4.5h5v5" />
    </svg>
  );
}
