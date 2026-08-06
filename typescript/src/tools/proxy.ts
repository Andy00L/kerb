/**
 * Extension proxy client.
 *
 * FCC delivers no on-chain callback: an instruction's result is stored on the
 * proxy and has to be fetched over HTTP, then relayed on-chain by whoever wants
 * it recorded. This module is the fetch half.
 */

/** Mirrors ActionResult in the TEE node. */
export interface ActionResult {
  readonly id: string;
  readonly submissionTag: string;
  readonly status: number;
  readonly log: string;
  readonly data: string;
}

/** Mirrors ActionResponse in the TEE node. */
export interface ActionResponse {
  readonly result: ActionResult;
  /** TEE signature over the ActionResult hash. This is what the contract checks. */
  readonly signature: string;
  /** Proxy signature, recomputed per request. Not used on-chain. */
  readonly proxySignature: string;
}

/**
 * Chain-relayed instructions are stored under the tags "threshold" and "end",
 * never "submit". Asking for a specific tag returns that delivery pass as-is,
 * and the "end" pass carries the providers' vote aggregate instead of the
 * enclave payload. Omitting the tag returns the raw enclave result (data =
 * the extension's ABI payload, signature = the TEE signature the contract
 * verifies), which is what a relayer needs. Verified live on Coston2.
 */
export const DEFAULT_SUBMISSION_TAG: string | undefined = undefined;

function isActionResponse(candidate: unknown): candidate is ActionResponse {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const response = candidate as ActionResponse;
  return (
    typeof response.signature === 'string' &&
    typeof response.result === 'object' &&
    response.result !== null &&
    typeof response.result.status === 'number'
  );
}

/**
 * Fetch one action result.
 *
 * @returns The response, or null while the proxy has nothing stored. The proxy
 *          answers 404 until a result arrives, which is a normal waiting state
 *          rather than a failure.
 * @throws On any other HTTP or transport failure.
 */
export async function fetchActionResult(
  proxyUrl: string,
  actionId: string,
  submissionTag: string | undefined = DEFAULT_SUBMISSION_TAG,
  timeoutMs = 15_000,
): Promise<ActionResponse | null> {
  const base = `${proxyUrl.replace(/\/$/, '')}/action/result/${actionId}`;
  const url = submissionTag === undefined ? base : `${base}?submissionTag=${submissionTag}`;

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, { signal: abortController.signal });
  } catch (requestError) {
    if (abortController.signal.aborted) {
      throw new Error(`proxy request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`proxy request failed: ${requestError}`);
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (response.status === 404) {
    return null;
  }

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`proxy returned ${response.status}: ${rawBody}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (parseError) {
    throw new Error(`proxy response is not JSON: ${parseError}`);
  }
  if (!isActionResponse(parsed)) {
    throw new Error('proxy response is missing result or signature');
  }
  return parsed;
}

/**
 * Poll until a final result is stored.
 *
 * Status 0 and 1 are final and are returned as-is. Status 2 and above mean the
 * enclave is still working, so polling continues.
 *
 * @throws When the deadline passes with no final result.
 */
export async function waitForActionResult(
  proxyUrl: string,
  actionId: string,
  options: { submissionTag?: string; timeoutMs?: number; intervalMs?: number } = {},
): Promise<ActionResponse> {
  const submissionTag = options.submissionTag ?? DEFAULT_SUBMISSION_TAG;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const response = await fetchActionResult(proxyUrl, actionId, submissionTag);
    if (response !== null && response.result.status < 2) {
      return response;
    }
    if (Date.now() >= deadline) {
      const state = response === null ? 'no result stored' : `status ${response.result.status}`;
      throw new Error(`timed out waiting for ${actionId}: ${state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
