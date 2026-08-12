"use client";

/**
 * The wallet picker, as a centered modal dialog.
 *
 * Three states, one panel: installed wallets to pick from (EIP-6963), real
 * wallet proposals when nothing is installed, and the labelled demo identity
 * as the always-available last row. Escape closes, arrows move, a click on
 * the dimmed backdrop dismisses.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@/components/kerb/WalletProvider";
import { WALLET_PROPOSALS } from "@/lib/wallets";
import { truncateMiddle } from "@/lib/format";
import { IconClose, IconOpen } from "@/components/kerb/ui/icons";

export function WalletPicker() {
  const {
    address,
    isDemo,
    wallets,
    connectedRdns,
    isPickerOpen,
    connectWith,
    connectDemo,
    disconnect,
    closePicker,
  } = useWallet();
  const panelRef = useRef<HTMLDivElement>(null);

  // Synchronizes with document-level key events, a system React does not
  // own: Escape dismisses, arrows move between options.
  useEffect(() => {
    if (!isPickerOpen) {
      return;
    }
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
    document.addEventListener("keydown", handleKeys);
    return () => {
      document.removeEventListener("keydown", handleKeys);
    };
  }, [isPickerOpen, closePicker]);

  // Focus lands on the first option when the dialog opens (keyboard path).
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

  // Portaled to <body>: entrance animations up the tree keep filling stacking
  // contexts, which would trap and clip a fixed overlay rendered in place.
  return createPortal(
    <div
      className="overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          closePicker();
        }
      }}
    >
      <div
        ref={panelRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Connect a wallet"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "8px 4px 4px 12px",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600 }}>Connect a wallet</span>
          <button
            type="button"
            className="btn-icon"
            aria-label="Close"
            onClick={closePicker}
          >
            <IconClose />
          </button>
        </div>
        <p className="cap" style={{ padding: "0 12px 10px" }}>
          Pick an installed wallet, or use the demo identity to walk every
          flow on sample data.
        </p>
        {wallets.length > 0 ? (
          wallets.map((wallet) => (
            <button
              key={wallet.rdns}
              type="button"
              role="menuitem"
              className="mitem"
              style={{ justifyContent: "flex-start" }}
              onClick={() => {
                void connectWith(wallet);
              }}
            >
              {wallet.icon === null ? (
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
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
                  style={{ width: 22, height: 22, borderRadius: 6, flex: "none" }}
                />
              )}
              <span style={{ flex: 1, textAlign: "left", fontSize: 14, color: "var(--ink)" }}>
                {wallet.name}
              </span>
              {connectedRdns === wallet.rdns ? (
                <span className="chip chip-up">connected</span>
              ) : null}
            </button>
          ))
        ) : (
          <>
            <p className="cap" style={{ padding: "0 12px 6px" }}>
              No wallet extension detected. Get one:
            </p>
            {WALLET_PROPOSALS.map((proposal) => (
              <a
                key={proposal.name}
                href={proposal.url}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                className="mitem"
                style={{ justifyContent: "flex-start" }}
              >
                {/* Official brand marks, bundled locally under public/wallets. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={proposal.icon}
                  alt=""
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    objectFit: "contain",
                    flex: "none",
                  }}
                />
                <span style={{ flex: 1, textAlign: "left", fontSize: 14, color: "var(--ink)" }}>
                  {proposal.name}
                </span>
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
          style={{ height: "auto", padding: "10px 12px" }}
          onClick={connectDemo}
        >
          <span style={{ textAlign: "left" }}>
            <span style={{ fontSize: 14, color: "var(--ink)" }}>
              Demo identity
              {isDemo ? (
                <span className="chip chip-up" style={{ marginLeft: 8 }}>
                  connected
                </span>
              ) : null}
            </span>
            <br />
            <span className="cap">walk every flow on sample data</span>
          </span>
        </button>
        {address !== null ? (
          <>
            <div style={{ height: 1, background: "var(--hairline)", margin: "6px 4px" }} />
            <button
              type="button"
              role="menuitem"
              className="mitem"
              style={{ color: "var(--down)" }}
              onClick={disconnect}
            >
              <span style={{ fontSize: 14 }}>Disconnect</span>
              <span className="cap num">
                {isDemo ? "demo identity" : truncateMiddle(address, 6, 4)}
              </span>
            </button>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
