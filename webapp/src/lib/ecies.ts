/**
 * ECIES encryption compatible with the TEE node's decryptor.
 *
 * The enclave decrypts with go-ethereum's crypto/ecies using the
 * ECIES_AES128_SHA256 parameter set (sourceRef: tee-node pkg/utils/crypto.go,
 * ECDSAPubKeyToECIES). Generic ECIES npm packages implement different KDFs and
 * ciphers and produce blobs the node rejects, so the exact scheme is ported
 * here from go-ethereum crypto/ecies/ecies.go (v1.17.4):
 *
 *   z  = x coordinate of ECDH(ephemeral, teePublicKey), 32 bytes big-endian
 *   K  = concatKDF_SHA256(z, 32)            NIST SP 800-56, section 5.8.1
 *   Ke = K[0:16]                            AES-128-CTR key
 *   Km = SHA256(K[16:32])                   HMAC key
 *   em = IV(16) || AES128CTR(Ke, IV, m)
 *   d  = HMAC-SHA256(Km, em)
 *   ct = R(65, uncompressed ephemeral point) || em || d
 *
 * The optional shared-info inputs s1 and s2 are empty, matching the node's
 * ecies.Encrypt(rand, pub, m, nil, nil) call.
 */

import { ctr } from "@noble/ciphers/aes.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** AES-128 key and block length, in bytes (ECIES_AES128_SHA256.KeyLen). */
const KEY_LENGTH_BYTES = 16;

/** Coordinate length of a secp256k1 point, in bytes. */
const COORDINATE_BYTES = 32;

/** The TEE signing key as the proxy /info endpoint reports it. */
export interface TeePublicKeyCoordinates {
  /** 0x-prefixed 32 byte big-endian X coordinate. */
  readonly x: string;
  /** 0x-prefixed 32 byte big-endian Y coordinate. */
  readonly y: string;
}

function decodeCoordinate(hexWord: string, label: string): Uint8Array {
  const body = hexWord.startsWith("0x") ? hexWord.slice(2) : hexWord;
  if (body.length !== COORDINATE_BYTES * 2 || !/^[0-9a-fA-F]+$/.test(body)) {
    throw new Error(`${label} is not a 32 byte hex word`);
  }
  const bytes = new Uint8Array(COORDINATE_BYTES);
  for (let index = 0; index < COORDINATE_BYTES; index += 1) {
    bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Build the 65 byte uncompressed point 0x04 || X || Y from the /info
 * machineData.publicKey coordinates, validating it sits on the curve.
 */
export function buildUncompressedPublicKey(
  coordinates: TeePublicKeyCoordinates,
): Uint8Array {
  const point = new Uint8Array(1 + COORDINATE_BYTES * 2);
  point[0] = 0x04;
  point.set(decodeCoordinate(coordinates.x, "publicKey.x"), 1);
  point.set(decodeCoordinate(coordinates.y, "publicKey.y"), 1 + COORDINATE_BYTES);
  // Throws when the coordinates are not a valid curve point.
  secp256k1.Point.fromBytes(point);
  return point;
}

/** NIST SP 800-56 concatenation KDF over SHA-256, with empty shared info. */
function concatKdf(sharedSecret: Uint8Array, outputLength: number): Uint8Array {
  const output = new Uint8Array(outputLength);
  let written = 0;
  for (let counter = 1; written < outputLength; counter += 1) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter, false);
    const round = sha256
      .create()
      .update(counterBytes)
      .update(sharedSecret)
      .digest();
    const take = Math.min(round.length, outputLength - written);
    output.set(round.subarray(0, take), written);
    written += take;
  }
  return output;
}

/**
 * Encrypt a plaintext to the enclave public key.
 *
 * @param teePublicKey 65 byte uncompressed secp256k1 point.
 * @param plaintext The mandate JSON bytes.
 * @returns The go-ethereum ECIES ciphertext described in the module header.
 */
export function encryptToEnclave(
  teePublicKey: Uint8Array,
  plaintext: Uint8Array,
): Uint8Array {
  const ephemeralSecret = secp256k1.utils.randomSecretKey();
  const ephemeralPoint = secp256k1.getPublicKey(ephemeralSecret, false);

  // go-ethereum's GenerateShared keeps only the X coordinate, left padded to
  // 32 bytes; the uncompressed shared point is 0x04 || X || Y.
  const sharedPoint = secp256k1.getSharedSecret(ephemeralSecret, teePublicKey, false);
  const sharedSecret = sharedPoint.subarray(1, 1 + COORDINATE_BYTES);

  const derived = concatKdf(sharedSecret, KEY_LENGTH_BYTES * 2);
  const encryptionKey = derived.subarray(0, KEY_LENGTH_BYTES);
  const macKey = sha256(derived.subarray(KEY_LENGTH_BYTES));

  const initialisationVector = crypto.getRandomValues(new Uint8Array(KEY_LENGTH_BYTES));
  const cipherBody = ctr(encryptionKey, initialisationVector).encrypt(plaintext);

  const encryptedMessage = new Uint8Array(
    initialisationVector.length + cipherBody.length,
  );
  encryptedMessage.set(initialisationVector, 0);
  encryptedMessage.set(cipherBody, initialisationVector.length);

  const tag = hmac(sha256, macKey, encryptedMessage);

  const ciphertext = new Uint8Array(
    ephemeralPoint.length + encryptedMessage.length + tag.length,
  );
  ciphertext.set(ephemeralPoint, 0);
  ciphertext.set(encryptedMessage, ephemeralPoint.length);
  ciphertext.set(tag, ephemeralPoint.length + encryptedMessage.length);
  return ciphertext;
}
