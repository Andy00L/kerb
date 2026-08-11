"use client";

/**
 * The wallet dropdown, anchored to the header chip.
 *
 * Three states, one panel: installed wallets to pick from (EIP-6963), real
 * wallet proposals when nothing is installed, and the labelled demo identity
 * as the always-available last row. Escape closes, arrows move, a click
 * outside dismisses.
 */

import { useEffect, useRef } from "react";
import { useWallet } from "@/components/kerb/WalletProvider";
import { WALLET_PROPOSALS } from "@/lib/wallets";
import styles from "./WalletPicker.module.css";

/** Diagonal outward arrow for install links, matching the 1px glyph stroke. */
function OutwardArrow() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className={styles.outArrow}
      aria-hidden="true"
    >
      <path d="M2.5 7.5L7.5 2.5M3.5 2.5h4v4" />
    </svg>
  );
}

export function WalletPicker() {
  const { wallets, connectedRdns, isPickerOpen, connectWith, connectDemo, closePicker } =
    useWallet();
  const panelRef = useRef<HTMLDivElement>(null);

  // Synchronizes with document-level pointer and key events, systems React
  // does not own: a click outside or Escape dismisses the panel.
  useEffect(() => {
    if (!isPickerOpen) {
      return;
    }
    const dismissOnOutsidePress = (event: PointerEvent): void => {
      const panel = panelRef.current;
      if (panel !== null && !panel.parentElement?.contains(event.target as Node)) {
        closePicker();
      }
    };
    const handleKeys = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closePicker();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      );
      if (items.length === 0) {
        return;
      }
      event.preventDefault();
      const activeIndex = items.findIndex((item) => item === document.activeElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (activeIndex + step + items.length) % items.length;
      items[nextIndex]?.focus();
    };
    document.addEventListener("pointerdown", dismissOnOutsidePress);
    document.addEventListener("keydown", handleKeys);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePress);
      document.removeEventListener("keydown", handleKeys);
    };
  }, [isPickerOpen, closePicker]);

  // Focus lands on the first option when the panel opens (keyboard path).
  useEffect(() => {
    if (isPickerOpen) {
      panelRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus();
    }
  }, [isPickerOpen]);

  if (!isPickerOpen) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      role="menu"
      aria-label="Wallet selection"
    >
      {wallets.length > 0 ? (
        <>
          <div className={`eyebrow ${styles.groupLabel}`}>Installed wallets</div>
          {wallets.map((wallet) => (
            <button
              key={wallet.rdns}
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                void connectWith(wallet);
              }}
            >
              {wallet.icon === null ? (
                <span className={styles.walletMarkFallback} aria-hidden="true" />
              ) : (
                // EIP-6963 icons are same-page data URIs from the wallet itself.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={wallet.icon}
                  alt=""
                  className={styles.walletIcon}
                  aria-hidden="true"
                />
              )}
              <span className={styles.itemName}>{wallet.name}</span>
              {connectedRdns === wallet.rdns ? (
                <span className={styles.connectedMark}>connected</span>
              ) : null}
            </button>
          ))}
        </>
      ) : (
        <>
          <p className={styles.emptyLine}>No wallet extension detected.</p>
          <div className={`eyebrow ${styles.groupLabel}`}>Get one</div>
          {WALLET_PROPOSALS.map((proposal) => (
            <a
              key={proposal.name}
              href={proposal.url}
              target="_blank"
              rel="noreferrer"
              role="menuitem"
              className={styles.item}
            >
              <span className={styles.itemName}>{proposal.name}</span>
              <OutwardArrow />
            </a>
          ))}
        </>
      )}
      <div className={styles.separator} />
      <button
        type="button"
        role="menuitem"
        className={styles.item}
        onClick={connectDemo}
      >
        <span className={styles.itemName}>
          Demo identity
          <span className={styles.demoHint}>
            walk every flow on sample data
          </span>
        </span>
      </button>
    </div>
  );
}
