"use client";

/**
 * Expiry date-time picker: a well-shaped trigger opening a calendar panel
 * (react-day-picker, the primitive under shadcn's Calendar, restyled to the
 * token sheet) plus a time field. Value stays the datetime-local string
 * ("YYYY-MM-DDTHH:mm") the form already validates.
 *
 * The panel is portaled to <body> with fixed coordinates for the same
 * reason as Menu: entrance animations up the tree keep composited stacking
 * contexts alive, and an in-place panel would be painted over.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { IconChevronDown } from "./icons";

interface DatePickerProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly ariaLabel: string;
  readonly hasError?: boolean;
  /** Fired when the panel closes; the form validates here (blur parity). */
  readonly onClose?: () => void;
}

const MONTH_WORDS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function parseValue(value: string): { day: Date | undefined; time: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (match === null) {
    return { day: undefined, time: "12:00" };
  }
  return {
    day: new Date(
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10) - 1,
      Number.parseInt(match[3], 10),
    ),
    time: match[4],
  };
}

function composeValue(day: Date, time: string): string {
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${time}`;
}

function triggerLabel(day: Date | undefined, time: string): string {
  if (day === undefined) {
    return "Pick a date";
  }
  return `${MONTH_WORDS[day.getMonth()]} ${day.getDate()}, ${day.getFullYear()}, ${time}`;
}

export function DatePicker({
  value,
  onChange,
  ariaLabel,
  hasError = false,
  onClose,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { day, time } = parseValue(value);

  const place = (): void => {
    const trigger = triggerRef.current;
    if (trigger === null) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    // Flip above the trigger when the panel would overflow the viewport;
    // before first paint the panel is unmeasured, the effect below re-places.
    const panelHeight = panelRef.current?.offsetHeight ?? 0;
    let top = rect.bottom + 6;
    if (panelHeight > 0 && top + panelHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - 6 - panelHeight);
    }
    setPosition({ top, left: rect.left });
  };

  const close = (): void => {
    setOpen(false);
    onClose?.();
  };

  // Re-places once the panel has a measured height, so a panel opened near
  // the bottom edge flips above its trigger instead of overflowing.
  useEffect(() => {
    if (open) {
      place();
    }
    // place reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Synchronizes with document-level pointer, key, scroll and resize events,
  // systems React does not own: outside click or Escape dismisses, and the
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
        close();
      }
    };
    const onDocKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        close();
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
    // close/place read refs and stable props only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={hasError ? "well err" : "well"}
        style={{ width: "100%", justifyContent: "space-between" }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          place();
          setOpen(true);
        }}
      >
        <span
          className="num"
          style={{ fontSize: 13, color: day === undefined ? "var(--ink-3)" : "var(--ink)" }}
        >
          {triggerLabel(day, time)}
        </span>
        <span style={{ color: "var(--ink-2)", display: "inline-flex" }}>
          <IconChevronDown />
        </span>
      </button>
      {open && position !== null
        ? createPortal(
            <div
              ref={panelRef}
              className="menu datecal"
              role="dialog"
              aria-label={`${ariaLabel} calendar`}
              style={{ top: position.top, left: position.left }}
            >
              <DayPicker
                mode="single"
                selected={day}
                defaultMonth={day}
                onSelect={(picked) => {
                  if (picked !== undefined) {
                    onChange(composeValue(picked, time));
                  }
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  borderTop: "1px solid var(--hairline)",
                  padding: "10px 6px 4px",
                }}
              >
                <span className="cap">Time</span>
                <div className="well" style={{ height: 32, padding: "0 10px" }}>
                  <input
                    type="time"
                    aria-label={`${ariaLabel} time`}
                    style={{ colorScheme: "dark", fontSize: 13 }}
                    value={time}
                    onChange={(event) => {
                      if (day !== undefined && event.target.value !== "") {
                        onChange(composeValue(day, event.target.value));
                      }
                    }}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
