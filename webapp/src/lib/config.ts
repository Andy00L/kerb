/** Runtime configuration for the Kerb webapp. */

export interface AppConfig {
  readonly chainUrl: string;
  /** Kerb InstructionSender on Coston2, null until deployed. */
  readonly contractAddress: `0x${string}` | null;
  /** Public URL of the ext-proxy, null until the tunnel exists. */
  readonly proxyUrl: string | null;
  /** True when the app can talk to a deployed contract. */
  readonly isLive: boolean;
  /**
   * True when the demo key is set at build time: the demo identity and every
   * sample-data surface show. Without the key the site is production only.
   */
  readonly isDemoEnabled: boolean;
}

/** Coston2 chain id (sourceRef: dev.flare.network network reference). */
export const COSTON2_CHAIN_ID = 114;

/**
 * Read the public configuration.
 *
 * Without a deployed contract the app runs in demo mode: every screen works
 * on sample data, and the live FTSOv2 price still comes from the real chain
 * when the RPC answers.
 */
export function readAppConfig(): AppConfig {
  const chainUrl =
    process.env.NEXT_PUBLIC_CHAIN_URL ??
    "https://coston2-api.flare.network/ext/C/rpc";
  const contractAddress =
    (process.env.NEXT_PUBLIC_INSTRUCTION_SENDER as `0x${string}` | undefined) ??
    null;
  const proxyUrl = process.env.NEXT_PUBLIC_EXT_PROXY_URL ?? null;
  return {
    chainUrl,
    contractAddress,
    proxyUrl,
    isLive: contractAddress !== null,
    isDemoEnabled: (process.env.NEXT_PUBLIC_KERB_DEMO_KEY ?? "") !== "",
  };
}
