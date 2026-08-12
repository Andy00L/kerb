"use client";

/**
 * System 13 menu: a trigger with rotating chevron and a popover panel that
 * rises 4px while fading in. Outside clicks and Escape dismiss; radio items
 * carry a check mark.
 *
 * The panel is portaled to <body> with fixed coordinates: entrance
 * animations up the tree (.rise, fill-mode both) keep composited stacking
 * contexts alive in Chromium, so an in-place absolute panel gets painted
 * over by later siblings no matter its z-index.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconChevronDown } from "./icons";

export interface MenuItemDef {
  readonly value: string;
  readonly label: ReactNode;
}

interface MenuProps {
  readonly label: ReactNode;
  readonly items: ReadonlyArray<MenuItemDef>;
  readonly value?: string;
  readonly onPick: (value: string) => void;
  readonly ariaLabel: string;
  readonly buttonClassName?: string;
  readonly align?: "left" | "right";
}

interface PanelPosition {
  readonly top: number;
  readonly left: number | null;
  readonly right: number | null;
}

export function Menu({
  label,
  items,
  value,
  onPick,
  ariaLabel,
  buttonClassName = "btn btn-compact",
  align = "right",
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const place = (): void => {
    const trigger = triggerRef.current;
    if (trigger === null) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 6,
      left: align === "left" ? rect.left : null,
      right: align === "left" ? null : window.innerWidth - rect.right,
    });
  };

  // Synchronizes with document-level pointer, key, scroll and resize events,
  // systems React does not own: a click outside or Escape dismisses, and the
  // fixed panel follows its trigger while the page moves.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) !== true &&
        panelRef.current?.contains(target) !== true
      ) {
        setOpen(false);
      }
    };
    const onDocKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onMove = (): void => {
      place();
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onDocKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onDocKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
    // place() reads refs only; align is stable for a given menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        onClick={(event) => {
          event.stopPropagation();
          if (!open) {
            place();
          }
          setOpen((current) => !current);
        }}
      >
        {label}
        <IconChevronDown />
      </button>
      {open && position !== null
        ? createPortal(
            <div
              ref={panelRef}
              className="menu"
              role="menu"
              aria-label={ariaLabel}
              style={{
                top: position.top,
                left: position.left ?? undefined,
                right: position.right ?? undefined,
              }}
            >
              {items.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className="mitem num"
                  role="menuitemradio"
                  aria-checked={value === item.value}
                  onClick={() => {
                    onPick(item.value);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <span>{item.label}</span>
                  <span className="ck">
                    <IconCheck />
                  </span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
