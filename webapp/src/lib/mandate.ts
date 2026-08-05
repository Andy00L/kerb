/**
 * Mandate document construction and submission.
 *
 * The document shape mirrors the enclave schema exactly (sourceRef:
 * typescript/src/app/mandate.ts in the extension): unknown fields are
 * rejected there, so this builder emits only the fields the enclave accepts.
 * Live mode encrypts the JSON to the TEE public key (ECIES over secp256k1)
 * and sends createMandate(bytes) through the connected wallet. Demo mode
 * simulates the same phases so the flow stays walkable without a deployment.
 */

import { encrypt } from "eciesjs";
import { encodeFunctionData } from "viem";
import { readAppConfig } from "./config";

/** XRP/USD block-latency feed id, the one pair this build supports. */
export const XRP_USD_FEED_ID =
  "0x015852502f55534400000000000000000000000000";

export interface MandateDraft {
  readonly side: "buy" | "sell";
  readonly kind: "stop" | "limit" | "dca";
  readonly triggerOperator: "lte" | "gte";
  readonly triggerPrice: string;
  readonly totalXrp: string;
  readonly sliceXrp: string;
  readonly jitterPercent: number;
  readonly maxSlippagePercent: number;
  readonly dcaEverySeconds: number | null;
  readonly dcaTimes: number | null;
  readonly expiryUnixSeconds: number;
  readonly payoutAddress: string;
}

export type SubmissionPhase = "wallet" | "submitting";

export type SubmissionResult =
  | { ok: true; transactionHash: string }
  | { ok: false; reason: string };

const CREATE_MANDATE_ABI = [
  {
    type: "function",
    name: "createMandate",
    stateMutability: "nonpayable",
    inputs: [{ name: "_encryptedMandate", type: "bytes" }],
    outputs: [{ name: "mandateId", type: "uint256" }],
  },
] as const;

/** Serialize a draft into the exact JSON document the enclave validates. */
export function buildMandateDocument(draft: MandateDraft): string {
  const document: Record<string, unknown> = {
    v: 1,
    pair: "XRP/USD",
    side: draft.side,
    kind: draft.kind,
    trigger: {
      feedId: XRP_USD_FEED_ID,
      op: draft.triggerOperator,
      price: draft.triggerPrice,
    },
    size: {
      total: draft.totalXrp,
      slice: draft.sliceXrp,
      jitterPct: draft.jitterPercent,
    },
    bound: { maxSlippagePct: draft.maxSlippagePercent },
    expiry: draft.expiryUnixSeconds,
    payout: { xrplAddress: draft.payoutAddress },
  };
  if (draft.kind === "dca") {
    document.dca = { everySec: draft.dcaEverySeconds, times: draft.dcaTimes };
  }
  return JSON.stringify(document);
}

interface ProxyInfo {
  readonly publicKey?: string;
  readonly teePublicKey?: string;
}

/** Fetch the TEE encryption key from the ext-proxy /info endpoint. */
async function fetchTeePublicKey(proxyUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${proxyUrl.replace(/\/$/, "")}/info`);
    if (!response.ok) {
      return null;
    }
    const info = (await response.json()) as ProxyInfo;
    return info.teePublicKey ?? info.publicKey ?? null;
  } catch {
    return null;
  }
}

function toHexBytes(data: Uint8Array): `0x${string}` {
  let hex = "0x";
  for (const byte of data) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex as `0x${string}`;
}

/**
 * Submit a mandate.
 *
 * @param onPhase Called as the flow advances, so the button state machine
 *        tracks reality instead of a timer.
 */
export async function submitMandate(
  draft: MandateDraft,
  walletAddress: string,
  onPhase: (phase: SubmissionPhase) => void,
): Promise<SubmissionResult> {
  const config = readAppConfig();
  const provider = typeof window !== "undefined" ? window.ethereum : undefined;

  if (!config.isLive || config.proxyUrl === null || provider === undefined) {
    // Demo mode: same phases, no chain.
    onPhase("wallet");
    await new Promise((resolve) => setTimeout(resolve, 1_700));
    onPhase("submitting");
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    return { ok: true, transactionHash: `DEMO${Date.now().toString(16)}` };
  }

  const teePublicKey = await fetchTeePublicKey(config.proxyUrl);
  if (teePublicKey === null) {
    return { ok: false, reason: "the enclave public key is unreachable" };
  }

  const plaintext = new TextEncoder().encode(buildMandateDocument(draft));
  const ciphertext = encrypt(teePublicKey, plaintext);

  onPhase("wallet");
  const callData = encodeFunctionData({
    abi: CREATE_MANDATE_ABI,
    functionName: "createMandate",
    args: [toHexBytes(new Uint8Array(ciphertext))],
  });

  try {
    const transactionHash = (await provider.request({
      method: "eth_sendTransaction",
      params: [
        { from: walletAddress, to: config.contractAddress, data: callData },
      ],
    })) as string;
    onPhase("submitting");
    return { ok: true, transactionHash };
  } catch (sendError) {
    return { ok: false, reason: `wallet rejected the transaction: ${sendError}` };
  }
}

/** XRPL classic address shape (sourceRef: xrpl.org base58 address format). */
export const XRPL_ADDRESS_PATTERN = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
