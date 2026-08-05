"use client";

/**
 * Shared wallet state.
 *
 * One EIP-1193 connection for the whole app: the header chip and every
 * screen read the same context, so connecting anywhere connects everywhere.
 * Without a browser wallet (the common judging setup), connect falls back to
 * a labelled demo identity so every flow stays walkable.
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

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export interface WalletState {
  readonly address: string | null;
  readonly isDemo: boolean;
  readonly connect: () => Promise<void>;
}

const WalletContext = createContext<WalletState>({
  address: null,
  isDemo: false,
  connect: async () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  const connect = useCallback(async (): Promise<void> => {
    const provider =
      typeof window !== "undefined" ? window.ethereum : undefined;
    if (provider === undefined) {
      setAddress(DEMO_WALLET);
      setIsDemo(true);
      return;
    }
    try {
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];
      const firstAccount = accounts[0];
      if (firstAccount === undefined) {
        return;
      }
      setAddress(firstAccount);
      setIsDemo(false);
      // Best effort: land the wallet on Coston2. A rejection is not fatal.
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${COSTON2_CHAIN_ID.toString(16)}` }],
        });
      } catch (switchError) {
        console.log(`[WalletProvider] chain switch declined: ${switchError}`);
      }
    } catch (connectError) {
      console.log(`[WalletProvider] connection declined: ${connectError}`);
    }
  }, []);

  const value = useMemo(
    () => ({ address, isDemo, connect }),
    [address, isDemo, connect],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  return useContext(WalletContext);
}
