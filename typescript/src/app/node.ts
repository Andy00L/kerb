/**
 * Client for the TEE node's sign server.
 *
 * The node exposes /decrypt on the loopback-only sign port. It is the only way
 * the extension can read a secret that arrived encrypted to the TEE public key.
 * Every call is bounded by a timeout: the framework serializes handler calls, so
 * one request left hanging would stall every later instruction.
 */

import { NODE_REQUEST_TIMEOUT_MS } from './config.js';

/** Request body of POST /decrypt (sourceRef: tee-node pkg/types/extension.go). */
interface DecryptRequestBody {
  encryptedMessage: string;
}

/** Response body of POST /decrypt (sourceRef: tee-node pkg/types/extension.go). */
interface DecryptResponseBody {
  decryptedMessage: string;
}

function isDecryptResponseBody(candidate: unknown): candidate is DecryptResponseBody {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as DecryptResponseBody).decryptedMessage === 'string'
  );
}

/** Talks to the TEE node sign server over loopback. */
export class NodeClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(signPort: string, timeoutMs: number = NODE_REQUEST_TIMEOUT_MS) {
    this.baseUrl = `http://localhost:${signPort}`;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Decrypt a ciphertext that was sealed to the TEE public key.
   *
   * Go marshals []byte as base64, so both directions of the wire format are
   * base64 rather than hex.
   *
   * @param ciphertext Sealed bytes taken from the instruction payload.
   * @returns The plaintext bytes.
   * @throws When the node is unreachable, times out, or refuses the ciphertext.
   */
  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    const body: DecryptRequestBody = {
      encryptedMessage: Buffer.from(ciphertext).toString('base64'),
    };

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/decrypt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
    } catch (requestError) {
      if (abortController.signal.aborted) {
        throw new Error(`decrypt timed out after ${this.timeoutMs}ms`);
      }
      throw new Error(`decrypt request failed: ${requestError}`);
    } finally {
      clearTimeout(timeoutHandle);
    }

    // Read the body exactly once, then decide how to interpret it.
    const rawBody = await response.text();

    if (!response.ok) {
      throw new Error(`node returned ${response.status}: ${rawBody}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (parseError) {
      throw new Error(`decrypt response is not JSON: ${parseError}`);
    }

    if (!isDecryptResponseBody(parsed)) {
      throw new Error('decrypt response is missing decryptedMessage');
    }

    return new Uint8Array(Buffer.from(parsed.decryptedMessage, 'base64'));
  }
}
