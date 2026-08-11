/** Pure formatting helpers. Amount math stays integral; floats never touch money. */

/** Micro units per price unit: prices display with 6 decimals. */
export const PRICE_MICRO = 1_000_000n;

/** Render a micro-scaled price as "2.847391". */
export function formatPriceMicro(priceMicro: bigint): string {
  const whole = priceMicro / PRICE_MICRO;
  const fraction = (priceMicro % PRICE_MICRO).toString().padStart(6, "0");
  return `${whole.toString()}.${fraction}`;
}

/** Render hundredths of XRP as "1,340.50". */
export function formatXrpCents(xrpCents: bigint): string {
  const whole = xrpCents / 100n;
  const fraction = (xrpCents % 100n).toString().padStart(2, "0");
  const grouped = whole
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${fraction}`;
}

/** Signed micro-scaled delta as "+0.043210". */
export function formatSignedPriceMicro(deltaMicro: bigint): string {
  const sign = deltaMicro < 0n ? "-" : "+";
  const magnitude = deltaMicro < 0n ? -deltaMicro : deltaMicro;
  const whole = magnitude / PRICE_MICRO;
  const fraction = (magnitude % PRICE_MICRO).toString().padStart(6, "0");
  return `${sign}${whole.toString()}.${fraction}`;
}

/** Basis-point delta between a price and its session start, as "-0.42%". */
export function formatDeltaBasisPoints(
  currentMicro: bigint,
  openMicro: bigint,
): string {
  if (openMicro === 0n) {
    return "0.00%";
  }
  const basisPoints = ((currentMicro - openMicro) * 10_000n) / openMicro;
  const sign = basisPoints < 0n ? "-" : "+";
  const magnitude = basisPoints < 0n ? -basisPoints : basisPoints;
  const whole = magnitude / 100n;
  const fraction = (magnitude % 100n).toString().padStart(2, "0");
  return `${sign}${whole.toString()}.${fraction}%`;
}

/** Truncate a hash or address to its first and last four characters. */
export function truncateMiddle(text: string, head = 4, tail = 4): string {
  if (text.length <= head + tail + 1) {
    return text;
  }
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}
