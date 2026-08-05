import { describe, expect, it } from 'vitest';
import { PRICE_SCALE } from '../app/mandate.js';
import { toBytes32Hash } from '../app/supervisor.js';
import {
  ATTESTATION_TYPE_XRP_PAYMENT,
  SOURCE_ID_TEST_XRP,
  timestampToVotingRound,
  FIRST_VOTING_ROUND_START_TIMESTAMP,
  VOTING_EPOCH_DURATION_SECONDS,
} from '../tools/fdc.js';
import {
  buildIssuance,
  buildQuoteOrders,
  buildTrustSet,
  computeQuotes,
  HALF_SPREAD_BASIS_POINTS,
  QUOTE_SIZE_DROPS,
} from '../tools/market-maker.js';

const MAKER = 'rNMovRR3WPbFLVaSbETCCR71XsqyxhJ9P6';
const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const PRICE_2_50 = (250n * PRICE_SCALE) / 100n;

describe('FDC request constants', () => {
  it('encodes the attestation type and source id right zero padded to 32 bytes', () => {
    // "XRPPayment" and "testXRP" as UTF-8 hex, right padded.
    expect(ATTESTATION_TYPE_XRP_PAYMENT).toBe(
      '0x5852505061796d656e740000000000000000000000000000000000000000000000'.slice(0, 66),
    );
    expect(SOURCE_ID_TEST_XRP).toBe(
      `0x${Buffer.from('testXRP', 'utf8').toString('hex').padEnd(64, '0')}`,
    );
  });
});

describe('timestampToVotingRound', () => {
  it('maps the first round start to round zero', () => {
    expect(timestampToVotingRound(FIRST_VOTING_ROUND_START_TIMESTAMP)).toBe(0);
  });

  it('advances one round per voting epoch', () => {
    expect(
      timestampToVotingRound(FIRST_VOTING_ROUND_START_TIMESTAMP + VOTING_EPOCH_DURATION_SECONDS),
    ).toBe(1);
    expect(
      timestampToVotingRound(
        FIRST_VOTING_ROUND_START_TIMESTAMP + VOTING_EPOCH_DURATION_SECONDS * 3 + 89,
      ),
    ).toBe(3);
  });
});

describe('toBytes32Hash', () => {
  it('prefixes and lowercases an XRPL hash', () => {
    const xrplHash = 'A'.repeat(64);
    expect(toBytes32Hash(xrplHash)).toBe(`0x${'a'.repeat(64)}`);
  });

  it('returns the zero hash when nothing executed yet', () => {
    expect(toBytes32Hash('')).toBe(`0x${'0'.repeat(64)}`);
  });

  it('leaves an already prefixed hash well formed', () => {
    const prefixed = `0x${'b'.repeat(64)}`;
    expect(toBytes32Hash(prefixed)).toBe(prefixed);
  });
});

describe('computeQuotes', () => {
  it('places the bid below and the ask above the mid price', () => {
    const { bid, ask } = computeQuotes(PRICE_2_50);
    expect(bid).toBe((PRICE_2_50 * (10_000n - HALF_SPREAD_BASIS_POINTS)) / 10_000n);
    expect(ask).toBe((PRICE_2_50 * (10_000n + HALF_SPREAD_BASIS_POINTS)) / 10_000n);
    expect(bid).toBeLessThan(PRICE_2_50);
    expect(ask).toBeGreaterThan(PRICE_2_50);
  });
});

describe('buildQuoteOrders', () => {
  it('quotes both sides for the configured size', () => {
    const [bidOrder, askOrder] = buildQuoteOrders(MAKER, ISSUER, 'USD', PRICE_2_50);

    // The bid buys XRP: it pays XRP out of the book and gives the test dollar.
    expect(bidOrder.TakerPays).toBe(QUOTE_SIZE_DROPS.toString());
    expect(bidOrder.TakerGets).toMatchObject({ currency: 'USD', issuer: ISSUER });

    // The ask sells XRP for the test dollar.
    expect(askOrder.TakerGets).toBe(QUOTE_SIZE_DROPS.toString());
    expect(askOrder.TakerPays).toMatchObject({ currency: 'USD', issuer: ISSUER });

    // Resting orders, so neither carries immediate-or-cancel.
    expect(bidOrder.Flags).toBeUndefined();
    expect(askOrder.Flags).toBeUndefined();
  });

  it('prices the ask above the bid', () => {
    const [bidOrder, askOrder] = buildQuoteOrders(MAKER, ISSUER, 'USD', PRICE_2_50);
    const bidValue = Number((bidOrder.TakerGets as { value: string }).value);
    const askValue = Number((askOrder.TakerPays as { value: string }).value);
    expect(askValue).toBeGreaterThan(bidValue);
  });
});

describe('trustline and issuance', () => {
  it('opens a line from the holder to the issuer', () => {
    const trustSet = buildTrustSet(MAKER, ISSUER, 'USD');
    expect(trustSet.Account).toBe(MAKER);
    expect(trustSet.LimitAmount).toMatchObject({ currency: 'USD', issuer: ISSUER });
  });

  it('mints from the issuer to the holder', () => {
    const payment = buildIssuance(ISSUER, MAKER, 'USD', '100');
    expect(payment.Account).toBe(ISSUER);
    expect(payment.Destination).toBe(MAKER);
    expect(payment.Amount).toMatchObject({ currency: 'USD', issuer: ISSUER, value: '100' });
  });
});
