/** Hex and byte encoding utilities. */

/**
 * Decode a hex string (optional 0x prefix) to a Uint8Array.
 * Strict: Buffer.from(_, "hex") silently truncates at the first invalid pair,
 * which would turn a malformed payload into confusing downstream errors, so
 * the shape is validated before decoding.
 */
export function hexToBytes(h: string): Uint8Array {
  const body = h.startsWith("0x") ? h.slice(2) : h;
  if (body.length === 0) return new Uint8Array(0);
  if (body.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(body)) {
    throw new Error("invalid hex string");
  }
  return new Uint8Array(Buffer.from(body, "hex"));
}

/** Encode a Uint8Array to a 0x-prefixed hex string. */
export function bytesToHex(b: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(b).toString("hex")}`;
}
