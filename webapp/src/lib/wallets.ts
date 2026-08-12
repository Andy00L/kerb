/**
 * Injected wallet discovery.
 *
 * Uses EIP-6963 (multi injected provider discovery): the page dispatches
 * eip6963:requestProvider and every installed wallet answers synchronously
 * with an announceProvider event carrying its name, icon and provider.
 * sourceRef: https://eips.ethereum.org/EIPS/eip-6963. Wallets predating the
 * standard only set window.ethereum, kept as the fallback.
 */

/** Minimal EIP-1193 provider surface Kerb uses. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** EIP-6963 provider info record. The icon is a data URI. */
interface Eip6963ProviderInfo {
  readonly uuid: string;
  readonly name: string;
  readonly icon: string;
  readonly rdns: string;
}

/** One installed wallet the user can pick. */
export interface DetectedWallet {
  readonly rdns: string;
  readonly name: string;
  /**
   * Data-URI icon from the wallet itself, a bundled /wallets/ path for
   * wallets recognized by namespace, null for the legacy fallback.
   */
  readonly icon: string | null;
  readonly provider: Eip1193Provider;
}

interface Eip6963AnnounceEvent extends Event {
  readonly detail?: {
    readonly info?: Eip6963ProviderInfo;
    readonly provider?: Eip1193Provider;
  };
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/** Only same-page data URIs are trusted as icons; anything else is dropped. */
function isSafeIcon(candidate: unknown): candidate is string {
  return typeof candidate === "string" && candidate.startsWith("data:image/");
}

/**
 * Wallets that cannot operate on Coston2 and are hidden from the picker:
 * Phantom's EVM mode cannot add custom chains, so a connection through it
 * can never sign a Kerb transaction.
 */
const EXCLUDED_RDNS: ReadonlySet<string> = new Set(["app.phantom"]);

/**
 * Enumerate the wallets installed in this browser.
 *
 * EIP-6963 wallets announce synchronously during the request dispatch, so
 * this is a plain function, re-run every time the picker opens (a wallet
 * enabled mid-session shows up on the next open).
 */
export function discoverWallets(): DetectedWallet[] {
  if (typeof window === "undefined") {
    return [];
  }

  const found: DetectedWallet[] = [];
  const seenRdns = new Set<string>();

  const recordAnnouncement = (event: Event): void => {
    const { info, provider } = (event as Eip6963AnnounceEvent).detail ?? {};
    if (
      info === undefined ||
      provider === undefined ||
      typeof info.rdns !== "string" ||
      typeof info.name !== "string" ||
      EXCLUDED_RDNS.has(info.rdns) ||
      seenRdns.has(info.rdns)
    ) {
      return;
    }
    seenRdns.add(info.rdns);
    found.push({
      rdns: info.rdns,
      name: info.name,
      icon: isSafeIcon(info.icon) ? info.icon : null,
      provider,
    });
  };

  window.addEventListener("eip6963:announceProvider", recordAnnouncement);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  window.removeEventListener("eip6963:announceProvider", recordAnnouncement);

  if (found.length === 0 && window.ethereum !== undefined) {
    // Pre-6963 wallet: present, but it does not identify itself.
    found.push({
      rdns: "injected",
      name: "Browser wallet",
      icon: null,
      provider: window.ethereum,
    });
  }

  return found.sort((firstWallet, secondWallet) =>
    firstWallet.name.localeCompare(secondWallet.name),
  );
}

/**
 * Wallets proposed when none is installed. Real products that can add and
 * sign on Coston2, official sites; the icons are the official brand marks,
 * bundled under public/wallets/. Phantom is deliberately absent: its EVM
 * mode cannot add custom chains.
 */
export const WALLET_PROPOSALS: ReadonlyArray<{
  readonly name: string;
  readonly url: string;
  readonly icon: string;
}> = [
  { name: "MetaMask", url: "https://metamask.io/download/", icon: "/wallets/metamask.svg" },
  { name: "Rabby", url: "https://rabby.io/", icon: "/wallets/rabby.png" },
  { name: "Brave Wallet", url: "https://brave.com/wallet/", icon: "/wallets/brave.svg" },
];
