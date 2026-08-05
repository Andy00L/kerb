/**
 * Mandate schema and validation.
 *
 * A mandate is the confidential order the user encrypts to the TEE public key.
 * It is the only untrusted input the enclave ever parses, so validation is
 * strict: unknown fields are rejected rather than ignored, every amount is
 * parsed into integer drops (never a float), and every bound is checked before
 * a mandate is admitted. Callers get errors as values, never exceptions.
 */

import { isValidClassicAddress } from 'xrpl';
import {
  DROPS_PER_XRP,
  MAX_DCA_EXECUTIONS,
  MAX_JITTER_PERCENT,
  MAX_MANDATE_LIFETIME_SECONDS,
  MAX_MANDATE_TOTAL_DROPS,
  MAX_SLIPPAGE_PERCENT,
  MIN_DCA_INTERVAL_SECONDS,
  MIN_SLICE_DROPS,
  MIN_SLIPPAGE_PERCENT,
} from './config.js';

/** Errors as values: every validator returns one of these. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export type MandateSide = 'buy' | 'sell';
export type MandateKind = 'stop' | 'limit' | 'dca';
export type TriggerOperator = 'lte' | 'gte';

/**
 * Fixed-point scale used for every price comparison inside the enclave.
 * FTSOv2 returns a mantissa plus a decimals field; both the feed value and the
 * mandate trigger price are normalised to this scale so the comparison is exact
 * integer arithmetic rather than floating point.
 */
export const PRICE_SCALE_DECIMALS = 12;
export const PRICE_SCALE = 10n ** BigInt(PRICE_SCALE_DECIMALS);

/** The trading pairs this build supports. */
export const SUPPORTED_PAIRS = ['XRP/USD'] as const;
export type SupportedPair = (typeof SUPPORTED_PAIRS)[number];

/** A validated mandate: amounts are integer drops, prices are scaled integers. */
export interface ValidatedMandate {
  readonly version: 1;
  readonly pair: SupportedPair;
  readonly side: MandateSide;
  readonly kind: MandateKind;
  readonly feedId: string;
  readonly triggerOperator: TriggerOperator;
  readonly triggerPriceScaled: bigint;
  readonly totalDrops: bigint;
  readonly sliceDrops: bigint;
  readonly jitterPercent: number;
  readonly maxSlippagePercent: number;
  readonly dcaIntervalSeconds: number | null;
  readonly dcaExecutions: number | null;
  readonly expiryUnixSeconds: number;
  readonly payoutAddress: string;
}

const TOP_LEVEL_KEYS = [
  'v',
  'pair',
  'side',
  'kind',
  'trigger',
  'size',
  'bound',
  'dca',
  'expiry',
  'payout',
] as const;

const TRIGGER_KEYS = ['feedId', 'op', 'price'] as const;
const SIZE_KEYS = ['total', 'slice', 'jitterPct'] as const;
const BOUND_KEYS = ['maxSlippagePct'] as const;
const DCA_KEYS = ['everySec', 'times'] as const;
const PAYOUT_KEYS = ['xrplAddress'] as const;

/** XRP carries exactly 6 decimal places (sourceRef: https://xrpl.org/currency-formats.html). */
const XRP_DECIMAL_PLACES = 6;
const XRP_AMOUNT_PATTERN = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/;
const PRICE_PATTERN = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,12})?$/;
/** FTSOv2 feed ids are 21 bytes: one category byte plus a 20 byte name. */
const FEED_ID_PATTERN = /^0x[0-9a-f]{42}$/;

function isPlainObject(candidate: unknown): candidate is Record<string, unknown> {
  return (
    typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
  );
}

/** Reject any field the schema does not define, so typos never pass silently. */
function rejectUnknownKeys(
  container: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): string | null {
  for (const presentKey of Object.keys(container)) {
    if (!allowedKeys.includes(presentKey)) {
      return `${path}: unknown field "${presentKey}"`;
    }
  }
  return null;
}

/**
 * Parse a decimal string into an exact integer amount at the given scale.
 * Money never goes through a float: the string is split on the decimal point
 * and recombined with BigInt arithmetic.
 */
function parseDecimalToScaledInteger(
  text: string,
  scaleDecimals: number,
): bigint {
  const [wholePart, fractionPart = ''] = text.split('.');
  const paddedFraction = fractionPart.padEnd(scaleDecimals, '0');
  return BigInt(wholePart) * 10n ** BigInt(scaleDecimals) + BigInt(paddedFraction);
}

/** Convert a decimal XRP string into drops. */
export function parseXrpAmountToDrops(text: unknown, path: string): ParseResult<bigint> {
  if (typeof text !== 'string' || !XRP_AMOUNT_PATTERN.test(text)) {
    return {
      ok: false,
      reason: `${path}: expected a decimal XRP amount with at most ${XRP_DECIMAL_PLACES} decimals`,
    };
  }
  const drops = parseDecimalToScaledInteger(text, XRP_DECIMAL_PLACES);
  if (drops <= 0n) {
    return { ok: false, reason: `${path}: must be greater than zero` };
  }
  return { ok: true, value: drops };
}

/** Convert a decimal price string into the enclave's fixed-point scale. */
export function parsePriceToScaled(text: unknown, path: string): ParseResult<bigint> {
  if (typeof text !== 'string' || !PRICE_PATTERN.test(text)) {
    return {
      ok: false,
      reason: `${path}: expected a decimal price with at most ${PRICE_SCALE_DECIMALS} decimals`,
    };
  }
  const scaled = parseDecimalToScaledInteger(text, PRICE_SCALE_DECIMALS);
  if (scaled <= 0n) {
    return { ok: false, reason: `${path}: must be greater than zero` };
  }
  return { ok: true, value: scaled };
}

function parseIntegerInRange(
  candidate: unknown,
  path: string,
  minimum: number,
  maximum: number,
): ParseResult<number> {
  if (typeof candidate !== 'number' || !Number.isInteger(candidate)) {
    return { ok: false, reason: `${path}: expected an integer` };
  }
  if (candidate < minimum || candidate > maximum) {
    return { ok: false, reason: `${path}: must be between ${minimum} and ${maximum}` };
  }
  return { ok: true, value: candidate };
}

function parseNumberInRange(
  candidate: unknown,
  path: string,
  minimum: number,
  maximum: number,
): ParseResult<number> {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    return { ok: false, reason: `${path}: expected a finite number` };
  }
  if (candidate < minimum || candidate > maximum) {
    return { ok: false, reason: `${path}: must be between ${minimum} and ${maximum}` };
  }
  return { ok: true, value: candidate };
}

/**
 * Validate a decoded mandate document.
 *
 * @param document  The parsed JSON the enclave decrypted. Untrusted.
 * @param nowUnixSeconds  Current time, injected so the check stays pure and testable.
 */
export function validateMandate(
  document: unknown,
  nowUnixSeconds: number,
): ParseResult<ValidatedMandate> {
  if (!isPlainObject(document)) {
    return { ok: false, reason: 'mandate: expected a JSON object' };
  }

  const unknownTopLevel = rejectUnknownKeys(document, TOP_LEVEL_KEYS, 'mandate');
  if (unknownTopLevel !== null) {
    return { ok: false, reason: unknownTopLevel };
  }

  if (document.v !== 1) {
    return { ok: false, reason: 'mandate.v: only schema version 1 is supported' };
  }

  const pair = document.pair;
  if (typeof pair !== 'string' || !SUPPORTED_PAIRS.includes(pair as SupportedPair)) {
    return {
      ok: false,
      reason: `mandate.pair: must be one of ${SUPPORTED_PAIRS.join(', ')}`,
    };
  }

  const side = document.side;
  if (side !== 'buy' && side !== 'sell') {
    return { ok: false, reason: 'mandate.side: must be "buy" or "sell"' };
  }

  const kind = document.kind;
  if (kind !== 'stop' && kind !== 'limit' && kind !== 'dca') {
    return { ok: false, reason: 'mandate.kind: must be "stop", "limit" or "dca"' };
  }

  // --- trigger ---
  const trigger = document.trigger;
  if (!isPlainObject(trigger)) {
    return { ok: false, reason: 'mandate.trigger: expected an object' };
  }
  const unknownTrigger = rejectUnknownKeys(trigger, TRIGGER_KEYS, 'mandate.trigger');
  if (unknownTrigger !== null) {
    return { ok: false, reason: unknownTrigger };
  }
  const feedId = trigger.feedId;
  if (typeof feedId !== 'string' || !FEED_ID_PATTERN.test(feedId)) {
    return {
      ok: false,
      reason: 'mandate.trigger.feedId: expected a lowercase 21 byte hex feed id',
    };
  }
  const triggerOperator = trigger.op;
  if (triggerOperator !== 'lte' && triggerOperator !== 'gte') {
    return { ok: false, reason: 'mandate.trigger.op: must be "lte" or "gte"' };
  }
  const triggerPrice = parsePriceToScaled(trigger.price, 'mandate.trigger.price');
  if (!triggerPrice.ok) {
    return triggerPrice;
  }

  // --- size ---
  const size = document.size;
  if (!isPlainObject(size)) {
    return { ok: false, reason: 'mandate.size: expected an object' };
  }
  const unknownSize = rejectUnknownKeys(size, SIZE_KEYS, 'mandate.size');
  if (unknownSize !== null) {
    return { ok: false, reason: unknownSize };
  }
  const totalDrops = parseXrpAmountToDrops(size.total, 'mandate.size.total');
  if (!totalDrops.ok) {
    return totalDrops;
  }
  if (totalDrops.value > MAX_MANDATE_TOTAL_DROPS) {
    return {
      ok: false,
      reason: `mandate.size.total: exceeds the ${MAX_MANDATE_TOTAL_DROPS / DROPS_PER_XRP} XRP cap`,
    };
  }
  const sliceDrops = parseXrpAmountToDrops(size.slice, 'mandate.size.slice');
  if (!sliceDrops.ok) {
    return sliceDrops;
  }
  if (sliceDrops.value < MIN_SLICE_DROPS) {
    return {
      ok: false,
      reason: `mandate.size.slice: must be at least ${MIN_SLICE_DROPS / DROPS_PER_XRP} XRP`,
    };
  }
  if (sliceDrops.value > totalDrops.value) {
    return { ok: false, reason: 'mandate.size.slice: must not exceed mandate.size.total' };
  }
  const jitterPercent = parseIntegerInRange(
    size.jitterPct,
    'mandate.size.jitterPct',
    0,
    MAX_JITTER_PERCENT,
  );
  if (!jitterPercent.ok) {
    return jitterPercent;
  }

  // --- bound ---
  const bound = document.bound;
  if (!isPlainObject(bound)) {
    return { ok: false, reason: 'mandate.bound: expected an object' };
  }
  const unknownBound = rejectUnknownKeys(bound, BOUND_KEYS, 'mandate.bound');
  if (unknownBound !== null) {
    return { ok: false, reason: unknownBound };
  }
  const maxSlippagePercent = parseNumberInRange(
    bound.maxSlippagePct,
    'mandate.bound.maxSlippagePct',
    MIN_SLIPPAGE_PERCENT,
    MAX_SLIPPAGE_PERCENT,
  );
  if (!maxSlippagePercent.ok) {
    return maxSlippagePercent;
  }

  // --- dca: required for kind "dca", forbidden otherwise ---
  let dcaIntervalSeconds: number | null = null;
  let dcaExecutions: number | null = null;
  if (kind === 'dca') {
    const dca = document.dca;
    if (!isPlainObject(dca)) {
      return { ok: false, reason: 'mandate.dca: required when kind is "dca"' };
    }
    const unknownDca = rejectUnknownKeys(dca, DCA_KEYS, 'mandate.dca');
    if (unknownDca !== null) {
      return { ok: false, reason: unknownDca };
    }
    const interval = parseIntegerInRange(
      dca.everySec,
      'mandate.dca.everySec',
      MIN_DCA_INTERVAL_SECONDS,
      MAX_MANDATE_LIFETIME_SECONDS,
    );
    if (!interval.ok) {
      return interval;
    }
    const executions = parseIntegerInRange(
      dca.times,
      'mandate.dca.times',
      1,
      MAX_DCA_EXECUTIONS,
    );
    if (!executions.ok) {
      return executions;
    }
    if (sliceDrops.value * BigInt(executions.value) > totalDrops.value) {
      return {
        ok: false,
        reason: 'mandate.dca: slice multiplied by times exceeds mandate.size.total',
      };
    }
    dcaIntervalSeconds = interval.value;
    dcaExecutions = executions.value;
  } else if (document.dca !== undefined) {
    return { ok: false, reason: 'mandate.dca: only allowed when kind is "dca"' };
  }

  // --- expiry ---
  const expiry = document.expiry;
  if (typeof expiry !== 'number' || !Number.isInteger(expiry)) {
    return { ok: false, reason: 'mandate.expiry: expected a unix timestamp in seconds' };
  }
  if (expiry <= nowUnixSeconds) {
    return { ok: false, reason: 'mandate.expiry: must be in the future' };
  }
  if (expiry > nowUnixSeconds + MAX_MANDATE_LIFETIME_SECONDS) {
    return {
      ok: false,
      reason: `mandate.expiry: must be within ${MAX_MANDATE_LIFETIME_SECONDS} seconds from now`,
    };
  }

  // --- payout ---
  const payout = document.payout;
  if (!isPlainObject(payout)) {
    return { ok: false, reason: 'mandate.payout: expected an object' };
  }
  const unknownPayout = rejectUnknownKeys(payout, PAYOUT_KEYS, 'mandate.payout');
  if (unknownPayout !== null) {
    return { ok: false, reason: unknownPayout };
  }
  const payoutAddress = payout.xrplAddress;
  if (typeof payoutAddress !== 'string' || !isValidClassicAddress(payoutAddress)) {
    return {
      ok: false,
      reason: 'mandate.payout.xrplAddress: expected a valid XRPL classic address',
    };
  }

  return {
    ok: true,
    value: {
      version: 1,
      pair: pair as SupportedPair,
      side,
      kind,
      feedId,
      triggerOperator,
      triggerPriceScaled: triggerPrice.value,
      totalDrops: totalDrops.value,
      sliceDrops: sliceDrops.value,
      jitterPercent: jitterPercent.value,
      maxSlippagePercent: maxSlippagePercent.value,
      dcaIntervalSeconds,
      dcaExecutions,
      expiryUnixSeconds: expiry,
      payoutAddress,
    },
  };
}

/**
 * Decode the decrypted mandate bytes into a validated mandate.
 * Kept separate from validateMandate so the JSON failure mode reports a
 * different, actionable reason from a schema failure.
 */
export function decodeMandate(
  plaintext: Uint8Array,
  nowUnixSeconds: number,
): ParseResult<ValidatedMandate> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch (decodeError) {
    return { ok: false, reason: `mandate: plaintext is not valid UTF-8: ${decodeError}` };
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (parseError) {
    return { ok: false, reason: `mandate: plaintext is not valid JSON: ${parseError}` };
  }

  return validateMandate(document, nowUnixSeconds);
}
