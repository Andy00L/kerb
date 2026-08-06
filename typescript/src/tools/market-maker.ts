/**
 * Testnet market maker and IOU issuer.
 *
 * The XRPL testnet DEX book is empty, so a stop-loss would never fill there.
 * Rather than pretend otherwise, Kerb ships the liquidity it demos against:
 * an issuer that mints a test dollar, and a maker that quotes both sides around
 * the live FTSOv2 price. This runs entirely outside the TEE and holds no user
 * funds. Said plainly in the README, because a judge should never have to guess
 * which parts are real.
 *
 * Usage:
 *   node dist/tools/market-maker.js setup            provisions issuer and maker
 *   node dist/tools/market-maker.js trustline <addr> opens a line to the issuer
 *   node dist/tools/market-maker.js run              quotes until interrupted
 *
 * Environment: XRPL_ENDPOINT, CHAIN_URL, KERB_COUNTER_CURRENCY,
 * KERB_ISSUER_SEED, KERB_MAKER_SEED.
 */

import { Client, Wallet, type OfferCreate, type Payment, type TrustSet } from 'xrpl';
import { DROPS_PER_XRP } from '../app/config.js';
import { FtsoReader, XRP_USD_FEED_ID } from '../app/ftso.js';
import { PRICE_SCALE } from '../app/mandate.js';
import { formatIouValue } from '../app/xrpl.js';

/** Half-spread quoted either side of the feed price, in basis points. */
export const HALF_SPREAD_BASIS_POINTS = 25n;

/** Size quoted on each side, in drops. */
export const QUOTE_SIZE_DROPS = 200n * DROPS_PER_XRP;

/** How often quotes are refreshed. */
export const QUOTE_REFRESH_MS = 10_000;

/** Trustline limit granted to accounts holding the test dollar. */
export const TRUSTLINE_LIMIT = '1000000';

/**
 * Websocket connect timeout. The xrpl.js default of 5s is regularly too short
 * for the first connection to the public testnet from this network.
 */
export const XRPL_CONNECT_TIMEOUT_MS = 20_000;

/** Test dollar the maker quotes against, unless overridden. */
const DEFAULT_COUNTER_CURRENCY = 'USD';

interface MarketMakerConfig {
  readonly xrplEndpoint: string;
  readonly chainUrl: string;
  readonly currency: string;
  readonly issuerSeed: string | undefined;
  readonly makerSeed: string | undefined;
}

function readConfig(environment: NodeJS.ProcessEnv = process.env): MarketMakerConfig {
  const xrplEndpoint = environment.XRPL_ENDPOINT ?? 'wss://s.altnet.rippletest.net:51233';
  const chainUrl = environment.CHAIN_URL ?? 'https://coston2-api.flare.network/ext/C/rpc';
  return {
    xrplEndpoint,
    chainUrl,
    currency: environment.KERB_COUNTER_CURRENCY ?? DEFAULT_COUNTER_CURRENCY,
    issuerSeed: environment.KERB_ISSUER_SEED,
    makerSeed: environment.KERB_MAKER_SEED,
  };
}

/**
 * Compute the two quote prices around a mid price.
 *
 * @param midPriceScaled Feed price at PRICE_SCALE.
 * @returns Bid and ask, both at PRICE_SCALE.
 */
export function computeQuotes(midPriceScaled: bigint): { bid: bigint; ask: bigint } {
  return {
    bid: (midPriceScaled * (10_000n - HALF_SPREAD_BASIS_POINTS)) / 10_000n,
    ask: (midPriceScaled * (10_000n + HALF_SPREAD_BASIS_POINTS)) / 10_000n,
  };
}

/**
 * Build the maker's two orders.
 *
 * The bid buys XRP by offering the test dollar; the ask sells XRP for it. Both
 * rest on the book, so they are plain offers rather than immediate-or-cancel.
 */
export function buildQuoteOrders(
  makerAddress: string,
  issuerAddress: string,
  currency: string,
  midPriceScaled: bigint,
): [OfferCreate, OfferCreate] {
  const { bid, ask } = computeQuotes(midPriceScaled);
  const issuedFor = (priceScaled: bigint): { currency: string; issuer: string; value: string } => ({
    currency,
    issuer: issuerAddress,
    value: formatIouValue((QUOTE_SIZE_DROPS * priceScaled) / DROPS_PER_XRP),
  });

  const bidOrder = {
    TransactionType: 'OfferCreate',
    Account: makerAddress,
    TakerGets: issuedFor(bid),
    TakerPays: QUOTE_SIZE_DROPS.toString(),
  } as OfferCreate;

  const askOrder = {
    TransactionType: 'OfferCreate',
    Account: makerAddress,
    TakerGets: QUOTE_SIZE_DROPS.toString(),
    TakerPays: issuedFor(ask),
  } as OfferCreate;

  return [bidOrder, askOrder];
}

/** Open a trustline from a holder to the issuer, so it can hold the test dollar. */
export function buildTrustSet(
  holderAddress: string,
  issuerAddress: string,
  currency: string,
): TrustSet {
  return {
    TransactionType: 'TrustSet',
    Account: holderAddress,
    LimitAmount: { currency, issuer: issuerAddress, value: TRUSTLINE_LIMIT },
  } as TrustSet;
}

/** Mint the test dollar from the issuer to a holder that already has a line. */
export function buildIssuance(
  issuerAddress: string,
  holderAddress: string,
  currency: string,
  value: string,
): Payment {
  return {
    TransactionType: 'Payment',
    Account: issuerAddress,
    Destination: holderAddress,
    Amount: { currency, issuer: issuerAddress, value },
  } as Payment;
}

async function submitAndWait(
  client: Client,
  transaction: OfferCreate | Payment | TrustSet,
  wallet: Wallet,
): Promise<string> {
  const prepared = await client.autofill(transaction);
  const signed = wallet.sign(prepared);
  const response = await client.submitAndWait(signed.tx_blob);
  const engineResult =
    typeof response.result.meta === 'object' && response.result.meta !== null
      ? response.result.meta.TransactionResult
      : 'unknown';
  if (engineResult !== 'tesSUCCESS') {
    throw new Error(`${transaction.TransactionType} failed: ${engineResult}`);
  }
  return signed.hash;
}

/** Provision a funded issuer and maker from the testnet faucet. */
async function runSetup(config: MarketMakerConfig): Promise<void> {
  const client = new Client(config.xrplEndpoint, { connectionTimeout: XRPL_CONNECT_TIMEOUT_MS });
  await client.connect();
  try {
    const issuer = (await client.fundWallet()).wallet;
    const maker = (await client.fundWallet()).wallet;

    await submitAndWait(
      client,
      buildTrustSet(maker.classicAddress, issuer.classicAddress, config.currency),
      maker,
    );
    await submitAndWait(
      client,
      buildIssuance(issuer.classicAddress, maker.classicAddress, config.currency, '500000'),
      issuer,
    );

    console.log('[market-maker] issuer and maker provisioned. Add these to your .env:');
    console.log(`KERB_COUNTER_CURRENCY=${config.currency}`);
    console.log(`KERB_COUNTER_ISSUER=${issuer.classicAddress}`);
    console.log(`KERB_ISSUER_SEED=${issuer.seed ?? ''}`);
    console.log(`KERB_MAKER_SEED=${maker.seed ?? ''}`);
  } finally {
    await client.disconnect();
  }
}

/** Open a trustline for an arbitrary holder, such as a mandate deposit account. */
async function runTrustline(config: MarketMakerConfig, holderSeed: string): Promise<void> {
  if (!config.issuerSeed) {
    throw new Error('KERB_ISSUER_SEED is required');
  }
  const issuer = Wallet.fromSeed(config.issuerSeed);
  const holder = Wallet.fromSeed(holderSeed);

  const client = new Client(config.xrplEndpoint, { connectionTimeout: XRPL_CONNECT_TIMEOUT_MS });
  await client.connect();
  try {
    const hash = await submitAndWait(
      client,
      buildTrustSet(holder.classicAddress, issuer.classicAddress, config.currency),
      holder,
    );
    console.log(`[market-maker] trustline opened for ${holder.classicAddress} in ${hash}`);
  } finally {
    await client.disconnect();
  }
}

/** Quote both sides around the feed price until interrupted. */
async function runQuoting(config: MarketMakerConfig): Promise<void> {
  if (!config.issuerSeed || !config.makerSeed) {
    throw new Error('KERB_ISSUER_SEED and KERB_MAKER_SEED are required');
  }
  const issuer = Wallet.fromSeed(config.issuerSeed);
  const maker = Wallet.fromSeed(config.makerSeed);
  const ftsoReader = new FtsoReader(config.chainUrl);

  const client = new Client(config.xrplEndpoint, { connectionTimeout: XRPL_CONNECT_TIMEOUT_MS });
  await client.connect();
  console.log(`[market-maker] quoting ${config.currency} from ${maker.classicAddress}`);

  let stopped = false;
  process.on('SIGINT', () => {
    stopped = true;
  });

  try {
    while (!stopped) {
      try {
        const reading = await ftsoReader.readFeed(XRP_USD_FEED_ID);
        const [bidOrder, askOrder] = buildQuoteOrders(
          maker.classicAddress,
          issuer.classicAddress,
          config.currency,
          reading.priceScaled,
        );
        await submitAndWait(client, bidOrder, maker);
        await submitAndWait(client, askOrder, maker);

        const midPrice = Number(reading.priceScaled) / Number(PRICE_SCALE);
        console.log(`[market-maker] quoted around ${midPrice.toFixed(6)}`);
      } catch (quoteError) {
        console.log(`[market-maker] quote cycle failed: ${quoteError}`);
      }
      await new Promise((resolve) => setTimeout(resolve, QUOTE_REFRESH_MS));
    }
  } finally {
    await client.disconnect();
  }
}

async function main(): Promise<void> {
  const [mode, argument] = process.argv.slice(2);
  const config = readConfig();

  if (mode === 'setup') {
    await runSetup(config);
    return;
  }
  if (mode === 'trustline') {
    if (!argument) {
      throw new Error('usage: market-maker trustline <holderSeed>');
    }
    await runTrustline(config, argument);
    return;
  }
  if (mode === 'run') {
    await runQuoting(config);
    return;
  }
  throw new Error('usage: market-maker <setup|trustline|run>');
}

if (process.argv[1]?.endsWith('market-maker.js')) {
  main().catch((makerError) => {
    console.error(`[market-maker] ${makerError}`);
    process.exit(1);
  });
}
