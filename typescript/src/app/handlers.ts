/** Handler functions for the KERB extension operations. */

import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { Framework } from '../base/types.js';
import { hexToBytes } from '../base/encoding.js';
import {
  OP_COMMAND_CANCEL_MANDATE,
  OP_COMMAND_CREATE_MANDATE,
  OP_COMMAND_INIT_SEED,
  OP_COMMAND_REPORT,
  OP_TYPE_KERB,
  VERSION,
} from './config.js';
import { decodeMandate, ValidatedMandate } from './mandate.js';
import { NodeClient } from './node.js';
import { deriveMandateWallet, parseMasterSeed } from './wallet.js';

/**
 * Execution progress the enclave reports on-chain.
 * Status values mirror the MandateStatus enum in the contract; only EXECUTING,
 * FILLED and EXPIRED are accepted by applyExecutionReport.
 */
export interface ExecutionProgress {
  status: number;
  filledDrops: bigint;
  lastTransactionHash: string;
}

/** Statuses the contract accepts from a TEE execution report. */
const REPORTABLE_EXECUTING = 4;

/** What the enclave keeps for one live mandate. */
interface MandateRecord {
  readonly mandate: ValidatedMandate;
  readonly contractAddress: string;
  readonly depositAddress: string;
  readonly walletSeed: string;
  cancelled: boolean;
  progress: ExecutionProgress;
}

/**
 * Mutable enclave state. The framework serializes handler calls, so plain
 * module state needs no lock. None of it is ever written outside the enclave.
 */
let masterSeed: Uint8Array | null = null;
const mandatesById = new Map<string, MandateRecord>();
let nodeClient = new NodeClient('9090');
let readUnixSeconds: () => number = () => Math.floor(Date.now() / 1000);

/** Envelope the contract wraps around the user's ciphertext, so the enclave can
 *  correlate its answer. FCC delivers no result callback, so the mandate id and
 *  the calling contract have to travel in the payload itself. */
const CREATE_ENVELOPE = [
  { type: 'uint256' },
  { type: 'address' },
  { type: 'bytes' },
] as const;

const CANCEL_ENVELOPE = [{ type: 'uint256' }, { type: 'address' }] as const;

/** Shape the contract's applyExecutionReport decodes. */
const EXECUTION_REPORT = [
  { type: 'address' },
  { type: 'uint256' },
  { type: 'uint8' },
  { type: 'uint64' },
  { type: 'bytes32' },
] as const;

/** Shape the contract's applyProvision decodes. */
const PROVISION_RESULT = [
  { type: 'address' },
  { type: 'uint256' },
  { type: 'string' },
] as const;

/** Set the sign port used to reach the TEE node. */
export function setSignPort(port: string): void {
  nodeClient = new NodeClient(port);
}

/** Replace the clock. Test seam only. */
export function setClock(clock: () => number): void {
  readUnixSeconds = clock;
}

/** Register the KERB handlers with the framework. */
export function register(framework: Framework): void {
  framework.handle(OP_TYPE_KERB, OP_COMMAND_INIT_SEED, handleInitSeed);
  framework.handle(OP_TYPE_KERB, OP_COMMAND_CREATE_MANDATE, handleCreateMandate);
  framework.handle(OP_TYPE_KERB, OP_COMMAND_CANCEL_MANDATE, handleCancelMandate);
  framework.handle(OP_TYPE_KERB, OP_COMMAND_REPORT, handleReport);
}

/**
 * Observable state. Deliberately free of anything confidential: no trigger
 * price, no size, no deposit address, no key material. GET /state is reachable
 * from the proxy, and the whole point of Kerb is that the levels stay unread.
 */
export function reportState(): unknown {
  let liveCount = 0;
  for (const record of mandatesById.values()) {
    if (!record.cancelled) {
      liveCount += 1;
    }
  }
  return {
    version: VERSION,
    hasMasterSeed: masterSeed !== null,
    mandateCount: mandatesById.size,
    liveMandateCount: liveCount,
  };
}

/** Reset state. Test seam only. */
export function resetState(): void {
  masterSeed = null;
  mandatesById.clear();
}

/** Normalise the framework's hex payload for viem, which requires a 0x prefix. */
function toPrefixedHex(msg: string): `0x${string}` {
  return (msg.startsWith('0x') ? msg : `0x${msg}`) as `0x${string}`;
}

/**
 * INIT_SEED: store the master seed every mandate key is derived from.
 * Replaying it after a restart rebuilds the same deposit addresses.
 */
async function handleInitSeed(
  msg: string,
): Promise<[string | null, number, string | null]> {
  if (!msg) {
    return [null, 0, 'originalMessage is empty'];
  }

  let ciphertext: Uint8Array;
  try {
    ciphertext = hexToBytes(msg);
  } catch (hexError) {
    return [null, 0, `invalid hex in originalMessage: ${hexError}`];
  }

  let plaintext: Uint8Array;
  try {
    plaintext = await nodeClient.decrypt(ciphertext);
  } catch (decryptError) {
    return [null, 0, `decryption failed: ${decryptError}`];
  }

  try {
    masterSeed = parseMasterSeed(plaintext);
  } catch (seedError) {
    return [null, 0, `invalid master seed: ${seedError}`];
  }

  console.log('[handleInitSeed] master seed installed');
  return [null, 1, null];
}

/**
 * CREATE_MANDATE: decrypt the mandate, validate it, derive its XRPL deposit
 * account and return the address for the contract to record.
 */
async function handleCreateMandate(
  msg: string,
): Promise<[string | null, number, string | null]> {
  if (!msg) {
    return [null, 0, 'originalMessage is empty'];
  }
  if (masterSeed === null) {
    return [null, 0, 'master seed not installed, send INIT_SEED first'];
  }

  let mandateId: bigint;
  let contractAddress: string;
  let ciphertext: Uint8Array;
  try {
    const [decodedId, decodedContract, decodedCiphertext] = decodeAbiParameters(
      CREATE_ENVELOPE,
      toPrefixedHex(msg),
    );
    mandateId = decodedId;
    contractAddress = decodedContract;
    ciphertext = hexToBytes(decodedCiphertext);
  } catch (decodeError) {
    return [null, 0, `invalid CREATE_MANDATE envelope: ${decodeError}`];
  }

  const mandateKey = mandateId.toString();
  if (mandatesById.has(mandateKey)) {
    return [null, 0, `mandate ${mandateKey} already provisioned`];
  }

  let plaintext: Uint8Array;
  try {
    plaintext = await nodeClient.decrypt(ciphertext);
  } catch (decryptError) {
    return [null, 0, `decryption failed: ${decryptError}`];
  }

  const decoded = decodeMandate(plaintext, readUnixSeconds());
  if (!decoded.ok) {
    return [null, 0, `mandate rejected: ${decoded.reason}`];
  }

  let depositAddress: string;
  let walletSeed: string;
  try {
    const wallet = deriveMandateWallet(masterSeed, mandateId);
    depositAddress = wallet.classicAddress;
    // The seed stays in enclave memory. It is what lets the executor rebuild
    // the signer for this mandate without re-deriving from the master seed.
    walletSeed = wallet.seed ?? '';
  } catch (deriveError) {
    return [null, 0, `key derivation failed: ${deriveError}`];
  }
  if (walletSeed === '') {
    return [null, 0, 'derived wallet carries no seed'];
  }

  mandatesById.set(mandateKey, {
    mandate: decoded.value,
    contractAddress,
    depositAddress,
    walletSeed,
    cancelled: false,
    progress: {
      status: REPORTABLE_EXECUTING,
      filledDrops: 0n,
      lastTransactionHash: `0x${'0'.repeat(64)}`,
    },
  });

  let resultData: `0x${string}`;
  try {
    resultData = encodeAbiParameters(PROVISION_RESULT, [
      contractAddress as `0x${string}`,
      mandateId,
      depositAddress,
    ]);
  } catch (encodeError) {
    return [null, 0, `result encoding failed: ${encodeError}`];
  }

  console.log(`[handleCreateMandate] mandate ${mandateKey} provisioned`);
  return [resultData, 1, null];
}

/**
 * CANCEL_MANDATE: stop working a mandate. The on-chain status is authoritative;
 * this only makes the enclave react without waiting for its next status read.
 */
async function handleCancelMandate(
  msg: string,
): Promise<[string | null, number, string | null]> {
  if (!msg) {
    return [null, 0, 'originalMessage is empty'];
  }

  let mandateId: bigint;
  try {
    const [decodedId] = decodeAbiParameters(CANCEL_ENVELOPE, toPrefixedHex(msg));
    mandateId = decodedId;
  } catch (decodeError) {
    return [null, 0, `invalid CANCEL_MANDATE envelope: ${decodeError}`];
  }

  const record = mandatesById.get(mandateId.toString());
  if (record === undefined) {
    return [null, 0, `unknown mandate ${mandateId.toString()}`];
  }

  record.cancelled = true;
  console.log(`[handleCancelMandate] mandate ${mandateId.toString()} cancelled`);
  return [null, 1, null];
}

/**
 * REPORT: return the current execution state, signed by the TEE, in the shape
 * the contract's applyExecutionReport decodes. Execution is driven by the price
 * feed rather than by an instruction, so this is how a signed report is
 * obtained for relaying on-chain.
 */
async function handleReport(
  msg: string,
): Promise<[string | null, number, string | null]> {
  if (!msg) {
    return [null, 0, 'originalMessage is empty'];
  }

  let mandateId: bigint;
  let contractAddress: string;
  try {
    const [decodedId, decodedContract] = decodeAbiParameters(
      CANCEL_ENVELOPE,
      toPrefixedHex(msg),
    );
    mandateId = decodedId;
    contractAddress = decodedContract;
  } catch (decodeError) {
    return [null, 0, `invalid REPORT envelope: ${decodeError}`];
  }

  const record = mandatesById.get(mandateId.toString());
  if (record === undefined) {
    return [null, 0, `unknown mandate ${mandateId.toString()}`];
  }

  let resultData: `0x${string}`;
  try {
    resultData = encodeAbiParameters(EXECUTION_REPORT, [
      contractAddress as `0x${string}`,
      mandateId,
      record.progress.status,
      record.progress.filledDrops,
      record.progress.lastTransactionHash as `0x${string}`,
    ]);
  } catch (encodeError) {
    return [null, 0, `report encoding failed: ${encodeError}`];
  }

  return [resultData, 1, null];
}

/** Read-only view of a stored mandate. Used by the execution engine and tests. */
export function getMandateRecord(mandateId: bigint): MandateRecord | undefined {
  return mandatesById.get(mandateId.toString());
}

/** Ids of every mandate the enclave currently holds. */
export function listMandateIds(): bigint[] {
  return Array.from(mandatesById.keys(), (key) => BigInt(key));
}

/**
 * Record execution progress for a mandate. Called by the engine as slices fill,
 * so the next REPORT instruction returns current numbers.
 */
export function recordExecutionProgress(
  mandateId: bigint,
  progress: ExecutionProgress,
): void {
  const record = mandatesById.get(mandateId.toString());
  if (record !== undefined) {
    record.progress = progress;
  }
}
