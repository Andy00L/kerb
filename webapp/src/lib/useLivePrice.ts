"use client";

/**
 * Live XRP/USD price hook.
 *
 * Reads the real FTSOv2 block-latency feed over the public Coston2 RPC (an
 * eth_call costs nothing). When the RPC is unreachable the hook falls back to
 * a deterministic simulated walk so the demo keeps moving; `isSimulated`
 * says which one the viewer is looking at. All arithmetic is integral: the
 * price lives as a bigint in micro units (6 decimals).
 */

import { useEffect, useRef, useState } from "react";
import { createPublicClient, http } from "viem";
import { readAppConfig } from "./config";

/**
 * FtsoV2 on Coston2, resolved from FlareContractRegistry.
 * sourceRef: typescript/src/app/ftso.ts in the extension.
 */
const FTSO_V2_ADDRESS = "0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d";

/** XRP/USD block-latency feed id (category 01 + "XRP/USD" right padded). */
const XRP_USD_FEED_ID = "0x015852502f55534400000000000000000000000000";

const FTSO_V2_ABI = [
  {
    type: "function",
    name: "getFeedById",
    stateMutability: "view",
    inputs: [{ name: "_feedId", type: "bytes21" }],
    outputs: [
      { name: "_value", type: "uint256" },
      { name: "_decimals", type: "int8" },
      { name: "_timestamp", type: "uint64" },
    ],
  },
] as const;

/** Poll interval; the feed itself moves about every 1.8s. */
export const PRICE_POLL_INTERVAL_MS = 2_800;

/** Starting point of the simulated walk, in micro units. */
const SIMULATED_START_MICRO = 2_847_391n;

export interface LivePrice {
  readonly priceMicro: bigint;
  readonly openMicro: bigint;
  readonly flash: boolean;
  readonly isSimulated: boolean;
}

/** Scale a raw feed value to micro units without touching floats. */
function scaleToMicro(value: bigint, decimals: number): bigint {
  const shift = 6 - decimals;
  if (shift >= 0) {
    return value * 10n ** BigInt(shift);
  }
  return value / 10n ** BigInt(-shift);
}

export function useLivePrice(enabled: boolean): LivePrice {
  const [priceMicro, setPriceMicro] = useState<bigint>(SIMULATED_START_MICRO);
  const [openMicro, setOpenMicro] = useState<bigint>(0n);
  const [flash, setFlash] = useState(false);
  const [isSimulated, setIsSimulated] = useState(true);
  const walkStepRef = useRef(0);
  const priceRef = useRef(SIMULATED_START_MICRO);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const { chainUrl } = readAppConfig();
    const client = createPublicClient({ transport: http(chainUrl) });
    let disposed = false;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    const applyReading = (nextMicro: bigint, simulated: boolean): void => {
      if (disposed) {
        return;
      }
      priceRef.current = nextMicro;
      setPriceMicro(nextMicro);
      setIsSimulated(simulated);
      setOpenMicro((open) => (open === 0n ? nextMicro : open));
      setFlash(true);
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        if (!disposed) {
          setFlash(false);
        }
      }, 300);
    };

    const readOnce = async (): Promise<void> => {
      try {
        const [value, decimals] = await client.readContract({
          address: FTSO_V2_ADDRESS,
          abi: FTSO_V2_ABI,
          functionName: "getFeedById",
          args: [XRP_USD_FEED_ID],
        });
        applyReading(scaleToMicro(value, decimals), false);
      } catch {
        // RPC unreachable (offline demo): deterministic integral walk.
        walkStepRef.current += 1;
        const drift = BigInt(((walkStepRef.current * 7919) % 2400) - 1250);
        const next = priceRef.current + drift;
        applyReading(next < 500_000n ? 500_000n : next, true);
      }
    };

    void readOnce();
    const interval = setInterval(() => {
      void readOnce();
    }, PRICE_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      clearInterval(interval);
      clearTimeout(flashTimer);
    };
  }, [enabled]);

  return { priceMicro, openMicro, flash, isSimulated };
}
