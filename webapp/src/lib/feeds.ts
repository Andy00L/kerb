/**
 * FTSOv2 trigger pairs.
 *
 * Mirrors the enclave list exactly (sourceRef: typescript/src/app/mandate.ts,
 * SUPPORTED_PAIRS): the enclave rejects any pair outside it, so the picker
 * only ever offers what a sealed mandate can carry. Execution is always XRP
 * against the counter currency on the XRPL DEX; a non-XRP pair arms the
 * trigger while the offers stay priced from XRP/USD.
 */

export const SUPPORTED_PAIRS = [
  "XRP/USD",
  "BTC/USD",
  "ETH/USD",
  "FLR/USD",
  "SGB/USD",
  "DOGE/USD",
  "ADA/USD",
  "ALGO/USD",
  "SOL/USD",
  "LTC/USD",
  "XLM/USD",
  "AVAX/USD",
  "BNB/USD",
  "POL/USD",
  "TRX/USD",
  "XDC/USD",
  "FIL/USD",
  "ARB/USD",
] as const;

export type SupportedPair = (typeof SUPPORTED_PAIRS)[number];

/**
 * Derive the 21 byte block-latency feed id for a pair: one category byte
 * (01, Crypto) followed by the UTF-8 pair name, right zero padded.
 */
export function feedIdForPair(pair: SupportedPair): `0x${string}` {
  let hex = "0x01";
  for (const character of pair) {
    hex += character.charCodeAt(0).toString(16).padStart(2, "0");
  }
  return hex.padEnd(44, "0") as `0x${string}`;
}
