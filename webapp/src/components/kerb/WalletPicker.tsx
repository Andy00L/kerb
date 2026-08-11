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
import { IconOpen } from "@/components/kerb/ui/icons";

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

  return (
    <div
      ref={panelRef}
      className={`menu${isPickerOpen ? " open" : ""}`}
      role="menu"
      aria-label="Wallet selection"
      style={{ minWidth: 240 }}
    >
      {wallets.length > 0 ? (
        <>
          <div className="cap" style={{ padding: "8px 12px 4px" }}>
            Installed wallets
          </div>
          {wallets.map((wallet) => (
            <button
              key={wallet.rdns}
              type="button"
              role="menuitem"
              className="mitem"
              tabIndex={isPickerOpen ? 0 : -1}
              style={{ justifyContent: "flex-start" }}
              onClick={() => {
                void connectWith(wallet);
              }}
            >
              {wallet.icon === null ? (
                <span
                  aria-hidden
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    background: "var(--card-hover)",
                    border: "1px solid var(--hairline)",
                    flex: "none",
                  }}
                />
              ) : (
                // EIP-6963 icons are same-page data URIs from the wallet itself.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={wallet.icon}
                  alt=""
                  aria-hidden
                  style={{ width: 20, height: 20, borderRadius: 6, flex: "none" }}
                />
              )}
              <span style={{ flex: 1, textAlign: "left" }}>{wallet.name}</span>
              {connectedRdns === wallet.rdns ? (
                <span className="chip chip-up">connected</span>
              ) : null}
            </button>
          ))}
        </>
      ) : (
        <>
          <p className="cap" style={{ padding: "8px 12px 4px" }}>
            No wallet extension detected.
          </p>
          <div className="cap" style={{ padding: "8px 12px 4px" }}>
            Get one
          </div>
          {WALLET_PROPOSALS.map((proposal) => (
            <a
              key={proposal.name}
              href={proposal.url}
              target="_blank"
              rel="noreferrer"
              role="menuitem"
              className="mitem"
              tabIndex={isPickerOpen ? 0 : -1}
            >
              <span>{proposal.name}</span>
              <IconOpen />
            </a>
          ))}
        </>
      )}
      <div style={{ height: 1, background: "var(--hairline)", margin: "6px 4px" }} />
      <button
        type="button"
        role="menuitem"
        className="mitem"
        tabIndex={isPickerOpen ? 0 : -1}
        style={{ height: "auto", padding: "8px 12px" }}
        onClick={connectDemo}
      >
        <span style={{ textAlign: "left" }}>
          Demo identity
          <br />
          <span className="cap">walk every flow on sample data</span>
        </span>
      </button>
    </div>
  );
}
