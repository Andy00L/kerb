"use client";

/**
 * Live mandate state hook.
 *
 * Polls getMandate on the deployed contract so the detail screen shows the
 * real lifecycle, deposit address and filled size. Returns null while demo
 * mode is active (no contract configured) or before the first read lands.
 */

import { useEffect, useState } from "react";
import { readOnChainMandate, type OnChainMandateView } from "./chain";

/** Lifecycle moves at keeper/FDC pace; 5s keeps the screen close behind. */
export const MANDATE_POLL_INTERVAL_MS = 5_000;

export function useOnChainMandate(
  mandateId: number | null,
): OnChainMandateView | null {
  const [view, setView] = useState<OnChainMandateView | null>(null);

  // Synchronizes with the chain RPC, a system React does not own.
  useEffect(() => {
    if (mandateId === null) {
      return;
    }
    let disposed = false;

    const readOnce = async (): Promise<void> => {
      const next = await readOnChainMandate(mandateId);
      if (!disposed && next !== null) {
        setView(next);
      }
    };

    void readOnce();
    const interval = setInterval(() => {
      void readOnce();
    }, MANDATE_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [mandateId]);

  return view;
}
