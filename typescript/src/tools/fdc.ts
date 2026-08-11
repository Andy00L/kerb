/**
 * FDC proof pipeline for XRPL payments.
 *
 * Turns an XRPL transaction id into an on-chain proof, in the four documented
 * steps: ask the verifier to encode the request, submit it to FdcHub with the
 * fee, wait for the voting round to finalise, then pull the Merkle proof from
 * the Data Availability Layer.
 *
 * Usage:
 *   node dist/tools/fdc.js deposit    <mandateId> <xrplTransactionId>
 *   node dist/tools/fdc.js settlement <mandateId> <xrplTransactionId>
 *
 * Environment: CHAIN_URL, INSTRUCTION_SENDER, KEEPER_PRIVATE_KEY,
 * optional FDC_VERIFIER_API_KEY and FDC_DA_LAYER_API_KEY.
 */

import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  http,
  stringToHex,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Agent, setGlobalDispatcher } from 'undici';

// Pin every fetch (native and viem's) to IPv4: this tool runs on developer
// machines where WSL advertises an IPv6 route that never connects, and undici
// then burns its whole connect timeout on it. Verified live: IPv6 to the
// verifier times out while IPv4 answers.
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

/**
 * Coston2 addresses, resolvable through FlareContractRegistry.
 * sourceRef: https://dev.flare.network/fdc/reference
 */
export const FDC_HUB_COSTON2 = '0x48aC463d7975828989331F4De43341627b9c5f1D';
export const FDC_REQUEST_FEE_CONFIGURATIONS_COSTON2 =
  '0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e';
export const FDC_VERIFICATION_COSTON2 = '0x906507E0B64bcD494Db73bd0459d1C667e14B933';
export const RELAY_COSTON2 = '0xa10B672D1c62e5457b17af63d4302add6A99d7dE';

/** Verifier and DA Layer endpoints for the Coston2 test instance. */
export const VERIFIER_BASE_URL = 'https://fdc-verifiers-testnet.flare.network';
export const DA_LAYER_BASE_URL = 'https://ctn2-data-availability.flare.network';

/**
 * FDC voting round geometry on Coston2, and the FDC protocol id used by Relay.
 * Read from FlareSystemsManager at runtime in production; these are the current
 * published values and are used as the fallback.
 */
export const FIRST_VOTING_ROUND_START_TIMESTAMP = 1_658_430_000;
export const VOTING_EPOCH_DURATION_SECONDS = 90;
export const FDC_PROTOCOL_ID = 200;

/** Attestation type and source, right zero padded to 32 bytes. */
export const ATTESTATION_TYPE_XRP_PAYMENT = stringToHex('XRPPayment', { size: 32 });
export const SOURCE_ID_TEST_XRP = stringToHex('testXRP', { size: 32 });

const FDC_HUB_ABI = [
  {
    type: 'function',
    name: 'requestAttestation',
    stateMutability: 'payable',
    inputs: [{ name: '_data', type: 'bytes' }],
    outputs: [],
  },
] as const;

const FEE_CONFIG_ABI = [
  {
    type: 'function',
    name: 'getRequestFee',
    stateMutability: 'view',
    inputs: [{ name: '_data', type: 'bytes' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const RELAY_ABI = [
  {
    type: 'function',
    name: 'isFinalized',
    stateMutability: 'view',
    inputs: [
      { name: '_protocolId', type: 'uint256' },
      { name: '_votingRoundId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** The XRPPayment Response tuple, matching contracts/interfaces/IXRPPayment.sol. */
const XRP_PAYMENT_RESPONSE = [
  {
    type: 'tuple',
    components: [
      { name: 'attestationType', type: 'bytes32' },
      { name: 'sourceId', type: 'bytes32' },
      { name: 'votingRound', type: 'uint64' },
      { name: 'lowestUsedTimestamp', type: 'uint64' },
      {
        name: 'requestBody',
        type: 'tuple',
        components: [
          { name: 'transactionId', type: 'bytes32' },
          { name: 'proofOwner', type: 'address' },
        ],
      },
      {
        name: 'responseBody',
        type: 'tuple',
        components: [
          { name: 'blockNumber', type: 'uint64' },
          { name: 'blockTimestamp', type: 'uint64' },
          { name: 'sourceAddress', type: 'string' },
          { name: 'sourceAddressHash', type: 'bytes32' },
          { name: 'receivingAddressHash', type: 'bytes32' },
          { name: 'intendedReceivingAddressHash', type: 'bytes32' },
          { name: 'spentAmount', type: 'int256' },
          { name: 'intendedSpentAmount', type: 'int256' },
          { name: 'receivedAmount', type: 'int256' },
          { name: 'intendedReceivedAmount', type: 'int256' },
          { name: 'hasMemoData', type: 'bool' },
          { name: 'firstMemoData', type: 'bytes' },
          { name: 'hasDestinationTag', type: 'bool' },
          { name: 'destinationTag', type: 'uint256' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
  },
] as const;

const PROVE_ABI = [
  {
    type: 'function',
    name: 'proveDeposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_mandateId', type: 'uint256' },
      {
        name: '_proof',
        type: 'tuple',
        components: [
          { name: 'merkleProof', type: 'bytes32[]' },
          { ...XRP_PAYMENT_RESPONSE[0], name: 'data' },
        ],
      },
    ],
    outputs: [],
  },
] as const;

/** Convert a block timestamp into its FDC voting round id. */
export function timestampToVotingRound(blockTimestampSeconds: number): number {
  return Math.floor(
    (blockTimestampSeconds - FIRST_VOTING_ROUND_START_TIMESTAMP) / VOTING_EPOCH_DURATION_SECONDS,
  );
}

/**
 * Ask the verifier to encode an attestation request.
 *
 * @param transactionId XRPL transaction hash, 0x prefixed.
 * @param proofOwner Address allowed to use the proof.
 * @returns The ABI-encoded request bytes.
 * @throws When the verifier rejects the request, reporting its status.
 */
export async function prepareRequest(
  transactionId: string,
  proofOwner: string,
  apiKey: string,
): Promise<Hex> {
  const response = await fetch(
    `${VERIFIER_BASE_URL}/verifier/xrp/XRPPayment/prepareRequest`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({
        attestationType: ATTESTATION_TYPE_XRP_PAYMENT,
        sourceId: SOURCE_ID_TEST_XRP,
        requestBody: { transactionId, proofOwner },
      }),
    },
  );

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`verifier returned ${response.status}: ${rawBody}`);
  }

  const parsed = JSON.parse(rawBody) as { status?: string; abiEncodedRequest?: string };
  if (parsed.status !== 'VALID' || !parsed.abiEncodedRequest) {
    throw new Error(`verifier rejected the request: ${parsed.status ?? 'no status'}`);
  }
  return parsed.abiEncodedRequest as Hex;
}

/**
 * Fetch the Merkle proof once the round is finalised.
 *
 * @throws When the DA Layer has no proof for the round yet.
 */
export async function fetchProof(
  votingRoundId: number,
  requestBytes: Hex,
  apiKey: string,
): Promise<{ merkleProof: Hex[]; responseHex: Hex }> {
  const response = await fetch(`${DA_LAYER_BASE_URL}/api/v1/fdc/proof-by-request-round-raw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ votingRoundId, requestBytes }),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`DA Layer returned ${response.status}: ${rawBody}`);
  }

  const parsed = JSON.parse(rawBody) as { proof?: string[]; response_hex?: string };
  if (!parsed.proof || !parsed.response_hex) {
    throw new Error('DA Layer response is missing proof or response_hex');
  }
  return {
    merkleProof: parsed.proof as Hex[],
    responseHex: parsed.response_hex as Hex,
  };
}

/** Upper bound on the wait for round finalisation, in milliseconds. */
export const FINALISATION_TIMEOUT_MS = 20 * 60 * 1_000;

/** Attempts made against the DA Layer after finalisation. */
export const PROOF_FETCH_ATTEMPTS = 12;

/** Pause between DA Layer attempts, in milliseconds. */
export const PROOF_FETCH_DELAY_MS = 5_000;

/**
 * Fetch the proof, retrying while the DA Layer catches up.
 *
 * Relay.isFinalized flips as soon as the Merkle root lands on-chain, but the
 * DA Layer indexes the round asynchronously and can lag that flag by seconds.
 * A single fetch right after finalisation would fail exactly when this tool is
 * most likely to run; polling absorbs the gap.
 */
export async function fetchProofWithRetry(
  votingRoundId: number,
  requestBytes: Hex,
  apiKey: string,
): Promise<{ merkleProof: Hex[]; responseHex: Hex }> {
  let lastFailure = 'no attempt made';
  for (let attempt = 1; attempt <= PROOF_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchProof(votingRoundId, requestBytes, apiKey);
    } catch (proofError) {
      lastFailure = proofError instanceof Error ? proofError.message : String(proofError);
      console.log(
        `[fetchProofWithRetry] attempt ${attempt}/${PROOF_FETCH_ATTEMPTS} not served yet`,
      );
    }
    if (attempt < PROOF_FETCH_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, PROOF_FETCH_DELAY_MS));
    }
  }
  throw new Error(`DA Layer never served the proof for round ${votingRoundId}: ${lastFailure}`);
}

/**
 * Decode the DA Layer response blob into the Response tuple the contract
 * expects. The return type is inferred from the ABI, so a drift between this
 * decoder and the Solidity struct is a compile error rather than a revert.
 */
export function decodeResponse(responseHex: Hex) {
  const [decoded] = decodeAbiParameters(XRP_PAYMENT_RESPONSE, responseHex);
  return decoded;
}

async function main(): Promise<void> {
  const [mode, mandateIdText, transactionId] = process.argv.slice(2);
  if (mode !== 'deposit' && mode !== 'settlement') {
    throw new Error('usage: fdc <deposit|settlement> <mandateId> <xrplTransactionId>');
  }
  if (!mandateIdText || !transactionId) {
    throw new Error('a mandateId and an XRPL transaction id are required');
  }

  const chainUrl = process.env.CHAIN_URL;
  const contractAddress = process.env.INSTRUCTION_SENDER as Hex | undefined;
  const rawKey = process.env.KEEPER_PRIVATE_KEY;
  if (!chainUrl || !contractAddress || !rawKey) {
    throw new Error('CHAIN_URL, INSTRUCTION_SENDER and KEEPER_PRIVATE_KEY are required');
  }
  const verifierApiKey = process.env.FDC_VERIFIER_API_KEY ?? '00000000-0000-0000-0000-000000000000';
  const daLayerApiKey = process.env.FDC_DA_LAYER_API_KEY ?? verifierApiKey;

  const account = privateKeyToAccount((rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex);
  const publicClient = createPublicClient({ transport: http(chainUrl) });
  const walletClient = createWalletClient({ account, transport: http(chainUrl) });

  console.log('[fdc] preparing the attestation request');
  const requestBytes = await prepareRequest(transactionId, account.address, verifierApiKey);

  const fee = await publicClient.readContract({
    address: FDC_REQUEST_FEE_CONFIGURATIONS_COSTON2,
    abi: FEE_CONFIG_ABI,
    functionName: 'getRequestFee',
    args: [requestBytes],
  });
  console.log(`[fdc] request fee: ${fee} wei`);

  const requestHash = await walletClient.writeContract({
    address: FDC_HUB_COSTON2,
    abi: FDC_HUB_ABI,
    functionName: 'requestAttestation',
    args: [requestBytes],
    value: fee,
    chain: null,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: requestHash });
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const votingRoundId = timestampToVotingRound(Number(block.timestamp));
  console.log(`[fdc] requested in round ${votingRoundId}, tx ${requestHash}`);

  console.log('[fdc] waiting for the round to finalise');
  // Rounds finalise about 90 to 180 seconds after they close; a round that is
  // still open after this window will never finalise (fee lost, re-request),
  // so the wait is bounded instead of spinning forever.
  const finalisationDeadline = Date.now() + FINALISATION_TIMEOUT_MS;
  for (;;) {
    const finalised = await publicClient.readContract({
      address: RELAY_COSTON2,
      abi: RELAY_ABI,
      functionName: 'isFinalized',
      args: [BigInt(FDC_PROTOCOL_ID), BigInt(votingRoundId)],
    });
    if (finalised) {
      break;
    }
    if (Date.now() >= finalisationDeadline) {
      throw new Error(
        `round ${votingRoundId} not finalised within ${FINALISATION_TIMEOUT_MS / 60_000} ` +
          'minutes; re-run to request a fresh attestation',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  const { merkleProof, responseHex } = await fetchProofWithRetry(
    votingRoundId,
    requestBytes,
    daLayerApiKey,
  );
  const decodedResponse = decodeResponse(responseHex);

  const proveFunction = mode === 'deposit' ? 'proveDeposit' : 'proveSettlement';
  const proveAbi = [
    { ...PROVE_ABI[0], name: proveFunction },
  ] as const;

  const proveHash = await walletClient.writeContract({
    address: contractAddress,
    abi: proveAbi,
    functionName: proveFunction,
    args: [BigInt(mandateIdText), { merkleProof, data: decodedResponse }],
    chain: null,
  });
  const proveReceipt = await publicClient.waitForTransactionReceipt({ hash: proveHash });
  if (proveReceipt.status !== 'success') {
    throw new Error(`${proveFunction} reverted: ${proveHash}`);
  }
  console.log(`[fdc] ${proveFunction} accepted in ${proveHash}`);
}

if (process.argv[1]?.endsWith('fdc.js')) {
  main().catch((fdcError) => {
    console.error(`[fdc] ${fdcError}`);
    process.exit(1);
  });
}
