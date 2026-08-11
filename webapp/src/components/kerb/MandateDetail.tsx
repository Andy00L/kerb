"use client";

import { useState } from "react";
import { AppHeader } from "@/components/kerb/AppHeader";
import { PriceThread } from "@/components/kerb/PriceThread";
import { ProofSeal } from "@/components/kerb/ProofSeal";
import { SealedBar } from "@/components/kerb/SealedBar";
import { useWallet } from "@/components/kerb/WalletProvider";
import { readAppConfig } from "@/lib/config";
import {
  buildDemoTimeline,
  DEMO_DEPOSIT_ADDRESS,
  DEMO_SLICES,
  findDemoMandate,
  type DemoTimelineEvent,
  type MandateStatusWord,
} from "@/lib/demo";
import {
  formatDeltaBasisPoints,
  formatPriceMicro,
  formatXrpCents,
} from "@/lib/format";
import { submitCancel, submitReportRequest } from "@/lib/mandate";
import { useLivePrice } from "@/lib/useLivePrice";
import { useOnChainMandate } from "@/lib/useOnChainMandate";
import styles from "./MandateDetail.module.css";

/** Lifecycle words in on-chain order, for the live timeline. */
const LIVE_TIMELINE_WORDS: readonly MandateStatusWord[] = [
  "Created",
  "Provisioned",
  "Funded",
  "Executing",
  "Filled",
  "Settled",
];

/** Drops per hundredth of XRP, the display unit of formatXrpCents. */
const DROPS_PER_XRP_CENT = 10_000n;

/**
 * Timeline derived from the on-chain status alone. Timestamps and hashes need
 * the indexer, so they stay blank; the proof seal marks the two FDC-gated
 * states once they are reached.
 */
function buildLiveTimeline(statusWord: MandateStatusWord): DemoTimelineEvent[] {
  const reachedIndex = LIVE_TIMELINE_WORDS.indexOf(statusWord);
  return LIVE_TIMELINE_WORDS.map((word, index) => ({
    word,
    timestamp: "-",
    hash: "-",
    done: reachedIndex >= 0 && index <= reachedIndex,
    proven:
      reachedIndex >= 0 &&
      index <= reachedIndex &&
      (word === "Funded" || word === "Settled"),
  }));
}

const SEALED_FIELDS: ReadonlyArray<readonly [string, number]> = [
  ["Trigger price", 78],
  ["Direction", 44],
  ["Slice size", 62],
  ["Jitter", 36],
  ["Max slippage", 52],
  ["Expiry", 92],
];

export function MandateDetail({ mandateId }: { mandateId: number }) {
  const isLive = readAppConfig().isLive;
  const onChain = useOnChainMandate(isLive ? mandateId : null);
  const { address } = useWallet();
  const mandate = findDemoMandate(mandateId) ?? findDemoMandate(6);
  const [cancelled, setCancelled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reportRequested, setReportRequested] = useState(false);
  const [actionFailure, setActionFailure] = useState<string | null>(null);
  const price = useLivePrice(true);

  const baseStatus: MandateStatusWord =
    isLive && onChain !== null
      ? onChain.statusWord
      : (mandate?.status ?? "Executing");
  const status = cancelled ? "Cancelled" : baseStatus;
  const awaitingDeposit = status === "Created" || status === "Provisioned";
  const executing = !awaitingDeposit && status !== "Cancelled";
  const dimmed = status === "Cancelled" || status === "Expired";
  const filledCents = isLive
    ? (onChain?.filledDrops ?? 0n) / DROPS_PER_XRP_CENT
    : awaitingDeposit
      ? 0n
      : (mandate?.filledCents ?? 0n);
  const totalCents = mandate?.totalCents ?? 250_000n;
  const fillPercent =
    totalCents === 0n ? 0 : Number((filledCents * 1000n) / totalCents) / 10;
  const timeline = isLive
    ? buildLiveTimeline(baseStatus)
    : buildDemoTimeline(executing || dimmed);

  // Live mode shows only the enclave-derived address read from the contract;
  // the FDC deposit proof is bound to it, so nothing else may be funded.
  const depositAddress = isLive
    ? onChain !== null && onChain.depositAddress !== ""
      ? onChain.depositAddress
      : null
    : DEMO_DEPOSIT_ADDRESS;

  const copyDepositAddress = (): void => {
    if (depositAddress === null) {
      return;
    }
    try {
      void navigator.clipboard.writeText(depositAddress);
    } catch (copyError) {
      console.log(`[copyDepositAddress] clipboard unavailable: ${copyError}`);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1_200);
  };

  const requestReport = async (): Promise<void> => {
    setActionFailure(null);
    setReportRequested(true);
    if (isLive && address !== null) {
      const result = await submitReportRequest(mandateId, address);
      if (!result.ok) {
        setActionFailure(result.reason);
        setReportRequested(false);
        return;
      }
    }
    setTimeout(() => setReportRequested(false), 1_600);
  };

  const cancelMandate = async (): Promise<void> => {
    setActionFailure(null);
    if (isLive && address !== null) {
      const result = await submitCancel(mandateId, address);
      if (!result.ok) {
        setActionFailure(result.reason);
        return;
      }
    }
    setCancelled(true);
  };

  return (
    <div>
      <AppHeader />
      <main className={`container ${styles.main}`}>
        <div className={`${styles.headRow} rise`}>
          <div className={styles.headLeft}>
            <h1 className={styles.title}>XRP/USD</h1>
            <span className={styles.sideKind}>
              {isLive
                ? "side and kind sealed"
                : `${mandate?.side ?? "Sell"} · ${mandate?.kind ?? "stop"}`}
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
            <span className="chip">
              Mandate #{isLive ? mandateId : (mandate?.id ?? 6)}
            </span>
            <button
              type="button"
              className="btn btnQuiet"
              disabled={reportRequested}
              onClick={() => {
                void requestReport();
              }}
            >
              {reportRequested ? "Report requested" : "Request report"}
            </button>
            <button
              type="button"
              className="btn btnDanger"
              onClick={() => {
                void cancelMandate();
              }}
            >
              Cancel mandate
            </button>
          </div>
        </div>

        {actionFailure !== null ? (
          <div className="errorBand" style={{ marginTop: 12 }}>
            <span>{actionFailure}</span>
          </div>
        ) : null}

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
              {isLive
                ? `${formatXrpCents(filledCents)} XRP filled · total sealed`
                : `${formatXrpCents(filledCents)} / ${formatXrpCents(totalCents)} XRP`}
            </div>
            {isLive ? null : (
              // The total is part of the sealed strategy, so live mode has no
              // denominator to draw a progress bar against.
              <div className={styles.progressTrack}>
                <span
                  className={styles.progressFill}
                  style={{ width: `${fillPercent}%` }}
                />
              </div>
            )}
            {!executing && !dimmed ? (
              <p className={styles.emptyFills}>
                No fills yet. Waiting for the trigger.
              </p>
            ) : isLive ? (
              <p className={styles.emptyFills}>
                Per-slice fills live on XRPL: open the deposit account on the
                testnet explorer to audit every OfferCreate.
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
            {depositAddress === null ? (
              <div className={`well ${styles.depositWell}`}>
                <span className={`mono ${styles.depositAddress}`}>
                  Provisioning…
                </span>
              </div>
            ) : (
              <div className={`well ${styles.depositWell}`}>
                <span className={`mono ${styles.depositAddress}`}>
                  {depositAddress}
                </span>
                <button
                  type="button"
                  className={`btn btnQuiet ${styles.copyButton}`}
                  onClick={copyDepositAddress}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
            <div className={`mono ${styles.depositTag}`}>
              Tag: {isLive ? mandateId : (mandate?.id ?? 6)}, required
            </div>
            <p className={styles.depositNote}>
              {depositAddress === null
                ? "The enclave-derived address appears once provisioning is relayed on-chain. Do not send funds before it does."
                : "Fund from any XRPL wallet. The deposit is proven on-chain by FDC."}
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
