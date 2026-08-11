import { describe, expect, it } from 'vitest';
import { Wallet, type OfferCreate, type Payment } from 'xrpl';
import { scaleFeedValue, TriggerMonitor } from '../app/ftso.js';
import { isExecutable, MandateStatus } from '../app/chain.js';
import {
  FEED_POLL_INTERVAL_MS,
  hasExpired,
  MandateEngine,
  type EngineDependencies,
} from '../app/engine.js';
import { PRICE_SCALE, type ValidatedMandate } from '../app/mandate.js';
import {
  applySlippageBound,
  buildIouSettlementPayment,
  buildOfferCreate,
  buildSettlementPayment,
  computeSliceDrops,
  convertDropsToCounter,
  formatIouValue,
  measureFilledDrops,
  parseSignedXrpToDrops,
  TF_IMMEDIATE_OR_CANCEL,
  TF_SELL,
} from '../app/xrpl.js';

const DEMO_ACCOUNT = 'rNMovRR3WPbFLVaSbETCCR71XsqyxhJ9P6';
const DEMO_ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const COUNTER = { currency: 'USD', issuer: DEMO_ISSUER };
/** 2.50 USD per XRP at the enclave price scale. */
const PRICE_2_50 = (250n * PRICE_SCALE) / 100n;

describe('scaleFeedValue', () => {
  it('scales a feed with fewer decimals than the enclave scale', () => {
    // 1.064416 reported with 6 decimals.
    expect(scaleFeedValue(1_064_416n, 6)).toBe(1_064_416_000_000n);
  });

  it('truncates a feed carrying more precision than the enclave scale', () => {
    expect(scaleFeedValue(10n ** 15n + 999n, 15)).toBe(PRICE_SCALE);
  });
});

describe('TriggerMonitor', () => {
  it('fires only after the required consecutive confirmations', () => {
    const monitor = new TriggerMonitor('lte', PRICE_2_50, 3);
    expect(monitor.observe(PRICE_2_50)).toBe(false);
    expect(monitor.observe(PRICE_2_50 - 1n)).toBe(false);
    expect(monitor.observe(PRICE_2_50 - 2n)).toBe(true);
  });

  it('resets the run when a reading breaks the condition', () => {
    const monitor = new TriggerMonitor('lte', PRICE_2_50, 3);
    monitor.observe(PRICE_2_50);
    monitor.observe(PRICE_2_50);
    expect(monitor.streak).toBe(2);
    expect(monitor.observe(PRICE_2_50 + 1n)).toBe(false);
    expect(monitor.streak).toBe(0);
    // A fresh run still needs three readings.
    expect(monitor.observe(PRICE_2_50)).toBe(false);
    expect(monitor.observe(PRICE_2_50)).toBe(false);
    expect(monitor.observe(PRICE_2_50)).toBe(true);
  });

  it('supports the gte direction', () => {
    const monitor = new TriggerMonitor('gte', PRICE_2_50, 1);
    expect(monitor.observe(PRICE_2_50 - 1n)).toBe(false);
    expect(monitor.observe(PRICE_2_50)).toBe(true);
  });

  it('refuses a confirmation count below one', () => {
    expect(() => new TriggerMonitor('lte', PRICE_2_50, 0)).toThrow();
  });
});

describe('slippage and conversion', () => {
  it('converts drops to counter currency at the given price', () => {
    // 100 XRP at 2.50 = 250 USD.
    expect(convertDropsToCounter(100_000_000n, PRICE_2_50)).toBe(250n * PRICE_SCALE);
  });

  it('lowers the floor when selling and raises the ceiling when buying', () => {
    const midpoint = 250n * PRICE_SCALE;
    expect(applySlippageBound(midpoint, 1, 'sell')).toBe((midpoint * 9_900n) / 10_000n);
    expect(applySlippageBound(midpoint, 1, 'buy')).toBe((midpoint * 10_100n) / 10_000n);
  });

  it('handles a fractional percent without floating point drift', () => {
    const midpoint = 1_000n * PRICE_SCALE;
    expect(applySlippageBound(midpoint, 0.01, 'sell')).toBe((midpoint * 9_999n) / 10_000n);
  });
});

describe('formatIouValue', () => {
  it('trims trailing zeros', () => {
    expect(formatIouValue(250n * PRICE_SCALE)).toBe('250');
    expect(formatIouValue((2505n * PRICE_SCALE) / 1000n)).toBe('2.505');
  });

  it('keeps issued values within 15 significant digits', () => {
    const value = formatIouValue(1_234_567_890_123_456_789n);
    const significantDigits = value.replace('.', '').replace(/^0+/, '').length;
    expect(significantDigits).toBeLessThanOrEqual(15);
  });

  it('rounds a floor down and a ceiling up when precision is lost', () => {
    expect(formatIouValue(1_234_567_890_123_456_789n)).toBe('1234567.89012345');
    expect(formatIouValue(1_234_567_890_123_456_789n, 'ceil')).toBe('1234567.89012346');
  });

  it('terminates when the excess digits are trailing zeros', () => {
    expect(formatIouValue(1_234_567_890_123_456_000n)).toBe('1234567.89012345');
    expect(formatIouValue(1_234_567_890_123_456_000n, 'ceil')).toBe('1234567.89012346');
  });

  it('refuses a negative amount', () => {
    expect(() => formatIouValue(-1n)).toThrow();
  });
});

describe('computeSliceDrops', () => {
  it('returns the nominal slice when jitter is off', () => {
    expect(computeSliceDrops(250_000_000n, 50_000_000n, 0, 0.5)).toBe(50_000_000n);
  });

  it('never exceeds what remains', () => {
    expect(computeSliceDrops(10_000_000n, 50_000_000n, 0, 0.5)).toBe(10_000_000n);
    expect(computeSliceDrops(10_000_000n, 50_000_000n, 50, 0.99)).toBeLessThanOrEqual(10_000_000n);
  });

  it('stays inside the jitter band', () => {
    const nominal = 50_000_000n;
    for (const fraction of [0, 0.25, 0.5, 0.75, 0.999]) {
      const slice = computeSliceDrops(250_000_000n, nominal, 20, fraction);
      expect(slice).toBeGreaterThanOrEqual((nominal * 8_000n) / 10_000n);
      expect(slice).toBeLessThanOrEqual((nominal * 12_000n) / 10_000n);
    }
  });

  it('returns zero only when nothing remains', () => {
    expect(computeSliceDrops(0n, 50_000_000n, 20, 0.5)).toBe(0n);
  });
});

describe('buildOfferCreate', () => {
  it('sells XRP for at least the slippage-bounded counter amount', () => {
    const offer = buildOfferCreate({
      account: DEMO_ACCOUNT,
      side: 'sell',
      sliceDrops: 100_000_000n,
      priceScaled: PRICE_2_50,
      maxSlippagePercent: 1,
      counterCurrency: COUNTER,
    });

    expect(offer.TakerGets).toBe('100000000');
    expect(offer.TakerPays).toEqual({ currency: 'USD', issuer: DEMO_ISSUER, value: '247.5' });
    expect(offer.Flags).toBe(TF_IMMEDIATE_OR_CANCEL | TF_SELL);
  });

  it('buys XRP for at most the slippage-bounded counter amount', () => {
    const offer = buildOfferCreate({
      account: DEMO_ACCOUNT,
      side: 'buy',
      sliceDrops: 100_000_000n,
      priceScaled: PRICE_2_50,
      maxSlippagePercent: 1,
      counterCurrency: COUNTER,
    });

    expect(offer.TakerPays).toBe('100000000');
    expect(offer.TakerGets).toEqual({ currency: 'USD', issuer: DEMO_ISSUER, value: '252.5' });
    // A buy must not carry tfSell.
    expect(offer.Flags).toBe(TF_IMMEDIATE_OR_CANCEL);
  });

  it('refuses a zero slice', () => {
    expect(() =>
      buildOfferCreate({
        account: DEMO_ACCOUNT,
        side: 'sell',
        sliceDrops: 0n,
        priceScaled: PRICE_2_50,
        maxSlippagePercent: 1,
        counterCurrency: COUNTER,
      }),
    ).toThrow('slice size must be positive');
  });

  it('keeps the sell floor and the buy ceiling intact through 15-digit truncation', () => {
    const parseValueToScaled = (valueText: string): bigint => {
      const [wholeText, fractionText = ''] = valueText.split('.');
      return BigInt(wholeText) * PRICE_SCALE + BigInt(fractionText.padEnd(12, '0'));
    };
    // Chosen so the bounded counter amount exceeds 15 significant digits.
    const priceScaled = 3_333_333_333_337n;
    const sliceDrops = 999_999_937n;
    const boundedFor = (side: 'buy' | 'sell'): bigint =>
      applySlippageBound(convertDropsToCounter(sliceDrops, priceScaled), 1, side);

    const sellOffer = buildOfferCreate({
      account: DEMO_ACCOUNT,
      side: 'sell',
      sliceDrops,
      priceScaled,
      maxSlippagePercent: 1,
      counterCurrency: COUNTER,
    });
    const sellValue = parseValueToScaled((sellOffer.TakerPays as { value: string }).value);
    expect(sellValue).toBeGreaterThanOrEqual(boundedFor('sell'));

    const buyOffer = buildOfferCreate({
      account: DEMO_ACCOUNT,
      side: 'buy',
      sliceDrops,
      priceScaled,
      maxSlippagePercent: 1,
      counterCurrency: COUNTER,
    });
    const buyValue = parseValueToScaled((buyOffer.TakerGets as { value: string }).value);
    expect(buyValue).toBeLessThanOrEqual(boundedFor('buy'));
  });
});

describe('buildSettlementPayment', () => {
  it('pays the full balance to the payout address', () => {
    const payment = buildSettlementPayment(DEMO_ACCOUNT, DEMO_ISSUER, 12_345n);
    expect(payment.Destination).toBe(DEMO_ISSUER);
    expect(payment.Amount).toBe('12345');
  });

  it('refuses a non-positive amount', () => {
    expect(() => buildSettlementPayment(DEMO_ACCOUNT, DEMO_ISSUER, 0n)).toThrow();
  });
});

describe('buildIouSettlementPayment', () => {
  it('pays the issued balance to the payout address', () => {
    const payment = buildIouSettlementPayment(DEMO_ACCOUNT, DEMO_ISSUER, COUNTER, '247.5');
    expect(payment.Destination).toBe(DEMO_ISSUER);
    expect(payment.Amount).toEqual({ currency: 'USD', issuer: DEMO_ISSUER, value: '247.5' });
  });

  it('refuses a non-positive issued value', () => {
    expect(() => buildIouSettlementPayment(DEMO_ACCOUNT, DEMO_ISSUER, COUNTER, '0')).toThrow();
    expect(() => buildIouSettlementPayment(DEMO_ACCOUNT, DEMO_ISSUER, COUNTER, '-1.5')).toThrow();
  });
});

describe('execution guards', () => {
  it('only allows signing from funded or executing', () => {
    expect(isExecutable(MandateStatus.Funded)).toBe(true);
    expect(isExecutable(MandateStatus.Executing)).toBe(true);
    for (const status of [
      MandateStatus.None,
      MandateStatus.Created,
      MandateStatus.Provisioned,
      MandateStatus.Filled,
      MandateStatus.Expired,
      MandateStatus.Cancelled,
      MandateStatus.Settled,
    ]) {
      expect(isExecutable(status)).toBe(false);
    }
  });

  it('treats the expiry second itself as expired', () => {
    const mandate = { expiryUnixSeconds: 1_000 };
    expect(hasExpired(mandate, 999)).toBe(false);
    expect(hasExpired(mandate, 1_000)).toBe(true);
  });
});

/** 21 byte feed id in the shape mandate validation accepts. */
const DEMO_FEED_ID = `0x01${'0'.repeat(40)}`;

function makeMandate(overrides: Partial<ValidatedMandate>): ValidatedMandate {
  return {
    version: 1,
    pair: 'XRP/USD',
    side: 'sell',
    kind: 'stop',
    feedId: DEMO_FEED_ID,
    triggerOperator: 'lte',
    triggerPriceScaled: PRICE_2_50,
    totalDrops: 100_000_000n,
    sliceDrops: 10_000_000n,
    jitterPercent: 0,
    maxSlippagePercent: 1,
    dcaIntervalSeconds: null,
    dcaExecutions: null,
    expiryUnixSeconds: 1_000_000,
    payoutAddress: DEMO_ACCOUNT,
    ...overrides,
  };
}

interface EngineHarness {
  readonly engine: MandateEngine;
  readonly submitted: Array<OfferCreate | Payment>;
  readonly submissionTimes: number[];
}

/** Fee the fake ledger charges per transaction, in drops. */
const FAKE_FEE_DROPS = 12n;

interface HarnessOptions {
  readonly iouBalance?: string;
  readonly spendableDrops?: bigint;
  readonly engineResult?: string;
  readonly payoutHasTrustline?: boolean;
  /** Explicit accountXrpDeltaDrops per submission; falls back to a full fill. */
  readonly xrpDeltaQueue?: bigint[];
  readonly locallyCancelled?: boolean;
}

/** Balance change of a fully filled fake transaction, as the ledger reports it. */
function computeFullFillXrpDelta(transaction: OfferCreate | Payment): bigint {
  if (transaction.TransactionType === 'OfferCreate') {
    if (typeof transaction.TakerGets === 'string') {
      // Selling XRP: the account pays the slice plus the fee.
      return -BigInt(transaction.TakerGets) - FAKE_FEE_DROPS;
    }
    if (typeof transaction.TakerPays === 'string') {
      // Buying XRP: the account receives the slice minus the fee.
      return BigInt(transaction.TakerPays) - FAKE_FEE_DROPS;
    }
  }
  return -FAKE_FEE_DROPS;
}

/** Drive the engine with a fake clock that advances on every poll sleep. */
function makeEngineHarness(mandate: ValidatedMandate, options: HarnessOptions = {}): EngineHarness {
  let nowSeconds = 0;
  const submitted: Array<OfferCreate | Payment> = [];
  const submissionTimes: number[] = [];

  const dependencies: EngineDependencies = {
    ftsoReader: {
      readFeed: async () => ({
        priceScaled: PRICE_2_50 - 1n,
        decimals: 12,
        timestampUnixSeconds: nowSeconds,
      }),
    },
    mandateReader: {
      readMandate: async () => ({
        owner: `0x${'0'.repeat(40)}`,
        blobHash: `0x${'0'.repeat(64)}`,
        depositAddress: DEMO_ACCOUNT,
        status: MandateStatus.Funded,
        filledDrops: 0n,
      }),
    },
    xrplExecutor: {
      submit: async (transaction) => {
        submitted.push(transaction);
        submissionTimes.push(nowSeconds);
        return {
          transactionHash: `HASH${submitted.length}`,
          engineResult: options.engineResult ?? 'tesSUCCESS',
          validated: true,
          feeDrops: FAKE_FEE_DROPS,
          accountXrpDeltaDrops:
            options.xrpDeltaQueue?.shift() ?? computeFullFillXrpDelta(transaction),
        };
      },
      readSpendableDrops: async () => options.spendableDrops ?? 0n,
      readIouBalanceValue: async () => options.iouBalance ?? '0',
      hasTrustline: async () => options.payoutHasTrustline ?? true,
    },
    randomFraction: () => 0.5,
    nowUnixSeconds: () => nowSeconds,
    sleep: async () => {
      nowSeconds += FEED_POLL_INTERVAL_MS / 1_000;
    },
    isLocallyCancelled: () => options.locallyCancelled ?? false,
  };

  const wallet = Wallet.fromEntropy(new Uint8Array(16).fill(7));
  const engine = new MandateEngine(
    { mandateId: 1n, mandate, wallet, counterCurrency: COUNTER },
    dependencies,
  );
  return { engine, submitted, submissionTimes };
}

describe('measureFilledDrops', () => {
  it('reads a full sell fill from the balance change', () => {
    expect(measureFilledDrops('sell', 10_000_000n, 12n, -10_000_012n)).toBe(10_000_000n);
  });

  it('reads a partial fill instead of assuming the whole slice', () => {
    expect(measureFilledDrops('sell', 10_000_000n, 12n, -5_000_012n)).toBe(5_000_000n);
    expect(measureFilledDrops('buy', 10_000_000n, 12n, 4_999_988n)).toBe(5_000_000n);
  });

  it('reports zero when tesSUCCESS moved nothing but the fee', () => {
    expect(measureFilledDrops('sell', 10_000_000n, 12n, -12n)).toBe(0n);
    expect(measureFilledDrops('buy', 10_000_000n, 12n, -12n)).toBe(0n);
  });

  it('caps the measurement at the requested slice', () => {
    expect(measureFilledDrops('sell', 10_000_000n, 12n, -99_000_012n)).toBe(10_000_000n);
  });

  it('assumes a full fill when the metadata is unavailable', () => {
    // Over-counting stops early and refunds; under-counting would re-trade.
    expect(measureFilledDrops('sell', 10_000_000n, 12n, null)).toBe(10_000_000n);
  });
});

describe('parseSignedXrpToDrops', () => {
  it('parses signed decimal XRP values exactly', () => {
    expect(parseSignedXrpToDrops('-10.000012')).toBe(-10_000_012n);
    expect(parseSignedXrpToDrops('0.5')).toBe(500_000n);
    expect(parseSignedXrpToDrops('3')).toBe(3_000_000n);
  });

  it('rejects text that is not an XRP amount', () => {
    expect(() => parseSignedXrpToDrops('1.0000001')).toThrow();
    expect(() => parseSignedXrpToDrops('abc')).toThrow();
  });
});

describe('MandateEngine', () => {
  it('works a stop mandate in slices until the total is filled', async () => {
    const harness = makeEngineHarness(makeMandate({ totalDrops: 30_000_000n }));
    const outcome = await harness.engine.run();
    expect(outcome).toBe('filled');
    expect(harness.submitted).toHaveLength(3);
  });

  it('counts only the measured fill, so a partial fill is retried', async () => {
    const harness = makeEngineHarness(makeMandate({ totalDrops: 20_000_000n }), {
      // First slice fills half; later slices fill fully.
      xrpDeltaQueue: [-5_000_000n - FAKE_FEE_DROPS],
    });
    const outcome = await harness.engine.run();
    expect(outcome).toBe('filled');
    // 5 + 10 + remaining 5: three submissions to cover 20.
    expect(harness.submitted).toHaveLength(3);
    expect(harness.engine.buildReport(MandateStatus.Filled).filledDrops).toBe(20_000_000n);
  });

  it('does not count a tesSUCCESS order that crossed nothing', async () => {
    const harness = makeEngineHarness(makeMandate({ totalDrops: 10_000_000n }), {
      // First order finds no liquidity: only the fee moves.
      xrpDeltaQueue: [-FAKE_FEE_DROPS],
    });
    const outcome = await harness.engine.run();
    expect(outcome).toBe('filled');
    expect(harness.submitted).toHaveLength(2);
    expect(harness.engine.buildReport(MandateStatus.Filled).filledDrops).toBe(10_000_000n);
  });

  it('stops without trading once the cancel instruction arrived', async () => {
    const harness = makeEngineHarness(makeMandate({}), { locallyCancelled: true });
    const outcome = await harness.engine.run();
    expect(outcome).toBe('cancelled');
    expect(harness.submitted).toHaveLength(0);
  });

  it('paces DCA slices by the interval and stops at the execution count', async () => {
    const harness = makeEngineHarness(
      makeMandate({ kind: 'dca', dcaIntervalSeconds: 60, dcaExecutions: 2 }),
    );
    const outcome = await harness.engine.run();
    expect(outcome).toBe('filled');
    expect(harness.submitted).toHaveLength(2);
    const firstTime = harness.submissionTimes[0] ?? 0;
    const secondTime = harness.submissionTimes[1] ?? 0;
    expect(secondTime - firstTime).toBeGreaterThanOrEqual(60);
  });

  it('settles both the counter currency and the spendable XRP', async () => {
    const harness = makeEngineHarness(makeMandate({}), {
      iouBalance: '247.5',
      spendableDrops: 5_000_000n,
    });
    const report = await harness.engine.settle();
    expect(report.failures).toEqual([]);
    expect(report.transactionHashes).toHaveLength(2);
    const issuedPayment = harness.submitted[0] as Payment;
    expect(issuedPayment.Amount).toEqual({ currency: 'USD', issuer: DEMO_ISSUER, value: '247.5' });
    const xrpPayment = harness.submitted[1] as Payment;
    expect(xrpPayment.Amount).toBe('5000000');
  });

  it('reports a rejected payout instead of pretending it settled', async () => {
    const harness = makeEngineHarness(makeMandate({}), {
      iouBalance: '247.5',
      engineResult: 'tecPATH_DRY',
    });
    const report = await harness.engine.settle();
    expect(report.transactionHashes).toEqual([]);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain('tecPATH_DRY');
  });

  it('names the missing payout trustline instead of burning a doomed payment', async () => {
    const harness = makeEngineHarness(makeMandate({}), {
      iouBalance: '247.5',
      payoutHasTrustline: false,
    });
    const report = await harness.engine.settle();
    expect(harness.submitted).toHaveLength(0);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain('trustline');
    expect(report.failures[0]).toContain(DEMO_ACCOUNT);
  });
});
