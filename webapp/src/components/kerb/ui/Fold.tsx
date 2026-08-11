"use client";

/**
 * System 14 collapse: grid-template-rows 1fr to 0fr with the inner content
 * fading. The closed content is inert so keyboard focus cannot land inside.
 */

import type { ReactNode } from "react";

export function Fold({
  open,
  children,
  className,
}: {
  readonly open: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const base = open ? "fold" : "fold closed";
  return (
    <div className={className === undefined ? base : `${base} ${className}`}>
      <div inert={!open}>{children}</div>
    </div>
  );
}
