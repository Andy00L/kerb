/**
 * Demo dataset.
 *
 * Until the contract is deployed and the indexer wired, the screens render
 * this sample set. The shapes mirror the enclave's real records (mandate
 * lifecycle enum, drops-derived sizes, XRPL hashes), so swapping in the real
 * reader changes the data source, not the components.
 */

export type MandateStatusWord =
  | "Created"
  | "Provisioned"
  | "Funded"
  | "Executing"
  | "Filled"
  | "Expired"
  | "Cancelled"
  | "Settled";

export interface DemoSlice {
  readonly time: string;
  readonly sizeXrp: string;
  readonly hash: string;
  readonly result: string;
  readonly settled: boolean;
}

export interface DemoTimelineEvent {
  readonly word: MandateStatusWord;
  readonly timestamp: string;
  readonly hash: string;
  readonly done: boolean;
  readonly proven: boolean;
}

export interface DemoMandate {
  readonly id: number;
  readonly side: "Sell" | "Buy";
  readonly kind: "stop" | "limit" | "DCA";
  readonly filledCents: bigint;
  readonly totalCents: bigint;
  readonly status: MandateStatusWord;
  readonly sealWidthPx: number;
  readonly cancellable: boolean;
}

/** The enclave-derived deposit account shown across the demo. */
export const DEMO_DEPOSIT_ADDRESS = "rNMovRR3WPbFLVaSbETCCR71XsqyxhJ9P6";

export const DEMO_WALLET = "0x00f9E590F2ADF3AC31F447fa6662B6d261f12246";

export const DEMO_MANDATES: readonly DemoMandate[] = [
  { id: 7, side: "Buy", kind: "limit", filledCents: 0n, totalCents: 250_000n, status: "Created", sealWidthPx: 44, cancellable: true },
  { id: 6, side: "Sell", kind: "stop", filledCents: 134_050n, totalCents: 250_000n, status: "Executing", sealWidthPx: 52, cancellable: true },
  { id: 5, side: "Buy", kind: "DCA", filledCents: 0n, totalCents: 80_000n, status: "Funded", sealWidthPx: 40, cancellable: true },
  { id: 4, side: "Sell", kind: "limit", filledCents: 120_000n, totalCents: 120_000n, status: "Filled", sealWidthPx: 56, cancellable: false },
  { id: 3, side: "Sell", kind: "stop", filledCents: 50_000n, totalCents: 50_000n, status: "Settled", sealWidthPx: 46, cancellable: false },
  { id: 2, side: "Buy", kind: "stop", filledCents: 0n, totalCents: 300_000n, status: "Cancelled", sealWidthPx: 50, cancellable: false },
];

export const DEMO_SLICES: readonly DemoSlice[] = [
  { time: "13:58:07", sizeXrp: "98.20", hash: "A3F0…9C21", result: "Filled", settled: true },
  { time: "14:06:31", sizeXrp: "105.44", hash: "7D2C…E8A4", result: "Filled", settled: true },
  { time: "14:14:52", sizeXrp: "87.61", hash: "B91E…44F7", result: "Filled", settled: true },
  { time: "14:23:40", sizeXrp: "110.00", hash: "0C5A…D3B8", result: "Filled", settled: false },
  { time: "14:31:59", sizeXrp: "96.75", hash: "E67B…21AC", result: "Filled", settled: false },
];

export function buildDemoTimeline(executing: boolean): DemoTimelineEvent[] {
  return [
    { word: "Created", timestamp: "Aug 5, 12:41:03", hash: "4F1B…A0E3", done: true, proven: false },
    { word: "Provisioned", timestamp: "Aug 5, 12:41:58", hash: "-", done: true, proven: false },
    { word: "Funded", timestamp: "Aug 5, 13:02:26", hash: "88D4…6C1F", done: executing, proven: executing },
    { word: "Executing", timestamp: executing ? "Aug 5, 13:58:07" : "-", hash: "-", done: executing, proven: false },
    { word: "Filled", timestamp: "-", hash: "-", done: false, proven: false },
    { word: "Settled", timestamp: "-", hash: "-", done: false, proven: false },
  ];
}

export function findDemoMandate(id: number): DemoMandate | undefined {
  return DEMO_MANDATES.find((mandate) => mandate.id === id);
}
