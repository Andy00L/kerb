"use client";

/**
 * Shared wallet state.
 *
 * One connection for the whole app: the header chip and every screen read
 * the same context, so connecting anywhere connects everywhere. Wallets are
 * discovered per EIP-6963 (src/lib/wallets.ts); the user picks one from the
 * header dropdown. Without any installed wallet the picker proposes real
 * ones and offers the labelled demo identity, so every flow stays walkable
 * in a judging setup.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { COSTON2_CHAIN_ID } from "@/lib/config";
import { DEMO_WALLET } from "@/lib/demo";
import {
  discoverWallets,
  type DetectedWallet,
  type Eip1193Provider,
} from "@/lib/wallets";

export interface WalletState {
  readonly address: string | null;
  readonly isDemo: boolean;
  /** The provider transactions go through; null when demo or disconnected. */
  readonly provider: Eip1193Provider | null;
  /** rdns of the connected wallet, for the picker's "connected" marker. */
  readonly connectedRdns: string | null;
  readonly wallets: DetectedWallet[];
  readonly isPickerOpen: boolean;
  /** Re-detects wallets and opens the picker (or connects the only one). */
  readonly connect: () => Promise<void>;
  readonly connectWith: (wallet: DetectedWallet) => Promise<void>;
  readonly connectDemo: () => void;
  readonly disconnect: () => void;
  readonly closePicker: () => void;
}

const WalletContext = createContext<WalletState>({
  address: null,
  isDemo: false,
  provider: null,
  connectedRdns: null,
  wallets: [],
  isPickerOpen: false,
  connect: async () => {},
  connectWith: async () => {},
  connectDemo: () => {},
  disconnect: () => {},
  closePicker: () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [connectedRdns, setConnectedRdns] = useState<string | null>(null);
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [isPickerOpen, setPickerOpen] = useState(false);

  const connectWith = useCallback(
    async (wallet: DetectedWallet): Promise<void> => {
      try {
        const accounts = (await wallet.provider.request({
          method: "eth_requestAccounts",
        })) as string[];
        const firstAccount = accounts[0];
        if (firstAccount === undefined) {
          return;
        }
        setAddress(firstAccount);
        setIsDemo(false);
        setProvider(wallet.provider);
        setConnectedRdns(wallet.rdns);
        setPickerOpen(false);
        // Best effort: land the wallet on Coston2. A rejection is not fatal.
        try {
          await wallet.provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${COSTON2_CHAIN_ID.toString(16)}` }],
          });
        } catch (switchError) {
          console.log(`[connectWith] chain switch declined: ${switchError}`);
        }
      } catch (connectError) {
        console.log(`[connectWith] connection declined: ${connectError}`);
      }
    },
    [],
  );

  const connectDemo = useCallback((): void => {
    setAddress(DEMO_WALLET);
    setIsDemo(true);
    setProvider(null);
    setConnectedRdns(null);
    setPickerOpen(false);
  }, []);

  // Forgets the session's connection state. Injected wallets keep their own
  // site permission; revoking that lives in the wallet, not the page.
  const disconnect = useCallback((): void => {
    setAddress(null);
    setIsDemo(false);
    setProvider(null);
    setConnectedRdns(null);
    setPickerOpen(false);
  }, []);

  const connect = useCallback(async (): Promise<void> => {
    const detected = discoverWallets();
    setWallets(detected);
    // Exactly one wallet and nothing connected yet: no choice to make.
    if (detected.length === 1 && address === null) {
      const onlyWallet = detected[0];
      if (onlyWallet !== undefined) {
        await connectWith(onlyWallet);
        return;
      }
    }
    setPickerOpen(true);
  }, [address, connectWith]);

  const closePicker = useCallback((): void => {
    setPickerOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      address,
      isDemo,
      provider,
      connectedRdns,
      wallets,
      isPickerOpen,
      connect,
      connectWith,
      connectDemo,
      disconnect,
      closePicker,
    }),
    [
      address,
      isDemo,
      provider,
      connectedRdns,
      wallets,
      isPickerOpen,
      connect,
      connectWith,
      connectDemo,
      disconnect,
      closePicker,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  return useContext(WalletContext);
}
