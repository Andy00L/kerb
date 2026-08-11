"use client";

import Link from "next/link";
import { truncateMiddle } from "@/lib/format";
import { WalletPicker } from "@/components/kerb/WalletPicker";
import { useWallet } from "@/components/kerb/WalletProvider";
import pickerStyles from "./WalletPicker.module.css";
import styles from "./AppHeader.module.css";

/** Shared app bar: wordmark, compound network badge, wallet chip. */
export function AppHeader() {
  const { address, isDemo, isPickerOpen, connect, closePicker } = useWallet();

  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.wordmark}>
          Kerb
        </Link>
        <div className={styles.right}>
          <div className={styles.networks}>
            <span className={styles.network}>
              <span className="statusDot" />
              Flare Coston2
            </span>
            <span className={styles.network}>
              <span className="statusDot" />
              XRPL Testnet
            </span>
          </div>
          <div className={pickerStyles.anchor}>
            <button
              type="button"
              className={`mono ${styles.walletChip}`}
              aria-haspopup="menu"
              aria-expanded={isPickerOpen}
              onClick={() => {
                if (isPickerOpen) {
                  closePicker();
                  return;
                }
                void connect();
              }}
            >
              {address === null
                ? "Connect"
                : isDemo
                  ? "demo identity"
                  : truncateMiddle(address, 6, 4)}
            </button>
            <WalletPicker />
          </div>
        </div>
      </div>
    </header>
  );
}
