"use client";

import { useState } from "react";
import { AppHeader } from "@/components/kerb/AppHeader";
import { PriceThread } from "@/components/kerb/PriceThread";
import { ProofSeal } from "@/components/kerb/ProofSeal";
import { SealedBar } from "@/components/kerb/SealedBar";
import {
  buildDemoTimeline,
  DEMO_DEPOSIT_ADDRESS,
  DEMO_SLICES,
  findDemoMandate,
} from "@/lib/demo";
import {
  formatDeltaBasisPoints,
  formatPriceMicro,
  formatXrpCents,
} from "@/lib/format";
import { useLivePrice } from "@/lib/useLivePrice";
import styles from "./MandateDetail.module.css";

const SEALED_FIELDS: ReadonlyArray<readonly [string, number]> = [
  ["Trigger price", 78],
  ["Direction", 44],
  ["Slice size", 62],
  ["Jitter", 36],
  ["Max slippage", 52],
  ["Expiry", 92],
];

export function MandateDetail({ mandateId }: { mandateId: number }) {
  const mandate = findDemoMandate(mandateId) ?? findDemoMandate(6);
  const [cancelled, setCancelled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reportRequested, setReportRequested] = useState(false);
  const price = useLivePrice(true);

  const status = cancelled ? "Cancelled" : (mandate?.status ?? "Executing");
  const awaitingDeposit = status === "Created" || status === "Provisioned";
  const executing = !awaitingDeposit && status !== "Cancelled";
  const dimmed = status === "Cancelled" || status === "Expired";
  const filledCents = awaitingDeposit ? 0n : (mandate?.filledCents ?? 0n);
  const totalCents = mandate?.totalCents ?? 250_000n;
  const fillPercent =
    totalCents === 0n ? 0 : Number((filledCents * 1000n) / totalCents) / 10;
  const timeline = buildDemoTimeline(executing || dimmed);

  const copyDepositAddress = (): void => {
    try {
      void navigator.clipboard.writeText(DEMO_DEPOSIT_ADDRESS);
    } catch (copyError) {
      console.log(`[copyDepositAddress] clipboard unavailable: ${copyError}`);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1_200);
  };

  return (
    <div>
      <AppHeader />
      <main className={`container ${styles.main}`}>
        <div className={`${styles.headRow} rise`}>
          <div className={styles.headLeft}>
            <h1 className={styles.title}>XRP/USD</h1>
            <span className={styles.sideKind}>
              {mandate?.side ?? "Sell"} · {mandate?.kind ?? "stop"}
            </span>
            <span
              className={styles.status}
              style={{ color: dimmed ? "var(--ink-faint)" : "var(--ink-muted)" }}
            >
              ● {status}
            </span>
          </div>
          <div
            className={styles.actions}
            style={
              dimmed ? { opacity: 0.45, pointerEvents: "none" } : undefined
            }
          >
            <span className="chip">Mandate #{mandate?.id ?? 6}</span>
            <button
              type="button"
              className="btn btnQuiet"
              disabled={reportRequested}
              onClick={() => {
                // Live mode relays a REPORT instruction; the demo acknowledges.
                setReportRequested(true);
                setTimeout(() => setReportRequested(false), 1_600);
              }}
            >
              {reportRequested ? "Report requested" : "Request report"}
            </button>
            <button
              type="button"
              className="btn btnDanger"
              onClick={() => setCancelled(true)}
            >
              Cancel mandate
            </button>
          </div>
        </div>

        <div className={`${styles.threadRow} rise`} style={{ animationDelay: "40ms" }}>
          <PriceThread
            heightPx={180}
            bandTopPx={76}
            bandHeightPx={46}
            caption="Trigger sealed in this band"
            drawOnEnter
          />
          <div className={styles.priceColumn}>
            <div className={`mono ${styles.livePrice}`}>
              <span className={price.flash ? styles.priceFlash : styles.priceQuiet}>
                {formatPriceMicro(price.priceMicro)}
              </span>
            </div>
            <div className={`mono ${styles.priceDelta}`}>
              {price.openMicro === 0n
                ? "0.00%"
                : formatDeltaBasisPoints(price.priceMicro, price.openMicro)}{" "}
              session
            </div>
          </div>
        </div>

        <div className={`${styles.grid} rise`} style={{ animationDelay: "80ms" }}>
          <section className="card">
            <h2 className={styles.cardTitle}>Execution</h2>
            <div className="hairlineSolid" style={{ margin: "12px 0 16px" }} />
            <div className={`mono ${styles.fillLine}`}>
              {formatXrpCents(filledCents)} / {formatXrpCents(totalCents)} XRP
            </div>
            <div className={styles.progressTrack}>
              <span
                className={styles.progressFill}
                style={{ width: `${fillPercent}%` }}
              />
            </div>
            {!executing && !dimmed ? (
              <p className={styles.emptyFills}>
                No fills yet. Waiting for the trigger.
              </p>
            ) : (
              <div className={styles.sliceBlock}>
                <div className={`${styles.sliceGrid} ${styles.sliceHeader}`}>
                  <span className="eyebrow">Time</span>
                  <span className={`eyebrow ${styles.rightAlign}`}>Size</span>
                  <span className={`eyebrow ${styles.hashPad}`}>XRPL tx</span>
                  <span className={`eyebrow ${styles.rightAlign}`}>Result</span>
                </div>
                {DEMO_SLICES.map((slice) => (
                  <div
                    key={slice.hash}
                    className={`${styles.sliceGrid} ${styles.sliceRow} ${
                      slice.settled ? styles.rowBoundary : styles.rowDashed
                    }`}
                  >
                    <span className={`mono ${styles.sliceMeta}`}>
                      {slice.time}
                    </span>
                    <span className={`mono ${styles.sliceSize}`}>
                      {slice.sizeXrp}
                    </span>
                    <span className={`mono ${styles.sliceMeta} ${styles.hashPad}`}>
                      {slice.hash}
                    </span>
                    <span className={styles.sliceResult}>{slice.result}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section
            className="card"
            style={{ position: "relative" }}
          >
            {awaitingDeposit ? <span className={styles.depositRing} /> : null}
            <div className={styles.cardHeadRow}>
              <h2 className={styles.cardTitle}>Deposit</h2>
              {executing ? <ProofSeal animated /> : null}
            </div>
            <div className="hairlineSolid" style={{ margin: "12px 0 16px" }} />
            <div className={`well ${styles.depositWell}`}>
              <span className={`mono ${styles.depositAddress}`}>
                {DEMO_DEPOSIT_ADDRESS}
              </span>
              <button
                type="button"
                className={`btn btnQuiet ${styles.copyButton}`}
                onClick={copyDepositAddress}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className={`mono ${styles.depositTag}`}>
              Tag: {mandate?.id ?? 6}, required
            </div>
            <p className={styles.depositNote}>
              Fund from any XRPL wallet. The deposit is proven on-chain by FDC.
            </p>
          </section>
        </div>

        <section
          className={`card ${styles.blockCard} rise`}
          style={{ animationDelay: "120ms" }}
        >
          <h2 className={styles.cardTitle}>Timeline</h2>
          <div className="hairlineSolid" style={{ margin: "12px 0 4px" }} />
          {timeline.map((event, index) => (
            <div
              key={event.word}
              className={`${styles.timelineGrid} ${
                index === 0
                  ? ""
                  : event.done
                    ? styles.rowBoundary
                    : styles.rowDashed
              }`}
              style={{ color: event.done ? "var(--ink)" : "var(--ink-faint)" }}
            >
              <span className={styles.timelineWord}>{event.word}</span>
              <span className={`mono ${styles.timelineMeta}`}>
                {event.timestamp}
              </span>
              <span className={`mono ${styles.timelineMeta}`}>{event.hash}</span>
              <span className={styles.timelineSealSlot}>
                {event.proven ? <ProofSeal animated /> : null}
              </span>
            </div>
          ))}
        </section>

        <section
          className={`card ${styles.blockCard} rise`}
          style={{ animationDelay: "160ms" }}
        >
          <div className={styles.cardHeadRow}>
            <h2 className={styles.cardTitle}>Strategy (sealed)</h2>
            <span className={`mono ${styles.sealedCaption}`}>Sealed in TEE</span>
          </div>
          <div className="hairlineSolid" style={{ margin: "12px 0 20px" }} />
          <div className={styles.sealedGrid}>
            {SEALED_FIELDS.map(([label, widthPx]) => (
              <div key={label}>
                <div className={styles.sealedLabel}>{label}</div>
                <SealedBar widthPx={widthPx} />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
