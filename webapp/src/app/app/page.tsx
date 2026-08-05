"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "@/components/kerb/AppHeader";
import { SealedBar } from "@/components/kerb/SealedBar";
import { useLivePrice } from "@/lib/useLivePrice";
import { useWallet } from "@/components/kerb/WalletProvider";
import {
  DEMO_MANDATES,
  type DemoMandate,
  type MandateStatusWord,
} from "@/lib/demo";
import { formatPriceMicro, formatXrpCents } from "@/lib/format";
import styles from "./Dashboard.module.css";

function computeFillPercent(mandate: DemoMandate): number {
  if (mandate.totalCents === 0n) {
    return 0;
  }
  return Number((mandate.filledCents * 100n) / mandate.totalCents);
}

function isDimStatus(status: MandateStatusWord): boolean {
  return status === "Cancelled" || status === "Expired";
}

export default function DashboardPage() {
  const router = useRouter();
  const { address, connect } = useWallet();
  const price = useLivePrice(true);
  const [cancelledIds, setCancelledIds] = useState<ReadonlySet<number>>(
    new Set(),
  );

  const connected = address !== null;
  const rows = DEMO_MANDATES.map((mandate) =>
    cancelledIds.has(mandate.id)
      ? { ...mandate, status: "Cancelled" as const, cancellable: false }
      : mandate,
  );

  // One live cell flashes per tick: rotate deterministically by price value.
  const liveRowIds = rows
    .filter((row) => !isDimStatus(row.status))
    .map((row) => row.id);
  const activeFlashId =
    price.flash && liveRowIds.length > 0
      ? liveRowIds[Number(price.priceMicro % BigInt(liveRowIds.length))]
      : null;

  const markCancelled = (mandateId: number): void => {
    setCancelledIds((current) => new Set(current).add(mandateId));
  };

  return (
    <div>
      <AppHeader />
      <main className={`container ${styles.main}`}>
        <div className={`${styles.headRow} rise`}>
          <h1 className={styles.title}>Mandates</h1>
          {connected ? (
            <Link href="/app/new" className="btn btnPrimary">
              New mandate
            </Link>
          ) : null}
        </div>

        {!connected ? (
          <div className={`card ${styles.centerBlock} rise`}>
            <p className={styles.centerText}>
              Connect a wallet to see your mandates.
            </p>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => {
                void connect();
              }}
            >
              Connect wallet
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className={`card ${styles.centerBlock} rise`}>
            <SealedBar widthPx={96} />
            <p className={styles.centerText}>
              No mandates yet. Your first strategy stays sealed from the moment
              it leaves this screen.
            </p>
            <Link href="/app/new" className="btn btnPrimary">
              New mandate
            </Link>
          </div>
        ) : (
          <div className={`${styles.tablePanel} rise`}>
            <div className={`${styles.rowGrid} ${styles.headerRow}`}>
              <span className="eyebrow">Id</span>
              <span className="eyebrow">Pair</span>
              <span className={`eyebrow ${styles.right}`}>Size</span>
              <span className="eyebrow">Trigger</span>
              <span className={`eyebrow ${styles.right}`}>Price</span>
              <span className="eyebrow">Status</span>
              <span />
            </div>
            {rows.map((row, index) => {
              const dim = isDimStatus(row.status);
              const settled = row.status === "Settled";
              const previousSettled =
                index > 0 && rows[index - 1].status === "Settled";
              const boundary = index === 0 || settled || previousSettled;
              return (
                <div
                  key={row.id}
                  className={`${styles.rowGrid} ${styles.dataRow} ${
                    boundary ? styles.rowBoundary : styles.rowDashed
                  } ${dim ? styles.rowDim : ""}`}
                  onClick={() => router.push(`/app/m/${row.id}`)}
                  style={{ animationDelay: `${index * 40}ms` }}
                >
                  <span className={`mono ${styles.idCell}`}>#{row.id}</span>
                  <span className={styles.pairCell}>
                    <span>XRP/USD</span>
                    <span className={styles.sideKind}>
                      {row.side} · {row.kind}
                    </span>
                  </span>
                  <span className={styles.sizeCell}>
                    <span className="mono">
                      {formatXrpCents(row.filledCents)} /{" "}
                      {formatXrpCents(row.totalCents)}
                    </span>
                    <span className={styles.progressTrack}>
                      <span
                        className={styles.progressFill}
                        style={{ width: `${computeFillPercent(row)}%` }}
                      />
                    </span>
                  </span>
                  <span>
                    <SealedBar widthPx={row.sealWidthPx} />
                  </span>
                  <span className={`mono ${styles.priceCell}`}>
                    <span
                      className={
                        activeFlashId === row.id && !dim
                          ? styles.priceFlash
                          : styles.priceQuiet
                      }
                    >
                      {formatPriceMicro(price.priceMicro)}
                    </span>
                  </span>
                  <span className={styles.statusCell}>
                    <span
                      className="statusDot"
                      style={{
                        background: settled
                          ? "var(--proof)"
                          : dim
                            ? "var(--ink-faint)"
                            : "var(--ink-muted)",
                      }}
                    />
                    {row.status}
                  </span>
                  <span className={styles.actionsCell}>
                    <Link
                      href={`/app/m/${row.id}`}
                      className={`btn btnQuiet ${styles.rowAction}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      View
                    </Link>
                    {row.cancellable ? (
                      <button
                        type="button"
                        className={styles.cancelAction}
                        onClick={(event) => {
                          event.stopPropagation();
                          markCancelled(row.id);
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
