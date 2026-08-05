/**
 * FTSOv2 block-latency price feed reader and trigger evaluation.
 *
 * Feeds update roughly every 1.8 seconds and are free to read on Coston2
 * (calculateFeeById returns 0 for XRP/USD, FLR/USD and BTC/USD). The enclave
 * polls the feed over the chain RPC and never trusts a single reading: a
 * trigger has to hold for several consecutive observations before it fires.
 */

import { createPublicClient, http, type PublicClient } from 'viem';
import { PRICE_SCALE_DECIMALS, type TriggerOperator } from './mandate.js';

/**
 * FtsoV2 on Coston2, resolved from FlareContractRegistry rather than the
 * address printed in the older guides, which points at a superseded
 * non-proxy deployment.
 * sourceRef: https://dev.flare.network/ftso/solidity-reference.md
 */
export const FTSO_V2_ADDRESS_COSTON2 = '0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d';

/**
 * XRP/USD block-latency feed id. Feed ids are 21 bytes: one category byte
 * (01 for Crypto) followed by the UTF-8 feed name, right zero padded.
 * sourceRef: https://dev.flare.network/ftso/feeds.md
 */
export const XRP_USD_FEED_ID = '0x015852502f55534400000000000000000000000000';

/**
 * Minimal FtsoV2 ABI.
 *
 * getFeedById is payable on-chain, so an on-chain caller cannot wrap it in a
 * view function. Read off-chain through eth_call, where it costs nothing, which
 * is why the local copy declares it view. The published fee for these feeds on
 * Coston2 is zero either way.
 */
export const FTSO_V2_ABI = [
  {
    type: 'function',
    name: 'getFeedById',
    stateMutability: 'view',
    inputs: [{ name: '_feedId', type: 'bytes21' }],
    outputs: [
      { name: '_value', type: 'uint256' },
      { name: '_decimals', type: 'int8' },
      { name: '_timestamp', type: 'uint64' },
    ],
  },
] as const;

/** One feed observation, normalised to the enclave's fixed-point price scale. */
export interface FeedReading {
  readonly priceScaled: bigint;
  readonly decimals: number;
  readonly timestampUnixSeconds: number;
}

/**
 * Normalise a raw feed value to PRICE_SCALE.
 *
 * The docs are explicit that decimals can change, so they are always read from
 * the feed rather than assumed. Scaling up is exact; scaling down (a feed with
 * more precision than the enclave scale) truncates, which is the conservative
 * direction for a trigger comparison.
 */
export function scaleFeedValue(value: bigint, decimals: number): bigint {
  const shift = PRICE_SCALE_DECIMALS - decimals;
  if (shift >= 0) {
    return value * 10n ** BigInt(shift);
  }
  return value / 10n ** BigInt(-shift);
}

/** The feed read the engine depends on, an interface so tests can fake it. */
export interface PriceFeedSource {
  readFeed(feedId: string): Promise<FeedReading>;
}

/** Reads block-latency feeds over an RPC endpoint. */
export class FtsoReader implements PriceFeedSource {
  private readonly client: PublicClient;
  private readonly ftsoAddress: `0x${string}`;

  constructor(chainUrl: string, ftsoAddress: string = FTSO_V2_ADDRESS_COSTON2) {
    this.client = createPublicClient({ transport: http(chainUrl) });
    this.ftsoAddress = ftsoAddress as `0x${string}`;
  }

  /**
   * Read one feed.
   *
   * @param feedId 21 byte feed id.
   * @returns The reading, normalised to PRICE_SCALE.
   * @throws When the RPC call fails or the feed returns a non-positive value.
   */
  async readFeed(feedId: string): Promise<FeedReading> {
    const [value, decimals, timestamp] = await this.client.readContract({
      address: this.ftsoAddress,
      abi: FTSO_V2_ABI,
      functionName: 'getFeedById',
      args: [feedId as `0x${string}`],
    });

    if (value <= 0n) {
      throw new Error(`feed ${feedId} returned a non-positive value`);
    }

    return {
      priceScaled: scaleFeedValue(value, decimals),
      decimals,
      timestampUnixSeconds: Number(timestamp),
    };
  }
}

/**
 * Confirms a trigger across consecutive readings.
 *
 * A single feed update is not enough to move funds: one noisy block would fire
 * every stop in the book. The condition has to hold for a run of consecutive
 * observations, and any reading that breaks the condition resets the run.
 */
export class TriggerMonitor {
  private consecutiveMatches = 0;

  constructor(
    private readonly operator: TriggerOperator,
    private readonly thresholdScaled: bigint,
    private readonly confirmationsRequired: number,
  ) {
    if (confirmationsRequired < 1) {
      throw new Error('confirmationsRequired must be at least 1');
    }
  }

  /** Consecutive readings that currently satisfy the condition. */
  get streak(): number {
    return this.consecutiveMatches;
  }

  /**
   * Record one reading.
   *
   * @param priceScaled Observed price at PRICE_SCALE.
   * @returns True from the reading that completes the confirmation run until
   *          the run is broken or reset. Staying true matters for paced (DCA)
   *          mandates, which may hold a confirmed trigger for a while before
   *          the next slice is due.
   */
  observe(priceScaled: bigint): boolean {
    const matches =
      this.operator === 'lte'
        ? priceScaled <= this.thresholdScaled
        : priceScaled >= this.thresholdScaled;

    if (!matches) {
      this.consecutiveMatches = 0;
      return false;
    }

    this.consecutiveMatches += 1;
    return this.consecutiveMatches >= this.confirmationsRequired;
  }

  /** Forget the current run, for example after a mandate is paused. */
  reset(): void {
    this.consecutiveMatches = 0;
  }
}
