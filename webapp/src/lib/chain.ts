/**
 * On-chain mandate reads for live mode.
 *
 * The contract is the source of truth for a mandate's lifecycle and its
 * enclave-derived deposit address. The webapp never shows a deposit address
 * it did not read from the chain: sending funds to anything else would miss
 * the FDC deposit proof, whose address-hash check is bound to this record.
 * sourceRef: contracts/InstructionSender.sol (getMandate, MandateCreated).
 */

import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbi,
  type PublicClient,
} from "viem";
import { readAppConfig } from "./config";
import type { MandateStatusWord } from "./demo";

/** Mirrors the MandateStatus enum in contracts/InstructionSender.sol. */
const STATUS_WORDS: readonly (MandateStatusWord | null)[] = [
  null, // NONE
  "Created",
  "Provisioned",
  "Funded",
  "Executing",
  "Filled",
  "Expired",
  "Cancelled",
  "Settled",
];

const MANDATE_ABI = parseAbi([
  "function getMandate(uint256 _mandateId) view returns ((address owner, bytes32 blobHash, string depositAddress, uint8 status, uint64 createdAt, uint64 filledDrops, uint64 lastReportAt))",
  "event MandateCreated(uint256 indexed mandateId, address indexed owner, bytes32 blobHash)",
]);

/** What the detail screen needs from the chain. */
export interface OnChainMandateView {
  readonly statusWord: MandateStatusWord;
  /** Empty string until the enclave's provisioning result is relayed. */
  readonly depositAddress: string;
  readonly filledDrops: bigint;
  readonly owner: string;
}

function buildClient(): PublicClient {
  const { chainUrl } = readAppConfig();
  return createPublicClient({ transport: http(chainUrl) });
}

/**
 * Read one mandate.
 *
 * @returns The view, or null when the id does not exist (the read reverts).
 */
export async function readOnChainMandate(
  mandateId: number,
): Promise<OnChainMandateView | null> {
  const { contractAddress } = readAppConfig();
  if (contractAddress === null) {
    return null;
  }
  try {
    const record = await buildClient().readContract({
      address: contractAddress,
      abi: MANDATE_ABI,
      functionName: "getMandate",
      args: [BigInt(mandateId)],
    });
    const statusWord = STATUS_WORDS[record.status];
    if (statusWord === null || statusWord === undefined) {
      return null;
    }
    return {
      statusWord,
      depositAddress: record.depositAddress,
      filledDrops: BigInt(record.filledDrops),
      owner: record.owner,
    };
  } catch {
    return null;
  }
}

/**
 * Wait for a createMandate transaction and extract the assigned mandate id
 * from the MandateCreated event in its receipt.
 *
 * @returns The mandate id, or null when the receipt carries no such event
 *          (reverted transaction, wrong contract).
 */
export async function waitForMandateId(
  transactionHash: `0x${string}`,
): Promise<number | null> {
  const { contractAddress } = readAppConfig();
  if (contractAddress === null) {
    return null;
  }
  try {
    const receipt = await buildClient().waitForTransactionReceipt({
      hash: transactionHash,
    });
    if (receipt.status !== "success") {
      return null;
    }
    for (const receiptLog of receipt.logs) {
      if (receiptLog.address.toLowerCase() !== contractAddress.toLowerCase()) {
        continue;
      }
      try {
        const decoded = decodeEventLog({
          abi: MANDATE_ABI,
          data: receiptLog.data,
          topics: receiptLog.topics,
        });
        if (decoded.eventName === "MandateCreated") {
          return Number(decoded.args.mandateId);
        }
      } catch {
        // Logs from other events of the same contract: skip.
      }
    }
    return null;
  } catch {
    return null;
  }
}
