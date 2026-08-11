"use client";

/**
 * B9 watch toggle: two stacked stars. Toggling on pops the visible star and
 * bursts the aria-hidden twin outward.
 */

import { useState } from "react";
import { IconStar } from "./icons";

export function Star({ ariaLabel }: { readonly ariaLabel: string }) {
  const [on, setOn] = useState(false);
  const [firing, setFiring] = useState(0);

  return (
    <span
      className={`starwrap${on ? " on" : ""}${firing > 0 ? " firing" : ""}`}
      key={firing}
    >
      <button
        type="button"
        className="btn-icon core"
        aria-label={ariaLabel}
        aria-pressed={on}
        onClick={() => {
          const next = !on;
          setOn(next);
          if (next) {
            setFiring((generation) => generation + 1);
          }
        }}
      >
        <IconStar />
      </button>
      <span className="star-burst" aria-hidden>
        <IconStar fill="#fcfcfc" />
      </span>
    </span>
  );
}
