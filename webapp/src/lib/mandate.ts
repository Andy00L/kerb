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

import { encodeFunctionData } from "viem";
import { readAppConfig } from "./config";
import {
  buildUncompressedPublicKey,
  encryptToEnclave,
  type TeePublicKeyCoordinates,
} from "./ecies";

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
    stateMutability: "payable",
    inputs: [{ name: "_encryptedMandate", type: "bytes" }],
    outputs: [{ name: "mandateId", type: "uint256" }],
  },
] as const;

const CANCEL_MANDATE_ABI = [
  {
    type: "function",
    name: "cancelMandate",
    stateMutability: "payable",
    inputs: [{ name: "_mandateId", type: "uint256" }],
    outputs: [],
  },
] as const;

const REQUEST_REPORT_ABI = [
  {
    type: "function",
    name: "requestReport",
    stateMutability: "payable",
    inputs: [{ name: "_mandateId", type: "uint256" }],
    outputs: [],
  },
] as const;

/**
 * Fee forwarded to TeeExtensionRegistry.sendInstructions with every
 * instruction-sending call, in wei.
 * sourceRef: go/tools/pkg/utils/instructions.go (DefaultFee).
 */
export const INSTRUCTION_FEE_WEI = 1_000_000_000_000n;

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

/**
 * The /info response fields Kerb reads. The key lives at
 * machineData.publicKey as {x, y} 32 byte hex words.
 * sourceRef: tee-node pkg/types/tee.go (TeeInfoResponse, MachineData).
 */
interface ProxyInfo {
  readonly machineData?: {
    readonly publicKey?: TeePublicKeyCoordinates;
  };
}

/** Fetch the TEE encryption key from the ext-proxy /info endpoint. */
async function fetchTeePublicKey(proxyUrl: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(`${proxyUrl.replace(/\/$/, "")}/info`);
    if (!response.ok) {
      return null;
    }
    const info = (await response.json()) as ProxyInfo;
    const coordinates = info.machineData?.publicKey;
    if (
      coordinates === undefined ||
      typeof coordinates.x !== "string" ||
      typeof coordinates.y !== "string"
    ) {
      return null;
    }
    return buildUncompressedPublicKey(coordinates);
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
  let ciphertext: Uint8Array;
  try {
    ciphertext = encryptToEnclave(teePublicKey, plaintext);
  } catch (encryptError) {
    return { ok: false, reason: `mandate encryption failed: ${encryptError}` };
  }

  onPhase("wallet");
  const callData = encodeFunctionData({
    abi: CREATE_MANDATE_ABI,
    functionName: "createMandate",
    args: [toHexBytes(ciphertext)],
  });

  try {
    const transactionHash = (await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: walletAddress,
          to: config.contractAddress,
          data: callData,
          value: `0x${INSTRUCTION_FEE_WEI.toString(16)}`,
        },
      ],
    })) as string;
    onPhase("submitting");
    return { ok: true, transactionHash };
  } catch (sendError) {
    return { ok: false, reason: `wallet rejected the transaction: ${sendError}` };
  }
}

/** Send one fee-carrying single-argument contract call through the wallet. */
async function sendMandateCall(
  callData: `0x${string}`,
  walletAddress: string,
): Promise<SubmissionResult> {
  const config = readAppConfig();
  const provider = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!config.isLive || provider === undefined) {
    return { ok: false, reason: "live mode is not configured" };
  }
  try {
    const transactionHash = (await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: walletAddress,
          to: config.contractAddress,
          data: callData,
          value: `0x${INSTRUCTION_FEE_WEI.toString(16)}`,
        },
      ],
    })) as string;
    return { ok: true, transactionHash };
  } catch (sendError) {
    return { ok: false, reason: `wallet rejected the transaction: ${sendError}` };
  }
}

/** Cancel a mandate on-chain. The contract enforces that the caller owns it. */
export async function submitCancel(
  mandateId: number,
  walletAddress: string,
): Promise<SubmissionResult> {
  return sendMandateCall(
    encodeFunctionData({
      abi: CANCEL_MANDATE_ABI,
      functionName: "cancelMandate",
      args: [BigInt(mandateId)],
    }),
    walletAddress,
  );
}

/** Ask the enclave for a signed execution report (relayed by the keeper). */
export async function submitReportRequest(
  mandateId: number,
  walletAddress: string,
): Promise<SubmissionResult> {
  return sendMandateCall(
    encodeFunctionData({
      abi: REQUEST_REPORT_ABI,
      functionName: "requestReport",
      args: [BigInt(mandateId)],
    }),
    walletAddress,
  );
}

/** XRPL classic address shape (sourceRef: xrpl.org base58 address format). */
export const XRPL_ADDRESS_PATTERN = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
