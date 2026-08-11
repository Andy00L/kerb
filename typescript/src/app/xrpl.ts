/**
 * XRPL execution: order construction, slice sizing and submission.
 *
 * Order building is kept pure and separate from the network client so the
 * slippage bound and the slice arithmetic can be tested without a ledger. Every
 * amount is integer arithmetic: drops for XRP, fixed-point scaled integers for
 * prices and issued-currency values. No float ever touches an order.
 */

import { Client, getBalanceChanges, type OfferCreate, type Payment, type Wallet } from 'xrpl';
import { DROPS_PER_XRP } from './config.js';
import { PRICE_SCALE, PRICE_SCALE_DECIMALS, type MandateSide } from './mandate.js';

/**
 * OfferCreate flags.
 * tfImmediateOrCancel fills what it can at once and cancels the rest, so no
 * resting order is ever left on the book advertising the strategy.
 * tfSell exchanges the entire TakerGets amount, which makes TakerPays a floor
 * rather than an exact price.
 * sourceRef: https://xrpl.org/offercreate.html
 */
export const TF_IMMEDIATE_OR_CANCEL = 0x00020000;
export const TF_SELL = 0x00080000;

/** Issued currency leg of the pair, for example test USD from a demo issuer. */
export interface IssuedCurrency {
  readonly currency: string;
  readonly issuer: string;
}

/** Maximum significant digits an XRPL issued-currency value may carry. */
const IOU_SIGNIFICANT_DIGITS = 15;

/** Rounding direction applied when an issued value must lose precision. */
export type IouRounding = 'floor' | 'ceil';

/**
 * Render a fixed-point integer as an XRPL issued-currency value string.
 *
 * XRPL rejects issued amounts with more than 15 significant digits, so the
 * value is rounded to fit. The caller picks the direction: 'floor' when the
 * amount is a ceiling that must never grow (a buy's maximum spend), 'ceil'
 * when it is a floor that must never shrink (a sell's minimum proceeds).
 */
export function formatIouValue(
  scaledAmount: bigint,
  rounding: IouRounding = 'floor',
  scaleDecimals: number = PRICE_SCALE_DECIMALS,
): string {
  if (scaledAmount < 0n) {
    throw new Error('issued amount must not be negative');
  }
  const divisor = 10n ** BigInt(scaleDecimals);
  const wholePart = scaledAmount / divisor;
  const fractionPart = scaledAmount % divisor;

  const wholeText = wholePart.toString();
  const fractionText = fractionPart.toString().padStart(scaleDecimals, '0');
  const joined = `${wholeText}.${fractionText}`.replace(/0+$/, '').replace(/\.$/, '');

  // Trailing zeros cost no mantissa precision on XRPL, so significant digits
  // are counted on the scaled integer with its trailing zeros stripped. This
  // also keeps the recursion terminating when the excess digits are zeros.
  const integerText = scaledAmount.toString();
  const strippedText = integerText.replace(/0+$/, '');
  if (strippedText.length <= IOU_SIGNIFICANT_DIGITS) {
    return joined;
  }

  const excessDigits = strippedText.length - IOU_SIGNIFICANT_DIGITS;
  const trailingZeroCount = integerText.length - strippedText.length;
  const step = 10n ** BigInt(excessDigits + trailingZeroCount);
  const floored = scaledAmount - (scaledAmount % step);
  const rounded = rounding === 'ceil' && floored !== scaledAmount ? floored + step : floored;
  return formatIouValue(rounded, rounding, scaleDecimals);
}

/**
 * Convert a slice of XRP into the counter-currency amount at a given price.
 *
 * @param sliceDrops Size of the slice, in drops.
 * @param priceScaled Counter-currency per XRP, at PRICE_SCALE.
 * @returns Counter-currency amount, at PRICE_SCALE.
 */
export function convertDropsToCounter(sliceDrops: bigint, priceScaled: bigint): bigint {
  return (sliceDrops * priceScaled) / DROPS_PER_XRP;
}

/**
 * Apply the slippage bound.
 *
 * Percent is converted to basis points so the arithmetic stays integral. When
 * selling, the bound is a floor on what must be received; when buying, it is a
 * ceiling on what may be spent.
 */
export function applySlippageBound(
  counterAmountScaled: bigint,
  maxSlippagePercent: number,
  side: MandateSide,
): bigint {
  const basisPoints = BigInt(Math.round(maxSlippagePercent * 100));
  if (side === 'sell') {
    return (counterAmountScaled * (10_000n - basisPoints)) / 10_000n;
  }
  return (counterAmountScaled * (10_000n + basisPoints)) / 10_000n;
}

/**
 * Size the next slice, with optional jitter.
 *
 * Jitter randomises the visible shape of the order so a watcher cannot infer
 * the total from a regular drip. It never exceeds what is left to trade, and it
 * never produces a zero slice while anything remains.
 *
 * @param remainingDrops What is still to be traded.
 * @param sliceDrops Nominal slice size from the mandate.
 * @param jitterPercent Randomisation band, 0 to 50.
 * @param randomFraction Injected source of randomness in [0, 1).
 */
export function computeSliceDrops(
  remainingDrops: bigint,
  sliceDrops: bigint,
  jitterPercent: number,
  randomFraction: number,
): bigint {
  if (remainingDrops <= 0n) {
    return 0n;
  }
  const nominal = sliceDrops < remainingDrops ? sliceDrops : remainingDrops;
  if (jitterPercent === 0) {
    return nominal;
  }

  // Map [0, 1) onto [-jitter, +jitter] in basis points, integer throughout.
  const bandBasisPoints = BigInt(jitterPercent) * 100n;
  const offsetBasisPoints =
    (BigInt(Math.floor(randomFraction * 20_000)) * bandBasisPoints) / 10_000n - bandBasisPoints;
  const jittered = (nominal * (10_000n + offsetBasisPoints)) / 10_000n;

  if (jittered <= 0n) {
    return 1n;
  }
  return jittered < remainingDrops ? jittered : remainingDrops;
}

/** Everything needed to build one slice order. */
export interface OfferParameters {
  readonly account: string;
  readonly side: MandateSide;
  readonly sliceDrops: bigint;
  readonly priceScaled: bigint;
  readonly maxSlippagePercent: number;
  readonly counterCurrency: IssuedCurrency;
}

/**
 * Build an immediate-or-cancel OfferCreate for one slice.
 *
 * Selling XRP: TakerGets is the XRP being given up, TakerPays is the minimum
 * counter-currency that must come back. Buying XRP: TakerGets is the maximum
 * counter-currency that may be spent, TakerPays is the XRP wanted.
 */
export function buildOfferCreate(parameters: OfferParameters): OfferCreate {
  if (parameters.sliceDrops <= 0n) {
    throw new Error('slice size must be positive');
  }

  const counterAtMid = convertDropsToCounter(parameters.sliceDrops, parameters.priceScaled);
  const bounded = applySlippageBound(
    counterAtMid,
    parameters.maxSlippagePercent,
    parameters.side,
  );
  if (bounded <= 0n) {
    throw new Error('slippage bound collapsed the order to zero');
  }

  const isSell = parameters.side === 'sell';
  const issuedAmount = {
    currency: parameters.counterCurrency.currency,
    issuer: parameters.counterCurrency.issuer,
    // A sell's TakerPays is a floor on proceeds, so precision loss must round
    // up; a buy's TakerGets is a ceiling on spend, so it must round down.
    value: formatIouValue(bounded, isSell ? 'ceil' : 'floor'),
  };
  const xrpAmount = parameters.sliceDrops.toString();

  return {
    TransactionType: 'OfferCreate',
    Account: parameters.account,
    TakerGets: isSell ? xrpAmount : issuedAmount,
    TakerPays: isSell ? issuedAmount : xrpAmount,
    Flags: TF_IMMEDIATE_OR_CANCEL | (isSell ? TF_SELL : 0),
  } as OfferCreate;
}

/** Build the settlement payment that returns XRP proceeds to the user. */
export function buildSettlementPayment(
  account: string,
  destination: string,
  amountDrops: bigint,
): Payment {
  if (amountDrops <= 0n) {
    throw new Error('settlement amount must be positive');
  }
  return {
    TransactionType: 'Payment',
    Account: account,
    Destination: destination,
    Amount: amountDrops.toString(),
  } as Payment;
}

/** True when a ledger-reported issued balance is strictly positive. */
export function isPositiveIouValue(value: string): boolean {
  return !value.startsWith('-') && /[1-9]/.test(value);
}

/** Build the settlement payment that returns issued-currency proceeds to the user. */
export function buildIouSettlementPayment(
  account: string,
  destination: string,
  counterCurrency: IssuedCurrency,
  value: string,
): Payment {
  if (!isPositiveIouValue(value)) {
    throw new Error('issued settlement value must be positive');
  }
  return {
    TransactionType: 'Payment',
    Account: account,
    Destination: destination,
    Amount: {
      currency: counterCurrency.currency,
      issuer: counterCurrency.issuer,
      value,
    },
  } as Payment;
}

/**
 * Drops left behind to cover the settlement transaction fee. The reference fee
 * is 10 drops but rises under load, so the cushion is generous; anything unused
 * stays in the discarded deposit account.
 * sourceRef: https://xrpl.org/transaction-cost.html
 */
export const FEE_CUSHION_DROPS = 1_000n;

/** Outcome of submitting one slice. */
export interface SubmissionOutcome {
  readonly transactionHash: string;
  readonly engineResult: string;
  readonly validated: boolean;
  /** Fee the signing account paid, in drops. */
  readonly feeDrops: bigint;
  /**
   * Net XRP change of the signing account in the validated transaction, in
   * drops (fee included, negative when the account paid out). Null only when
   * the ledger returned no usable metadata.
   */
  readonly accountXrpDeltaDrops: bigint | null;
}

/** Signed decimal XRP string, as getBalanceChanges reports it, to drops. */
export function parseSignedXrpToDrops(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (match === null) {
    throw new Error(`not an XRP amount: ${value}`);
  }
  const [, sign, wholePart, fractionPart = ''] = match;
  const drops = BigInt(wholePart) * DROPS_PER_XRP + BigInt(fractionPart.padEnd(6, '0'));
  return sign === '-' ? -drops : drops;
}

/**
 * XRP actually moved by one slice, measured from the account's validated
 * balance change rather than assumed from the order size: an
 * immediate-or-cancel OfferCreate returns tesSUCCESS even when it crosses
 * nothing or fills partially, so the requested slice is only an upper bound.
 *
 * When the metadata is unavailable the full slice is assumed. That errs on
 * the side of over-counting, which stops the mandate early and leaves the
 * remainder for settlement to refund; under-counting would re-trade and could
 * spend past the mandate total.
 */
export function measureFilledDrops(
  side: MandateSide,
  sliceDrops: bigint,
  feeDrops: bigint,
  accountXrpDeltaDrops: bigint | null,
): bigint {
  if (accountXrpDeltaDrops === null) {
    return sliceDrops;
  }
  const movedDrops =
    side === 'sell'
      ? -accountXrpDeltaDrops - feeDrops
      : accountXrpDeltaDrops + feeDrops;
  if (movedDrops <= 0n) {
    return 0n;
  }
  return movedDrops < sliceDrops ? movedDrops : sliceDrops;
}

/** The ledger operations the engine depends on, an interface so tests can fake it. */
export interface LedgerGateway {
  submit(transaction: OfferCreate | Payment, wallet: Wallet): Promise<SubmissionOutcome>;
  readSpendableDrops(address: string): Promise<bigint>;
  readIouBalanceValue(address: string, counterCurrency: IssuedCurrency): Promise<string>;
  hasTrustline(address: string, counterCurrency: IssuedCurrency): Promise<boolean>;
}

/**
 * Thin wrapper over the XRPL client.
 *
 * Kept deliberately small: everything that decides what to trade lives in the
 * pure functions above, so the only responsibility here is connection handling
 * and submission.
 */
export class XrplExecutor implements LedgerGateway {
  private readonly client: Client;

  constructor(endpoint: string) {
    // The 5s xrpl.js default regularly misses the first connect to the public
    // testnet; 20s absorbs it (observed live).
    this.client = new Client(endpoint, { connectionTimeout: 20_000 });
  }

  async connect(): Promise<void> {
    if (!this.client.isConnected()) {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.client.isConnected()) {
      await this.client.disconnect();
    }
  }

  /**
   * Autofill, sign in the enclave and submit, waiting for validation.
   *
   * @throws When the ledger rejects the transaction outright. A partial or
   *         unfilled immediate-or-cancel order is not an error: it returns with
   *         its engine result for the caller to interpret.
   */
  async submit(
    transaction: OfferCreate | Payment,
    wallet: Wallet,
  ): Promise<SubmissionOutcome> {
    await this.connect();
    const prepared = await this.client.autofill(transaction);
    const signed = wallet.sign(prepared);
    const response = await this.client.submitAndWait(signed.tx_blob);

    const meta =
      typeof response.result.meta === 'object' && response.result.meta !== null
        ? response.result.meta
        : null;
    const engineResult = meta === null ? 'unknown' : meta.TransactionResult;

    // The account's own XRP balance change is the ground truth for how much a
    // slice actually moved; the fee is read from the autofilled transaction so
    // callers can separate it from the traded amount.
    let accountXrpDeltaDrops: bigint | null = null;
    if (meta !== null) {
      const ownChanges = getBalanceChanges(meta).find(
        (change) => change.account === wallet.classicAddress,
      );
      const xrpChange = ownChanges?.balances.find(
        (balance) => balance.issuer === undefined && balance.currency === 'XRP',
      );
      if (xrpChange !== undefined) {
        accountXrpDeltaDrops = parseSignedXrpToDrops(xrpChange.value);
      }
    }

    return {
      transactionHash: signed.hash,
      engineResult,
      validated: response.result.validated === true,
      feeDrops: BigInt(prepared.Fee ?? '0'),
      accountXrpDeltaDrops,
    };
  }

  /**
   * Drops the account can actually send: balance minus the reserve and the fee
   * cushion. XRPL rejects a payment that would leave the sender below its
   * reserve, so paying out the raw balance would always fail.
   * sourceRef: https://xrpl.org/reserves.html
   */
  async readSpendableDrops(address: string): Promise<bigint> {
    await this.connect();
    let balanceDrops: bigint;
    let ownerCount: bigint;
    try {
      const response = await this.client.request({
        command: 'account_info',
        account: address,
        ledger_index: 'validated',
      });
      balanceDrops = BigInt(response.result.account_data.Balance);
      ownerCount = BigInt(response.result.account_data.OwnerCount);
    } catch (lookupError) {
      // actNotFound simply means nothing has ever funded the address.
      if (String(lookupError).includes('actNotFound')) {
        return 0n;
      }
      throw lookupError;
    }

    const stateResponse = await this.client.request({ command: 'server_state' });
    const validatedLedger = stateResponse.result.state.validated_ledger;
    if (validatedLedger === undefined) {
      throw new Error('server_state reported no validated ledger');
    }
    const reserveDrops =
      BigInt(validatedLedger.reserve_base) + BigInt(validatedLedger.reserve_inc) * ownerCount;
    const spendableDrops = balanceDrops - reserveDrops - FEE_CUSHION_DROPS;
    return spendableDrops > 0n ? spendableDrops : 0n;
  }

  /**
   * Issued-currency balance held against the counter issuer, as the ledger's
   * decimal string. "0" when the account or the trustline does not exist.
   */
  async readIouBalanceValue(address: string, counterCurrency: IssuedCurrency): Promise<string> {
    const line = await this.findTrustline(address, counterCurrency);
    return line?.balance ?? '0';
  }

  /**
   * Whether the account has a trustline for the counter currency.
   *
   * Acquiring a currency through a DEX fill creates a line implicitly, but a
   * Payment never does (sourceRef: https://xrpl.org/offers.html, "Offers and
   * Trust"), so a payout destination without one cannot receive the proceeds.
   */
  async hasTrustline(address: string, counterCurrency: IssuedCurrency): Promise<boolean> {
    const line = await this.findTrustline(address, counterCurrency);
    return line !== undefined;
  }

  /** The account's line for the counter currency, or undefined when absent. */
  private async findTrustline(
    address: string,
    counterCurrency: IssuedCurrency,
  ): Promise<{ balance: string } | undefined> {
    await this.connect();
    try {
      const response = await this.client.request({
        command: 'account_lines',
        account: address,
        peer: counterCurrency.issuer,
        ledger_index: 'validated',
      });
      return response.result.lines.find(
        (trustline) => trustline.currency === counterCurrency.currency,
      );
    } catch (lookupError) {
      if (String(lookupError).includes('actNotFound')) {
        return undefined;
      }
      throw lookupError;
    }
  }
}

/** Re-exported for callers that build orders without importing the mandate module. */
export { PRICE_SCALE };
