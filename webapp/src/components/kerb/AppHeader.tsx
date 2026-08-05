"use client";

import Link from "next/link";
import { truncateMiddle } from "@/lib/format";
import { useWallet } from "@/components/kerb/WalletProvider";
import styles from "./AppHeader.module.css";

/** Shared app bar: wordmark, compound network badge, wallet chip. */
export function AppHeader() {
  const { address, connect } = useWallet();

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
          <button
            type="button"
            className={`mono ${styles.walletChip}`}
            onClick={() => {
              void connect();
            }}
          >
            {address === null ? "Connect" : truncateMiddle(address, 6, 4)}
          </button>
        </div>
      </div>
    </header>
  );
}
