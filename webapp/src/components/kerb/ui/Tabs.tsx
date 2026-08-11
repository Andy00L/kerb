"use client";

/**
 * Signature B: segmented control with the sliding pill indicator. The pill is
 * an aria-hidden div behind the buttons; it animates width and translateX to
 * hug the selected tab. Arrow keys move the selection.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

export interface TabItem<T extends string> {
  readonly id: T;
  readonly label: ReactNode;
  readonly ariaLabel?: string;
}

interface TabsProps<T extends string> {
  readonly tabs: ReadonlyArray<TabItem<T>>;
  readonly selected: T;
  readonly onSelect: (id: T) => void;
  readonly ariaLabel: string;
  readonly className?: string;
  readonly pillStyle?: CSSProperties;
}

export function Tabs<T extends string>({
  tabs,
  selected,
  onSelect,
  ariaLabel,
  className,
  pillStyle,
}: TabsProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  const move = useCallback(() => {
    const track = trackRef.current;
    const pill = pillRef.current;
    if (track === null || pill === null) {
      return;
    }
    const active = track.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    if (active === null) {
      return;
    }
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.transform = `translateX(${active.offsetLeft - 3}px)`;
  }, []);

  useLayoutEffect(move, [move, selected, tabs.length]);

  // Repositions when the viewport or the loaded font changes glyph widths.
  useEffect(() => {
    let disposed = false;
    window.addEventListener("resize", move);
    if (typeof document !== "undefined" && document.fonts !== undefined) {
      void document.fonts.ready.then(() => {
        if (!disposed) {
          move();
        }
      });
    }
    return () => {
      disposed = true;
      window.removeEventListener("resize", move);
    };
  }, [move]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === selected);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onSelect(next.id);
    trackRef.current
      ?.querySelectorAll<HTMLElement>('[role="tab"]')
      [(index + step + tabs.length) % tabs.length]?.focus();
  };

  return (
    <div
      ref={trackRef}
      className={className === undefined ? "tabs" : `tabs ${className}`}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      <div ref={pillRef} className="pill" aria-hidden style={pillStyle} />
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === selected}
          aria-label={tab.ariaLabel}
          tabIndex={tab.id === selected ? 0 : -1}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
