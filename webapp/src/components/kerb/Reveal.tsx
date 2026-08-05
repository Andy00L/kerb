"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Scroll reveal that never gates existence: content renders visible, and
 * only once JavaScript runs is it eased in from a 12px rise. If the observer
 * never fires, nothing was ever hidden from a no-JS or throttled viewer.
 */
export function Reveal({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Synchronizes with IntersectionObserver, a system React does not own.
  useEffect(() => {
    const element = containerRef.current;
    if (element === null || typeof IntersectionObserver === "undefined") {
      return;
    }
    element.style.transition =
      "opacity 300ms cubic-bezier(0,0,0.2,1), transform 300ms cubic-bezier(0,0,0.2,1)";
    element.style.opacity = "0";
    element.style.transform = "translateY(12px)";
    const show = (): void => {
      element.style.opacity = "";
      element.style.transform = "";
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            show();
            observer.unobserve(element);
          }
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(element);
    // Safety: if the observer never fires (throttled tab, print, capture),
    // the content force-reveals anyway. Motion must never gate existence.
    const fallback = setTimeout(show, 1_200);
    return () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
  }, []);

  return <div ref={containerRef}>{children}</div>;
}
