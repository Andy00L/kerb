"use client";

/**
 * System 13 menu: a trigger with rotating chevron and a popover panel that
 * rises 4px while fading in. Outside clicks and Escape dismiss; radio items
 * carry a check mark.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Synchronizes with document-level pointer and key events, systems React
  // does not own: a click outside or Escape dismisses the panel.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocClick = (event: MouseEvent): void => {
      const wrap = wrapRef.current;
      if (wrap !== null && !wrap.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onDocKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onDocKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onDocKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="menuwrap">
      <button
        ref={triggerRef}
        type="button"
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        {label}
        <IconChevronDown />
      </button>
      <div
        className={`menu${open ? " open" : ""}${align === "left" ? " left" : ""}`}
        role="menu"
        aria-label={ariaLabel}
      >
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            className="mitem num"
            role="menuitemradio"
            aria-checked={value === item.value}
            tabIndex={open ? 0 : -1}
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
      </div>
    </div>
  );
}
