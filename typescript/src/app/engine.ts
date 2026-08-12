/**
 * Mandate execution engine.
 *
 * Runs as a background loop inside the enclave, outside the instruction path.
 * For each live mandate it watches the FTSOv2 feed, and once the trigger is
 * confirmed it works the order in slices until the mandate is filled, expires
 * or is cancelled.
 *
 * The hard rule, stated once and enforced in one place: nothing is signed
 * without re-reading the mandate's on-chain status immediately beforehand.
 */

import type { Payment, Wallet } from 'xrpl';
import { TRIGGER_CONFIRMATIONS } from './config.js';
import { isExecutable, MandateStatus, type MandateStatusSource } from './chain.js';
import { TriggerMonitor, XRP_USD_FEED_ID, type PriceFeedSource } from './ftso.js';
import type { ValidatedMandate } from './mandate.js';
import {
  buildIouSettlementPayment,
  buildOfferCreate,
  buildSettlementPayment,
  computeSliceDrops,
  isPositiveIouValue,
  measureFilledDrops,
  type IssuedCurrency,
  type LedgerGateway,
} from './xrpl.js';

/** Terminal outcome of working a mandate. */
export type MandateOutcome = 'filled' | 'expired' | 'cancelled';

/** What the engine reports back on-chain for a mandate. */
export interface ExecutionReport {
  readonly mandateId: bigint;
  readonly status: MandateStatus;
  readonly filledDrops: bigint;
  readonly lastTransactionHash: string;
}

/** Everything the engine needs to work one mandate. */
export interface MandateContext {
  readonly mandateId: bigint;
  readonly mandate: ValidatedMandate;
  readonly wallet: Wallet;
  readonly counterCurrency: IssuedCurrency;
}

/** Collaborators, injected so the engine can be driven in tests. */
export interface EngineDependencies {
  readonly ftsoReader: PriceFeedSource;
  readonly mandateReader: MandateStatusSource;
  readonly xrplExecutor: LedgerGateway;
  readonly randomFraction: () => number;
  readonly nowUnixSeconds: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  /**
   * True once a CANCEL_MANDATE instruction reached the enclave. The on-chain
   * status stays authoritative (the contract cancels before notifying), so
   * this only spares the engine the wait for its next status read.
   */
  readonly isLocallyCancelled: (mandateId: bigint) => boolean;
}

/** What settlement managed to move, and what it could not. */
export interface SettlementReport {
  readonly transactionHashes: readonly string[];
  readonly failures: readonly string[];
}

/** How long to wait between feed reads. The feed itself moves about every 1.8s. */
export const FEED_POLL_INTERVAL_MS = 2_000;

/**
 * Decide whether a mandate has run out of time.
 * Pure, so expiry behaviour is testable without a clock.
 */
export function hasExpired(
  mandate: Pick<ValidatedMandate, 'expiryUnixSeconds'>,
  nowUnixSeconds: number,
): boolean {
  return nowUnixSeconds >= mandate.expiryUnixSeconds;
}

/**
 * Work a single mandate to completion.
 *
 * Returns the outcome and the accumulated report. Errors from a single slice do
 * not abort the mandate: an immediate-or-cancel order that finds no liquidity
 * is a normal event, and the loop retries on the next confirmed trigger.
 */
export class MandateEngine {
  private filledDrops = 0n;
  private lastTransactionHash = '';
  private executionsCompleted = 0;
  private nextDcaDueUnixSeconds = 0;
  private payoutLineChecked = false;

  constructor(
    private readonly context: MandateContext,
    private readonly dependencies: EngineDependencies,
  ) {}

  /** Report reflecting everything executed so far. */
  buildReport(status: MandateStatus): ExecutionReport {
    return {
      mandateId: this.context.mandateId,
      status,
      filledDrops: this.filledDrops,
      lastTransactionHash: this.lastTransactionHash,
    };
  }

  /**
   * Run until the mandate reaches a terminal state.
   *
   * @returns The terminal outcome.
   */
  async run(): Promise<MandateOutcome> {
    const { mandate, mandateId } = this.context;
    const monitor = new TriggerMonitor(
      mandate.triggerOperator,
      mandate.triggerPriceScaled,
      TRIGGER_CONFIRMATIONS,
    );

    for (;;) {
      if (hasExpired(mandate, this.dependencies.nowUnixSeconds())) {
        console.log(`[MandateEngine] mandate ${mandateId} expired`);
        return 'expired';
      }

      if (this.dependencies.isLocallyCancelled(mandateId)) {
        console.log(`[MandateEngine] mandate ${mandateId} cancelled by instruction`);
        return 'cancelled';
      }

      const onChainStatus = await this.readStatus();
      if (onChainStatus === MandateStatus.Cancelled) {
        console.log(`[MandateEngine] mandate ${mandateId} cancelled on-chain`);
        return 'cancelled';
      }

      if (isExecutable(onChainStatus)) {
        if (!this.payoutLineChecked) {
          await this.warnIfPayoutLineMissing();
        }
        const reading = await this.readPrice();
        if (reading !== null && monitor.observe(reading) && this.isSliceDue()) {
          const executionPrice = await this.readExecutionPrice(reading);
          if (executionPrice !== null) {
            monitor.reset();
            const sliceFilled = await this.executeSlice(executionPrice);
            if (sliceFilled) {
              this.recordSliceFilled();
            }

            if (this.isMandateComplete()) {
              console.log(`[MandateEngine] mandate ${mandateId} filled`);
              return 'filled';
            }
          }
        }
      }

      await this.dependencies.sleep(FEED_POLL_INTERVAL_MS);
    }
  }

  /**
   * Warn early when the payout address cannot receive the proceeds.
   *
   * A DEX fill creates the deposit account's line implicitly, but the payout
   * Payment never does: only the user can open a line on their own account.
   * Checking at the start of execution gives them the whole mandate lifetime
   * to fix it instead of discovering it at settlement.
   */
  private async warnIfPayoutLineMissing(): Promise<void> {
    if (this.context.mandate.side !== 'sell') {
      this.payoutLineChecked = true;
      return;
    }
    try {
      const hasLine = await this.dependencies.xrplExecutor.hasTrustline(
        this.context.mandate.payoutAddress,
        this.context.counterCurrency,
      );
      this.payoutLineChecked = true;
      if (!hasLine) {
        console.log(
          `[MandateEngine] mandate ${this.context.mandateId} payout address has no ` +
            `trustline to ${this.context.counterCurrency.issuer}; open one before ` +
            `settlement or the proceeds cannot be delivered`,
        );
      }
    } catch (checkError) {
      // Leave payoutLineChecked false so the next loop retries the check.
      console.log(`[MandateEngine] payout trustline check failed: ${checkError}`);
    }
  }

  /** DCA mandates pace their slices; stop and limit mandates fire whenever confirmed. */
  private isSliceDue(): boolean {
    if (this.context.mandate.kind !== 'dca') {
      return true;
    }
    return this.dependencies.nowUnixSeconds() >= this.nextDcaDueUnixSeconds;
  }

  /** Record a filled slice, advancing the DCA schedule. */
  private recordSliceFilled(): void {
    this.executionsCompleted += 1;
    const { kind, dcaIntervalSeconds } = this.context.mandate;
    if (kind === 'dca' && dcaIntervalSeconds !== null) {
      this.nextDcaDueUnixSeconds = this.dependencies.nowUnixSeconds() + dcaIntervalSeconds;
    }
  }

  /** Filled by size, or for DCA also by the requested number of executions. */
  private isMandateComplete(): boolean {
    const { mandate } = this.context;
    if (this.filledDrops >= mandate.totalDrops) {
      return true;
    }
    return (
      mandate.kind === 'dca' &&
      mandate.dcaExecutions !== null &&
      this.executionsCompleted >= mandate.dcaExecutions
    );
  }

  /**
   * Pay the proceeds out to the mandate's payout address.
   *
   * Called once the mandate reaches a terminal state; the resulting payments
   * are what the FDC settlement proof later attests. Two legs, each attempted
   * independently: the counter-currency balance (a sell's proceeds) and the
   * XRP sitting above the account reserve. A leg that fails is reported, not
   * thrown, so one stuck leg never blocks the other.
   */
  async settle(): Promise<SettlementReport> {
    const transactionHashes: string[] = [];
    const failures: string[] = [];
    const { wallet, mandate, counterCurrency } = this.context;

    try {
      const iouValue = await this.dependencies.xrplExecutor.readIouBalanceValue(
        wallet.classicAddress,
        counterCurrency,
      );
      if (isPositiveIouValue(iouValue)) {
        const payoutHasLine = await this.dependencies.xrplExecutor.hasTrustline(
          mandate.payoutAddress,
          counterCurrency,
        );
        if (!payoutHasLine) {
          failures.push(
            `payout address ${mandate.payoutAddress} has no trustline to ` +
              `${counterCurrency.issuer}; open one, then request settlement again`,
          );
        } else {
          const payment = buildIouSettlementPayment(
            wallet.classicAddress,
            mandate.payoutAddress,
            counterCurrency,
            iouValue,
          );
          await this.submitSettlementLeg('counter-currency', payment, transactionHashes, failures);
        }
      }
    } catch (counterError) {
      failures.push(`counter-currency payout failed: ${counterError}`);
    }

    try {
      const spendableDrops = await this.dependencies.xrplExecutor.readSpendableDrops(
        wallet.classicAddress,
      );
      if (spendableDrops > 0n) {
        const payment = buildSettlementPayment(
          wallet.classicAddress,
          mandate.payoutAddress,
          spendableDrops,
        );
        await this.submitSettlementLeg('xrp', payment, transactionHashes, failures);
      }
    } catch (xrpError) {
      failures.push(`xrp payout failed: ${xrpError}`);
    }

    return { transactionHashes, failures };
  }

  /** Submit one settlement payment; only a validated tesSUCCESS counts as paid. */
  private async submitSettlementLeg(
    legLabel: string,
    payment: Payment,
    transactionHashes: string[],
    failures: string[],
  ): Promise<void> {
    const outcome = await this.dependencies.xrplExecutor.submit(payment, this.context.wallet);
    if (outcome.engineResult === 'tesSUCCESS') {
      transactionHashes.push(outcome.transactionHash);
      this.lastTransactionHash = outcome.transactionHash;
    } else {
      failures.push(`${legLabel} payout rejected: ${outcome.engineResult}`);
    }
  }

  /** Read the on-chain status, treating a read failure as "do not act". */
  private async readStatus(): Promise<MandateStatus> {
    try {
      const record = await this.dependencies.mandateReader.readMandate(this.context.mandateId);
      return record.status;
    } catch (readError) {
      console.log(`[MandateEngine] status read failed: ${readError}`);
      return MandateStatus.None;
    }
  }

  /** Read the trigger feed, returning null when the read fails. */
  private async readPrice(): Promise<bigint | null> {
    try {
      const reading = await this.dependencies.ftsoReader.readFeed(this.context.mandate.feedId);
      return reading.priceScaled;
    } catch (readError) {
      console.log(`[MandateEngine] feed read failed: ${readError}`);
      return null;
    }
  }

  /**
   * Price for the XRPL leg of a slice.
   *
   * Execution is always XRP against the counter currency, so a mandate
   * triggered by another feed (BTC/USD arming an XRP exit, for example) still
   * prices its offers from XRP/USD. When the trigger feed is XRP/USD the
   * confirmed reading is reused, keeping a single read per slice. A failed
   * read skips the slice; the trigger re-confirms on later observations.
   */
  private async readExecutionPrice(triggerPriceScaled: bigint): Promise<bigint | null> {
    if (this.context.mandate.feedId === XRP_USD_FEED_ID) {
      return triggerPriceScaled;
    }
    try {
      const reading = await this.dependencies.ftsoReader.readFeed(XRP_USD_FEED_ID);
      return reading.priceScaled;
    } catch (readError) {
      console.log(`[MandateEngine] execution feed read failed: ${readError}`);
      return null;
    }
  }

  /**
   * Build and submit one slice.
   *
   * The on-chain status is re-read inside this method, immediately before
   * signing, so a cancellation that lands between the trigger and the signature
   * still stops the order.
   *
   * @returns True when the slice actually filled.
   */
  private async executeSlice(priceScaled: bigint): Promise<boolean> {
    const { mandate, mandateId, wallet, counterCurrency } = this.context;

    const remainingDrops = mandate.totalDrops - this.filledDrops;
    const sliceDrops = computeSliceDrops(
      remainingDrops,
      mandate.sliceDrops,
      mandate.jitterPercent,
      this.dependencies.randomFraction(),
    );
    if (sliceDrops <= 0n) {
      return false;
    }

    const statusBeforeSigning = await this.readStatus();
    if (!isExecutable(statusBeforeSigning)) {
      console.log(`[MandateEngine] mandate ${mandateId} no longer executable, slice skipped`);
      return false;
    }

    const offer = buildOfferCreate({
      account: wallet.classicAddress,
      side: mandate.side,
      sliceDrops,
      priceScaled,
      maxSlippagePercent: mandate.maxSlippagePercent,
      counterCurrency,
    });

    try {
      const outcome = await this.dependencies.xrplExecutor.submit(offer, wallet);
      this.lastTransactionHash = outcome.transactionHash;

      // tesSUCCESS is returned even when an immediate-or-cancel order crosses
      // nothing, so the fill is measured from the account's validated balance
      // change instead of assumed from the order size.
      if (outcome.engineResult === 'tesSUCCESS') {
        const filledNow = measureFilledDrops(
          mandate.side,
          sliceDrops,
          outcome.feeDrops,
          outcome.accountXrpDeltaDrops,
        );
        if (filledNow > 0n) {
          this.filledDrops += filledNow;
          console.log(
            `[MandateEngine] mandate ${mandateId} slice filled ${filledNow} of ` +
              `${sliceDrops} drops, tx ${outcome.transactionHash}`,
          );
          return true;
        }
        console.log(
          `[MandateEngine] mandate ${mandateId} slice found no liquidity, ` +
            `tx ${outcome.transactionHash}`,
        );
        return false;
      }
      console.log(
        `[MandateEngine] mandate ${mandateId} slice not filled: ${outcome.engineResult}`,
      );
    } catch (submitError) {
      console.log(`[MandateEngine] mandate ${mandateId} submission failed: ${submitError}`);
    }
    return false;
  }
}
