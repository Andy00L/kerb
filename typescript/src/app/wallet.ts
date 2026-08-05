/**
 * Per-mandate XRPL key derivation, entirely inside the enclave.
 *
 * One master seed is delivered once, encrypted to the TEE public key. Every
 * mandate then gets its own XRPL account derived deterministically from that
 * seed, so a restart that replays the same seed rebuilds exactly the same
 * deposit addresses. No key material ever leaves the enclave: only the derived
 * classic address is returned on-chain.
 */

import { createHmac } from 'node:crypto';
import { Wallet } from 'xrpl';

/** Length of the master seed, in bytes. */
export const MASTER_SEED_BYTES = 32;

/**
 * Domain separator for mandate key derivation. Changing this string rotates
 * every derived address, so it is versioned.
 */
const MANDATE_DERIVATION_DOMAIN = 'kerb/v1/mandate';

/**
 * Entropy accepted by xrpl's Wallet.fromEntropy. XRPL seeds carry 16 bytes of
 * entropy, and the library truncates anything longer, so the slice is explicit
 * here rather than implied.
 */
const XRPL_ENTROPY_BYTES = 16;

/**
 * Validate a master seed delivered to the enclave.
 *
 * @param candidate Decrypted bytes from the INIT_SEED instruction.
 * @returns The seed when it is well formed.
 * @throws When the seed has the wrong length or is entirely zero.
 */
export function parseMasterSeed(candidate: Uint8Array): Uint8Array {
  if (candidate.length !== MASTER_SEED_BYTES) {
    throw new Error(
      `master seed must be ${MASTER_SEED_BYTES} bytes, received ${candidate.length}`,
    );
  }
  if (candidate.every((byteValue) => byteValue === 0)) {
    throw new Error('master seed must not be all zero');
  }
  return candidate;
}

/**
 * Derive the XRPL wallet that receives and trades a single mandate's funds.
 *
 * @param masterSeed The enclave master seed.
 * @param mandateId Mandate identifier assigned on-chain.
 * @returns An xrpl Wallet whose private key stays in enclave memory.
 */
export function deriveMandateWallet(masterSeed: Uint8Array, mandateId: bigint): Wallet {
  const derivationLabel = `${MANDATE_DERIVATION_DOMAIN}/${mandateId.toString()}`;
  const entropy = createHmac('sha256', masterSeed).update(derivationLabel).digest();
  return Wallet.fromEntropy(new Uint8Array(entropy.subarray(0, XRPL_ENTROPY_BYTES)));
}
