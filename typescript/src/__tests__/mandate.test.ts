import { describe, expect, it } from 'vitest';
import { Wallet } from 'xrpl';
import {
  decodeMandate,
  PRICE_SCALE,
  parseXrpAmountToDrops,
  validateMandate,
} from '../app/mandate.js';

const NOW_UNIX_SECONDS = 1_800_000_000;
const XRP_USD_FEED_ID = '0x015852502f55534400000000000000000000000000';
const PAYOUT_ADDRESS = Wallet.fromEntropy(new Uint8Array(16).fill(3)).classicAddress;

function buildValidMandate(): Record<string, unknown> {
  return {
    v: 1,
    pair: 'XRP/USD',
    side: 'sell',
    kind: 'stop',
    trigger: { feedId: XRP_USD_FEED_ID, op: 'lte', price: '2.85' },
    size: { total: '250', slice: '50', jitterPct: 20 },
    bound: { maxSlippagePct: 1 },
    expiry: NOW_UNIX_SECONDS + 3600,
    payout: { xrplAddress: PAYOUT_ADDRESS },
  };
}

describe('validateMandate', () => {
  it('accepts a well formed stop mandate and converts amounts to drops', () => {
    const result = validateMandate(buildValidMandate(), NOW_UNIX_SECONDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.totalDrops).toBe(250_000_000n);
    expect(result.value.sliceDrops).toBe(50_000_000n);
    expect(result.value.triggerPriceScaled).toBe((285n * PRICE_SCALE) / 100n);
    expect(result.value.payoutAddress).toBe(PAYOUT_ADDRESS);
    expect(result.value.dcaIntervalSeconds).toBeNull();
  });

  it('rejects an unknown top level field instead of ignoring it', () => {
    const document = { ...buildValidMandate(), sneak: 'value' };
    const result = validateMandate(document, NOW_UNIX_SECONDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('unknown field "sneak"');
  });

  it('rejects an unknown nested field', () => {
    const document = buildValidMandate();
    document.trigger = { feedId: XRP_USD_FEED_ID, op: 'lte', price: '2.85', extra: 1 };
    const result = validateMandate(document, NOW_UNIX_SECONDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('mandate.trigger');
  });

  it('rejects an expiry in the past and one beyond the lifetime cap', () => {
    const past = buildValidMandate();
    past.expiry = NOW_UNIX_SECONDS - 1;
    const pastResult = validateMandate(past, NOW_UNIX_SECONDS);
    expect(pastResult.ok).toBe(false);

    const far = buildValidMandate();
    far.expiry = NOW_UNIX_SECONDS + 31 * 24 * 60 * 60;
    const farResult = validateMandate(far, NOW_UNIX_SECONDS);
    expect(farResult.ok).toBe(false);
    if (farResult.ok) return;
    expect(farResult.reason).toContain('mandate.expiry');
  });

  it('rejects a slice larger than the total', () => {
    const document = buildValidMandate();
    document.size = { total: '10', slice: '20', jitterPct: 0 };
    const result = validateMandate(document, NOW_UNIX_SECONDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('must not exceed');
  });

  it('rejects an invalid payout address', () => {
    const document = buildValidMandate();
    document.payout = { xrplAddress: 'rNotARealAddress' };
    const result = validateMandate(document, NOW_UNIX_SECONDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('xrplAddress');
  });

  it('requires a dca block for kind dca and forbids it otherwise', () => {
    const missing = buildValidMandate();
    missing.kind = 'dca';
    expect(validateMandate(missing, NOW_UNIX_SECONDS).ok).toBe(false);

    const stray = buildValidMandate();
    stray.dca = { everySec: 3600, times: 4 };
    const strayResult = validateMandate(stray, NOW_UNIX_SECONDS);
    expect(strayResult.ok).toBe(false);
    if (strayResult.ok) return;
    expect(strayResult.reason).toContain('only allowed when kind is "dca"');
  });

  it('rejects a dca schedule that would spend more than the total', () => {
    const document = buildValidMandate();
    document.kind = 'dca';
    document.size = { total: '100', slice: '50', jitterPct: 0 };
    document.dca = { everySec: 3600, times: 3 };
    const result = validateMandate(document, NOW_UNIX_SECONDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('exceeds mandate.size.total');
  });

  it('rejects a feed id that is not 21 bytes of lowercase hex', () => {
    const document = buildValidMandate();
    document.trigger = { feedId: '0x0158', op: 'lte', price: '2.85' };
    expect(validateMandate(document, NOW_UNIX_SECONDS).ok).toBe(false);
  });

  it('reports distinct reasons for malformed JSON and a schema failure', () => {
    const notJson = decodeMandate(new TextEncoder().encode('{oops'), NOW_UNIX_SECONDS);
    expect(notJson.ok).toBe(false);
    if (notJson.ok) return;
    expect(notJson.reason).toContain('not valid JSON');

    const badSchema = decodeMandate(
      new TextEncoder().encode(JSON.stringify({ v: 2 })),
      NOW_UNIX_SECONDS,
    );
    expect(badSchema.ok).toBe(false);
    if (badSchema.ok) return;
    expect(badSchema.reason).toContain('schema version 1');
  });
});

describe('parseXrpAmountToDrops', () => {
  it('converts decimals exactly without floating point', () => {
    const result = parseXrpAmountToDrops('0.000001', 'amount');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(1n);
  });

  it('rejects more precision than XRP carries', () => {
    expect(parseXrpAmountToDrops('1.0000001', 'amount').ok).toBe(false);
  });

  it('rejects zero, negatives and non-numeric text', () => {
    expect(parseXrpAmountToDrops('0', 'amount').ok).toBe(false);
    expect(parseXrpAmountToDrops('-1', 'amount').ok).toBe(false);
    expect(parseXrpAmountToDrops('abc', 'amount').ok).toBe(false);
    expect(parseXrpAmountToDrops(5, 'amount').ok).toBe(false);
  });
});
