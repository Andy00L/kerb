/**
 * On-chain mandate state reader.
 *
 * The contract is authoritative for a mandate's status. The enclave re-reads it
 * before every signature, so a cancellation that landed on-chain stops
 * execution even if the CANCEL_MANDATE instruction was never delivered.
 */

import { createPublicClient, http, type PublicClient } from 'viem';

/** Mirrors the MandateStatus enum in contracts/InstructionSender.sol. */
export enum MandateStatus {
  None = 0,
  Created = 1,
  Provisioned = 2,
  Funded = 3,
  Executing = 4,
  Filled = 5,
  Expired = 6,
  Cancelled = 7,
  Settled = 8,
}

/** Statuses in which the enclave is allowed to sign an XRPL transaction. */
const EXECUTABLE_STATUSES = new Set([MandateStatus.Funded, MandateStatus.Executing]);

export const MANDATE_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getMandate',
    stateMutability: 'view',
    inputs: [{ name: '_mandateId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'blobHash', type: 'bytes32' },
          { name: 'depositAddress', type: 'string' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint64' },
          { name: 'filledDrops', type: 'uint64' },
          { name: 'lastReportAt', type: 'uint64' },
        ],
      },
    ],
  },
] as const;

/** On-chain view of a mandate. */
export interface OnChainMandate {
  readonly owner: string;
  readonly blobHash: string;
  readonly depositAddress: string;
  readonly status: MandateStatus;
  readonly filledDrops: bigint;
}

/** The mandate state read the engine depends on, an interface so tests can fake it. */
export interface MandateStatusSource {
  readMandate(mandateId: bigint): Promise<OnChainMandate>;
}

/** Reads mandate state from the Kerb contract. */
export class MandateReader implements MandateStatusSource {
  private readonly client: PublicClient;
  private readonly contractAddress: `0x${string}`;

  constructor(chainUrl: string, contractAddress: string) {
    this.client = createPublicClient({ transport: http(chainUrl) });
    this.contractAddress = contractAddress as `0x${string}`;
  }

  /**
   * Read one mandate.
   *
   * @throws When the RPC call fails. A revert means the id does not exist.
   */
  async readMandate(mandateId: bigint): Promise<OnChainMandate> {
    const record = await this.client.readContract({
      address: this.contractAddress,
      abi: MANDATE_REGISTRY_ABI,
      functionName: 'getMandate',
      args: [mandateId],
    });

    return {
      owner: record.owner,
      blobHash: record.blobHash,
      depositAddress: record.depositAddress,
      status: record.status as MandateStatus,
      filledDrops: BigInt(record.filledDrops),
    };
  }
}

/**
 * Whether the enclave may sign for this mandate right now.
 *
 * Kept as a pure predicate so the rule is stated in exactly one place and can
 * be tested without a chain.
 */
export function isExecutable(status: MandateStatus): boolean {
  return EXECUTABLE_STATUSES.has(status);
}
