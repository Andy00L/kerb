"use client";

/**
 * App chrome: the left sidebar (bottom bar on small screens) and the main
 * column. Pages render their own header rows; the wallet cluster lives in
 * those rows via <WalletCluster />.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { truncateMiddle } from "@/lib/format";
import { WalletPicker } from "@/components/kerb/WalletPicker";
import { useWallet } from "@/components/kerb/WalletProvider";
import { IconHome, IconPlus, IconSliders } from "@/components/kerb/ui/icons";

export function AppShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/app";
  const isNew = pathname.startsWith("/app/new");

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav className="sidebar rise" aria-label="Kerb">
        <Link
          href="/"
          className="brand"
          aria-label="Kerb home"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "var(--paper)",
            color: "var(--on-paper)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 18,
          }}
        >
          K
        </Link>
        <Link
          className={isHome ? "navitem active" : "navitem"}
          href="/app"
          aria-current={isHome ? "page" : undefined}
        >
          <IconHome />
          <span className="nl">Home</span>
        </Link>
        <Link
          className={isNew ? "navitem active" : "navitem"}
          href="/app/new"
          aria-current={isNew ? "page" : undefined}
        >
          <IconPlus />
          <span className="nl">New mandate</span>
        </Link>
        <div
          className="shr"
          style={{ height: 1, background: "var(--hairline)", margin: "12px 4px" }}
        />
        <Link
          className="btn btn-quiet adv"
          href="/app/m/6"
          style={{ justifyContent: "center" }}
        >
          <IconSliders />
          <span className="nl">Advanced</span>
        </Link>
      </nav>
      <main style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
        <div
          className="maincol"
          style={{ width: "100%", maxWidth: 1100, padding: "24px 24px 80px" }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

/** Network chips plus the wallet chip and its picker; sits in header rows. */
export function WalletCluster() {
  const { address, isDemo, isPickerOpen, connect, closePicker } = useWallet();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="chip chip-neutral hact">Flare Coston2</span>
      <span className="chip chip-neutral hact">XRPL Testnet</span>
      <button
        type="button"
        className="btn btn-quiet num"
        aria-haspopup="dialog"
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
  );
}
