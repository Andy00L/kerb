/**
 * Result keeper.
 *
 * FCC ends the on-chain path at sendInstructions: the TEE answer lives on the
 * proxy and only reaches the contract if someone relays it. This tool does that
 * relay. It holds no authority of its own, because the contract verifies the
 * TEE signature and ignores the sender.
 *
 * Usage:
 *   node dist/tools/keeper.js provision <actionId>
 *   node dist/tools/keeper.js report    <actionId>
 *
 * Environment: CHAIN_URL, INSTRUCTION_SENDER, EXT_PROXY_URL, KEEPER_PRIVATE_KEY.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { waitForActionResult, type ActionResponse } from './proxy.js';

const RELAY_ABI = [
  {
    type: 'function',
    name: 'applyProvision',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_resultData', type: 'bytes' },
      { name: '_actionId', type: 'bytes32' },
      { name: '_submissionTag', type: 'string' },
      { name: '_status', type: 'uint8' },
      { name: '_signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'applyExecutionReport',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_resultData', type: 'bytes' },
      { name: '_actionId', type: 'bytes32' },
      { name: '_submissionTag', type: 'string' },
      { name: '_status', type: 'uint8' },
      { name: '_signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

type RelayFunction = 'applyProvision' | 'applyExecutionReport';

interface KeeperConfig {
  readonly chainUrl: string;
  readonly contractAddress: Hex;
  readonly proxyUrl: string;
  readonly privateKey: Hex;
}

/**
 * Read the keeper configuration.
 * @throws When a required variable is missing, naming the one that is absent.
 */
export function readKeeperConfig(environment: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const required = ['CHAIN_URL', 'INSTRUCTION_SENDER', 'EXT_PROXY_URL', 'KEEPER_PRIVATE_KEY'];
  for (const name of required) {
    if (!environment[name]) {
      throw new Error(`missing ${name}`);
    }
  }
  const rawKey = environment.KEEPER_PRIVATE_KEY as string;
  return {
    chainUrl: environment.CHAIN_URL as string,
    contractAddress: environment.INSTRUCTION_SENDER as Hex,
    proxyUrl: environment.EXT_PROXY_URL as string,
    privateKey: (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex,
  };
}

/**
 * Relay one action result on-chain.
 *
 * @param relayFunction Which ingest function the result belongs to.
 * @param actionId Instruction id returned by the sending transaction.
 * @returns The relay transaction hash.
 * @throws When the enclave reported a failure. Only status 1 is relayable: the
 *         contract refuses anything else, so failing here gives a clearer
 *         message than a revert would.
 */
export async function relayResult(
  config: KeeperConfig,
  relayFunction: RelayFunction,
  actionId: string,
): Promise<Hex> {
  const response: ActionResponse = await waitForActionResult(config.proxyUrl, actionId);

  if (response.result.status !== 1) {
    throw new Error(
      `enclave reported status ${response.result.status} for ${actionId}: ${response.result.log}`,
    );
  }

  const account = privateKeyToAccount(config.privateKey);
  const publicClient = createPublicClient({ transport: http(config.chainUrl) });
  const walletClient = createWalletClient({ account, transport: http(config.chainUrl) });

  const transactionHash = await walletClient.writeContract({
    address: config.contractAddress,
    abi: RELAY_ABI,
    functionName: relayFunction,
    args: [
      response.result.data as Hex,
      response.result.id as Hex,
      response.result.submissionTag,
      response.result.status,
      response.signature as Hex,
    ],
    chain: null,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== 'success') {
    throw new Error(`relay transaction reverted: ${transactionHash}`);
  }
  return transactionHash;
}

async function main(): Promise<void> {
  const [mode, actionId] = process.argv.slice(2);
  if (mode !== 'provision' && mode !== 'report') {
    throw new Error('usage: keeper <provision|report> <actionId>');
  }
  if (!actionId) {
    throw new Error('an actionId is required');
  }

  const config = readKeeperConfig();
  const relayFunction: RelayFunction =
    mode === 'provision' ? 'applyProvision' : 'applyExecutionReport';
  const transactionHash = await relayResult(config, relayFunction, actionId);
  console.log(`[keeper] relayed ${mode} for ${actionId} in ${transactionHash}`);
}

// Only run when invoked directly, so the functions stay importable from tests.
if (process.argv[1]?.endsWith('keeper.js')) {
  main().catch((keeperError) => {
    console.error(`[keeper] ${keeperError}`);
    process.exit(1);
  });
}
