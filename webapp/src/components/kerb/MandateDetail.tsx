"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WalletCluster } from "@/components/kerb/AppShell";
import { ProofSeal } from "@/components/kerb/ProofSeal";
import { SealedBar } from "@/components/kerb/SealedBar";
import { Fold } from "@/components/kerb/ui/Fold";
import { HalftoneChart } from "@/components/kerb/ui/HalftoneChart";
import { Menu } from "@/components/kerb/ui/Menu";
import { Star } from "@/components/kerb/ui/Star";
import { Tabs } from "@/components/kerb/ui/Tabs";
import { Ticker } from "@/components/kerb/ui/Ticker";
import {
  IconArrowLeft,
  IconCandles,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconFullscreen,
  IconLine,
  IconPlus,
  IconRail,
} from "@/components/kerb/ui/icons";
import { useWallet } from "@/components/kerb/WalletProvider";
import { buildRangeSeries } from "@/lib/chartSeries";
import { readAppConfig } from "@/lib/config";
import {
  buildDemoTimeline,
  DEMO_DEPOSIT_ADDRESS,
  DEMO_MANDATES,
  findDemoMandate,
  type DemoTimelineEvent,
  type MandateStatusWord,
} from "@/lib/demo";
import {
  formatDeltaBasisPoints,
  formatPriceMicro,
  formatSignedPriceMicro,
  formatXrpCents,
  truncateMiddle,
} from "@/lib/format";
import { submitCancel, submitReportRequest } from "@/lib/mandate";
import { useLivePrice } from "@/lib/useLivePrice";
import { useOnChainMandate } from "@/lib/useOnChainMandate";

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

const RANGE_TABS = ["1H", "1D", "1W", "1M", "3M", "YTD", "1Y"] as const;
type RangeKey = (typeof RANGE_TABS)[number];
type PaneKey = "pending" | "fills" | "history";
type ChartStyle = "candles" | "line";

/** Points per curve, by candle interval: finer candles, denser curve. */
const INTERVAL_POINTS: Readonly<Record<string, number>> = {
  "1h": 96,
  "1d": 64,
  "1w": 32,
};

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

interface LadderRow {
  readonly slice: string;
  readonly amount: string;
  readonly fill: string | null;
  readonly pending: boolean;
}

/** Demo ladder, highest slice first; the trigger line sits at the waterline. */
const LADDER_TOP: readonly LadderRow[] = [
  { slice: "#5", amount: "110.00", fill: null, pending: true },
  { slice: "#4", amount: "105.44", fill: "300.19", pending: false },
];

const LADDER_BOTTOM: readonly LadderRow[] = [
  { slice: "#3", amount: "98.20", fill: "279.55", pending: false },
  { slice: "#2", amount: "96.75", fill: "275.42", pending: false },
  { slice: "#1", amount: "87.61", fill: "249.39", pending: false },
];

/** Human name of a mandate kind, matching the dashboard's row titles. */
function kindLabel(kind: string): string {
  return kind === "DCA" || kind === "dca"
    ? "DCA"
    : kind === "limit"
      ? "Limit"
      : "Stop-loss";
}

const DEMO_FILLS: ReadonlyArray<readonly [string, string, string, string]> = [
  ["Slice #4", "105.44 XRP", "300.19 USD", "Aug 10, 14:22"],
  ["Slice #3", "98.20 XRP", "279.55 USD", "Aug 9, 09:10"],
  ["Slice #2", "96.75 XRP", "275.42 USD", "Aug 8, 11:47"],
  ["Slice #1", "87.61 XRP", "249.39 USD", "Aug 7, 16:03"],
];

function factRow(
  label: string,
  value: ReactNode,
  wide = false,
): ReactNode {
  return (
    <div
      key={label}
      style={{
        gridColumn: wide ? "1 / -1" : undefined,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        minHeight: 32,
      }}
    >
      <span className="cap">{label}</span>
      {value}
    </div>
  );
}

export function MandateDetail({ mandateId }: { readonly mandateId: number }) {
  const { isLive, isDemoEnabled } = readAppConfig();
  const onChain = useOnChainMandate(isLive ? mandateId : null);
  // Sample data renders only on demo builds that are not chain-backed.
  const showDemoData = isDemoEnabled && !isLive;
  const { address, provider } = useWallet();
  const mandate = findDemoMandate(mandateId) ?? findDemoMandate(6);
  const [cancelled, setCancelled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reportRequested, setReportRequested] = useState(false);
  const [actionFailure, setActionFailure] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("1D");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("line");
  const [interval, setIntervalKey] = useState("1d");
  const [expiry, setExpiry] = useState("Sep 8 (28d)");
  const [ladderOpen, setLadderOpen] = useState(true);
  const [ladderSide, setLadderSide] = useState<"sell" | "buy">("sell");
  const [pane, setPane] = useState<PaneKey>("fills");
  const [tallChart, setTallChart] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const price = useLivePrice(true);

  // Session high and low ride along with the live feed. The pre-first-read
  // placeholder never counts: openMicro is 0n until a reading applied.
  const highRef = useRef(0n);
  const lowRef = useRef(0n);
  useEffect(() => {
    if (price.priceMicro === 0n || price.openMicro === 0n) {
      return;
    }
    if (highRef.current === 0n || price.priceMicro > highRef.current) {
      highRef.current = price.priceMicro;
    }
    if (lowRef.current === 0n || price.priceMicro < lowRef.current) {
      lowRef.current = price.priceMicro;
    }
  }, [price.priceMicro]);

  const baseStatus: MandateStatusWord =
    isLive && onChain !== null
      ? onChain.statusWord
      : (mandate?.status ?? "Executing");
  const status = cancelled ? "Cancelled" : baseStatus;
  const awaitingDeposit = status === "Created" || status === "Provisioned";
  const executing = !awaitingDeposit && status !== "Cancelled";
  const dimmed = status === "Cancelled" || status === "Expired";
  const settled = status === "Settled";
  const filledCents = isLive
    ? (onChain?.filledDrops ?? 0n) / DROPS_PER_XRP_CENT
    : awaitingDeposit || !isDemoEnabled
      ? 0n
      : (mandate?.filledCents ?? 0n);
  const totalCents = mandate?.totalCents ?? 250_000n;
  const timeline = showDemoData
    ? buildDemoTimeline(executing || dimmed)
    : buildLiveTimeline(baseStatus);

  // Live mode shows only the enclave-derived address read from the contract;
  // the FDC deposit proof is bound to it, so nothing else may be funded.
  const depositAddress = isLive
    ? onChain !== null && onChain.depositAddress !== ""
      ? onChain.depositAddress
      : null
    : isDemoEnabled
      ? DEMO_DEPOSIT_ADDRESS
      : null;

  const priceFloat = Number(price.priceMicro) / 1_000_000;
  const series = useMemo(
    () =>
      buildRangeSeries(
        `${range}:${interval}`,
        INTERVAL_POINTS[interval] ?? 64,
        priceFloat,
      ),
    [range, interval, priceFloat],
  );
  const hoverLabels = useMemo(
    () =>
      series.map((_, index) =>
        range === "1H" || range === "1D"
          ? `${String(Math.floor((index / series.length) * 24)).padStart(2, "0")}:00`
          : `p${index + 1}`,
      ),
    [series, range],
  );

  const deltaMicro = price.openMicro === 0n ? 0n : price.priceMicro - price.openMicro;
  const deltaColor = deltaMicro < 0n ? "var(--down)" : "var(--up)";
  const percentText = `(${formatDeltaBasisPoints(price.priceMicro, price.openMicro)})`;

  const hoveredValue = hoverIndex !== null ? series[hoverIndex] : null;
  const ohlc =
    hoveredValue !== null
      ? {
          o: (hoveredValue * 0.9974).toFixed(6),
          h: (hoveredValue * 1.0018).toFixed(6),
          l: (hoveredValue * 0.9951).toFixed(6),
          c: hoveredValue.toFixed(6),
        }
      : {
          o: formatPriceMicro(price.openMicro === 0n ? price.priceMicro : price.openMicro),
          h: formatPriceMicro(highRef.current === 0n ? price.priceMicro : highRef.current),
          l: formatPriceMicro(lowRef.current === 0n ? price.priceMicro : lowRef.current),
          c: formatPriceMicro(price.priceMicro),
        };

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
      const result = await submitReportRequest(mandateId, address, provider);
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
      const result = await submitCancel(mandateId, address, provider);
      if (!result.ok) {
        setActionFailure(result.reason);
        return;
      }
    }
    setCancelled(true);
  };

  const currentId = isLive ? mandateId : (mandate?.id ?? 6);
  const fillTint = ladderSide === "sell" ? "oa oa-sell num" : "oa oa-buy num";

  const orderPill = (
    text: string | null,
    tinted: boolean,
    maxWidth: number,
  ): ReactNode => (
    <span
      className={tinted ? fillTint : "oa oa-neutral num"}
      style={{ justifySelf: "end", width: "100%", maxWidth }}
    >
      {text === null ? (
        <span style={{ color: "var(--ink-3)" }}>--</span>
      ) : (
        text
      )}
      <span className="plus">
        <IconPlus />
      </span>
    </span>
  );

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav
        className={`rail rise${railOpen ? " open" : ""}`}
        aria-label="Your mandates"
      >
        <Link
          href="/app"
          aria-label="Kerb dashboard"
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
            flex: "none",
          }}
        >
          K
        </Link>
        <div style={{ width: 24, height: 1, background: "var(--hairline)", margin: "2px 0" }} />
        {(isDemoEnabled ? DEMO_MANDATES : []).map((entry) => (
          <Link
            key={entry.id}
            className="railchip num"
            href={`/app/m/${entry.id}`}
            title={`${kindLabel(entry.kind)} #${entry.id}`}
            aria-label={
              entry.id === currentId
                ? `${kindLabel(entry.kind)} #${entry.id}, current`
                : `${kindLabel(entry.kind)} #${entry.id}`
            }
            aria-current={entry.id === currentId ? "true" : undefined}
          >
            #{entry.id}
          </Link>
        ))}
      </nav>

      <main style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
        <div style={{ width: "100%", maxWidth: 1100, padding: "24px 24px 80px" }}>
          {hintOpen && isDemoEnabled ? (
            <div
              className="card rise"
              style={{
                marginBottom: 20,
                display: "flex",
                alignItems: "flex-start",
                gap: 16,
                padding: "14px 16px",
              }}
            >
              <span style={{ flex: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  This is one mandate&apos;s cockpit
                </span>
                <br />
                <span className="cap" style={{ fontSize: 13 }}>
                  Live FTSO price and chart on top, the Slices ladder shows how
                  execution is cut, proofs and history sit below. The left rail
                  (#7 to #2) jumps between your mandates.
                </span>
              </span>
              <button
                type="button"
                className="btn btn-compact"
                style={{ flex: "none" }}
                onClick={() => setHintOpen(false)}
              >
                Got it
              </button>
            </div>
          ) : null}
          <header className="rise" style={{ animationDelay: "30ms" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Link
                  href="/app"
                  className="btn-icon"
                  aria-label="Back to dashboard"
                >
                  <IconArrowLeft />
                </Link>
                <button
                  type="button"
                  className="btn-icon railbtn-hdr"
                  aria-label="Show mandate rail"
                  onClick={(event) => {
                    event.stopPropagation();
                    setRailOpen((open) => !open);
                  }}
                >
                  <IconRail />
                </button>
                <h1
                  style={{
                    fontSize: 24,
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    marginRight: 4,
                  }}
                >
                  {isLive
                    ? `Mandate #${currentId}`
                    : `${kindLabel(mandate?.kind ?? "stop")} #${currentId}`}
                </h1>
                <span className="chip chip-neutral">
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: dimmed ? "var(--ink-3)" : "var(--up)",
                      marginRight: 6,
                    }}
                  />
                  XRP/USD
                </span>
                {isLive ? (
                  <span className="chip chip-neutral">kind sealed</span>
                ) : null}
                <span className="chip chip-neutral">{status}</span>
                <Star ariaLabel="Watch this mandate" />
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  opacity: dimmed ? 0.45 : 1,
                  pointerEvents: dimmed ? "none" : undefined,
                }}
              >
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={reportRequested}
                  onClick={() => {
                    void requestReport();
                  }}
                >
                  {reportRequested ? "Report requested" : "Request report"}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    void cancelMandate();
                  }}
                >
                  Cancel mandate
                </button>
                <WalletCluster />
              </div>
            </div>

            {actionFailure !== null ? (
              <div
                className="card"
                style={{
                  marginTop: 12,
                  padding: "10px 16px",
                  border: "1px solid rgba(229,84,75,0.45)",
                }}
              >
                <span style={{ fontSize: 13, color: "var(--down)" }}>{actionFailure}</span>
              </div>
            ) : null}

            <div style={{ marginTop: 20, display: "flex", alignItems: "baseline", gap: 10 }}>
              <Ticker
                value={formatPriceMicro(price.priceMicro)}
                style={{
                  fontSize: 44,
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                  lineHeight: 1.1,
                }}
              />
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--ink-3)",
                  fontWeight: 500,
                  transform: "translateY(-4px)",
                }}
              >
                USD
              </span>
              <span className="vh" aria-live="polite">
                {formatPriceMicro(price.priceMicro)} USD, {percentText} today
              </span>
            </div>
            <div
              className="num"
              style={{
                marginTop: 6,
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                fontSize: 14,
                fontWeight: 600,
                color: deltaColor,
              }}
            >
              <Ticker value={formatSignedPriceMicro(deltaMicro)} />
              <Ticker value={percentText} />
              <span style={{ color: "var(--ink-3)", fontWeight: 400, fontSize: 12.5 }}>
                {price.isSimulated ? "simulated feed" : "live FTSOv2 feed"}
              </span>
            </div>
            <div className="num" style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5 }}>
              <span style={{ whiteSpace: "nowrap" }}>
                <span style={{ color: "var(--ink-3)" }}>O</span> {ohlc.o}
              </span>
              <span style={{ whiteSpace: "nowrap" }}>
                <span style={{ color: "var(--ink-3)" }}>H</span> {ohlc.h}
              </span>
              <span style={{ whiteSpace: "nowrap" }}>
                <span style={{ color: "var(--ink-3)" }}>L</span> {ohlc.l}
              </span>
              <span style={{ whiteSpace: "nowrap" }}>
                <span style={{ color: "var(--ink-3)" }}>C</span> {ohlc.c}
              </span>
            </div>
          </header>

          <section
            className="card rise"
            aria-label="Price chart"
            style={{ animationDelay: "90ms", marginTop: 40 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Tabs
                className="icontabs"
                ariaLabel="Chart style"
                tabs={[
                  {
                    id: "candles" as ChartStyle,
                    label: <IconCandles />,
                    ariaLabel: "Candles",
                  },
                  {
                    id: "line" as ChartStyle,
                    label: <IconLine />,
                    ariaLabel: "Line",
                  },
                ]}
                selected={chartStyle}
                onSelect={setChartStyle}
              />
              <Tabs
                className="num"
                ariaLabel="Chart range"
                tabs={RANGE_TABS.map((key) => ({ id: key, label: key }))}
                selected={range}
                onSelect={setRange}
              />
              <div style={{ flex: 1 }} />
              <Menu
                label={<span className="num">Interval: {interval}</span>}
                ariaLabel="Interval"
                items={[
                  { value: "1h", label: "1h" },
                  { value: "1d", label: "1d" },
                  { value: "1w", label: "1w" },
                ]}
                value={interval}
                onPick={setIntervalKey}
              />
              <button
                type="button"
                className="btn-icon"
                aria-label="Fullscreen chart"
                aria-pressed={tallChart}
                onClick={() => setTallChart((tall) => !tall)}
              >
                <IconFullscreen />
              </button>
            </div>
            <div style={{ marginTop: 16, position: "relative" }}>
              <HalftoneChart
                series={series}
                swapKey={`${range}:${interval}:${chartStyle}`}
                className="chartsvg"
                heightPx={tallChart ? 400 : 248}
                variant={chartStyle}
                hoverLabels={hoverLabels}
                onHoverPoint={setHoverIndex}
              />
            </div>
          </section>

          <section
            className="card rise"
            aria-label="Slice ladder"
            style={{ animationDelay: "120ms", marginTop: 40, padding: 8 }}
          >
            <button
              type="button"
              className="secthead"
              aria-expanded={ladderOpen}
              aria-controls="ladder-region"
              onClick={() => setLadderOpen((open) => !open)}
            >
              <span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>Slices</span>
                <br />
                <span className="cap">
                  {isLive
                    ? "sizes sealed until they fill"
                    : "5 slices, sorted high to low"}
                </span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                  <Ticker
                    value={
                      isLive
                        ? formatXrpCents(filledCents)
                        : `${formatXrpCents(filledCents)} / ${formatXrpCents(totalCents)}`
                    }
                    style={{ fontWeight: 600 }}
                  />
                  <span className="cap">XRP</span>
                </span>
                <span className="chevring">
                  <IconChevronDown />
                </span>
              </span>
            </button>
            <Fold open={ladderOpen}>
              <div id="ladder-region" role="region" aria-label="Slice ladder rows">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    padding: "4px 8px 12px",
                  }}
                >
                  <Tabs
                    className="big"
                    ariaLabel="Side"
                    tabs={[
                      { id: "sell" as const, label: "Sell" },
                      { id: "buy" as const, label: "Buy" },
                    ]}
                    selected={ladderSide}
                    onSelect={setLadderSide}
                    pillStyle={{
                      background:
                        ladderSide === "sell"
                          ? "rgba(229,84,75,0.16)"
                          : "rgba(55,188,101,0.16)",
                    }}
                  />
                  <div style={{ flex: 1 }} />
                  <Menu
                    label={<span className="num">Expiry: {expiry}</span>}
                    ariaLabel="Expiry"
                    items={[
                      { value: "Sep 8 (28d)", label: "Sep 8 (28d)" },
                      { value: "Sep 22 (42d)", label: "Sep 22 (42d)" },
                      { value: "Oct 6 (56d)", label: "Oct 6 (56d)" },
                    ]}
                    value={expiry}
                    onPick={setExpiry}
                  />
                </div>
                {!showDemoData ? (
                  <p className="cap" style={{ padding: "4px 12px 8px", fontSize: 13 }}>
                    Slice sizes stay sealed in live mode. Per-slice fills live
                    on XRPL: open the deposit account on the testnet explorer
                    to audit every OfferCreate.
                  </p>
                ) : (
                  <>
                    <div
                      className="lhead num"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 160px 170px",
                        gap: 12,
                        padding: "8px 12px",
                        borderBottom: "1px solid var(--hairline-strong)",
                        fontSize: 12.5,
                        color: "var(--ink-3)",
                      }}
                    >
                      <span>
                        Slice <span style={{ fontSize: 11 }}>sorted high to low</span>
                      </span>
                      <span style={{ textAlign: "right" }}>Amount (XRP)</span>
                      <span style={{ textAlign: "right" }}>Fill (USD)</span>
                    </div>
                    <div style={{ paddingTop: 4 }}>
                      {LADDER_TOP.map((row) => (
                        <div
                          key={row.slice}
                          className="lr"
                          style={
                            row.pending
                              ? {
                                  borderBottom: "1px dashed var(--hairline-strong)",
                                  borderRadius: "10px 10px 0 0",
                                }
                              : undefined
                          }
                        >
                          <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>
                            {row.slice}
                          </span>
                          {orderPill(row.amount, false, 150)}
                          {orderPill(row.fill, true, 160)}
                        </div>
                      ))}
                      <div
                        className="num"
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 12px",
                          margin: "4px 0",
                          borderTop: "1px solid var(--hairline-strong)",
                          borderBottom: "1px solid var(--hairline-strong)",
                        }}
                      >
                        <span className="cap" style={{ whiteSpace: "nowrap" }}>
                          FTSO live
                        </span>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 10,
                            fontWeight: 600,
                            fontSize: 13,
                          }}
                        >
                          <Ticker value={formatPriceMicro(price.priceMicro)} />
                          <Ticker value={percentText} style={{ color: deltaColor }} />
                          <span className="chip chip-up">
                            {executing ? "armed" : status.toLowerCase()}
                          </span>
                        </span>
                      </div>
                      {LADDER_BOTTOM.map((row) => (
                        <div key={row.slice} className="lr">
                          <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>
                            {row.slice}
                          </span>
                          {orderPill(row.amount, false, 150)}
                          {orderPill(row.fill, true, 160)}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Fold>
          </section>

          <section
            className="card rise"
            aria-label="Sealed strategy"
            style={{ animationDelay: "150ms", marginTop: 40 }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Sealed strategy</h2>
            <p className="cap" style={{ marginTop: 4 }}>
              Encrypted inside the TEE. The operator, the chain and this UI
              cannot read it.
            </p>
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span className="cap" style={{ width: 64 }}>
                  Trigger
                </span>
                <SealedBar widthPx={180} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span className="cap" style={{ width: 64 }}>
                  Slices
                </span>
                <SealedBar widthPx={120} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span className="cap" style={{ width: 64 }}>
                  Jitter
                </span>
                <SealedBar widthPx={90} />
              </div>
            </div>
            <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <span className="cap">Deposit</span>
                <ProofSeal
                  state={executing || settled ? "ok" : "pending"}
                  animated={executing || settled}
                />
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <span className="cap">Settlement</span>
                <ProofSeal state={settled ? "ok" : "pending"} animated={settled} />
              </span>
            </div>
          </section>

          {awaitingDeposit || isLive ? (
            <section
              className="card rise"
              aria-label="Deposit"
              style={{ animationDelay: "165ms", marginTop: 40 }}
            >
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Deposit</h2>
              <div style={{ height: 1, background: "var(--hairline)", margin: "12px 0 14px" }} />
              {depositAddress === null ? (
                <p className="cap" style={{ fontSize: 13 }}>
                  The enclave-derived address appears once provisioning is
                  relayed on-chain. Do not send funds before it does.
                </p>
              ) : (
                <>
                  <div className="well" style={{ height: "auto", padding: "10px 14px", gap: 12 }}>
                    <span className="num" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                      {depositAddress}
                    </span>
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label="Copy deposit address"
                      style={{ width: 32, height: 32 }}
                      onClick={copyDepositAddress}
                    >
                      {copied ? (
                        <span style={{ color: "var(--up)", display: "inline-flex" }}>
                          <IconCheck />
                        </span>
                      ) : (
                        <IconCopy />
                      )}
                    </button>
                  </div>
                  <div className="cap num" style={{ marginTop: 8 }}>
                    Tag: {currentId}, required
                  </div>
                  <p className="cap" style={{ marginTop: 6, fontSize: 13 }}>
                    Fund from any XRPL wallet. The deposit is proven on-chain
                    by FDC.
                  </p>
                </>
              )}
            </section>
          ) : null}

          <section
            className="rise"
            aria-label="Mandate facts"
            style={{ animationDelay: "180ms", marginTop: 40 }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
              Mandate facts
            </h2>
            <div
              className="facts"
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 48 }}
            >
              {factRow(
                "Status",
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: dimmed
                      ? "var(--ink-3)"
                      : executing
                        ? "var(--up)"
                        : "var(--ink)",
                  }}
                >
                  {status}
                </span>,
              )}
              {factRow(
                "Side",
                isLive ? (
                  <SealedBar widthPx={44} />
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {(mandate?.side ?? "Sell").toLowerCase()}
                  </span>
                ),
              )}
              {factRow(
                "Kind",
                isLive ? (
                  <SealedBar widthPx={52} />
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {mandate?.kind ?? "stop"}
                  </span>
                ),
              )}
              {factRow("Trigger", <SealedBar widthPx={110} />)}
              {factRow(
                "Fills so far",
                <span className="num" style={{ fontSize: 14, fontWeight: 600 }}>
                  {formatXrpCents(filledCents)} XRP
                </span>,
              )}
              {factRow(
                "Mandate",
                <span className="num" style={{ fontSize: 14, fontWeight: 600 }}>
                  #{currentId}
                </span>,
              )}
              {factRow(
                "Wallet",
                <span className="num" style={{ fontSize: 14, fontWeight: 600 }}>
                  {address === null ? "not connected" : truncateMiddle(address, 6, 4)}
                </span>,
              )}
              {depositAddress !== null
                ? factRow(
                    "Deposit",
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        minWidth: 0,
                      }}
                    >
                      <span
                        className="num"
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {depositAddress} (tag {currentId})
                      </span>
                      <button
                        type="button"
                        className="btn-icon"
                        aria-label="Copy deposit address"
                        style={{ width: 32, height: 32 }}
                        onClick={copyDepositAddress}
                      >
                        {copied ? (
                          <span style={{ color: "var(--up)", display: "inline-flex" }}>
                            <IconCheck />
                          </span>
                        ) : (
                          <IconCopy />
                        )}
                      </button>
                    </span>,
                    true,
                  )
                : null}
            </div>
          </section>

          <section
            className="rise"
            aria-label="Activity"
            style={{ animationDelay: "210ms", marginTop: 40 }}
          >
            <Tabs
              className="big"
              ariaLabel="Activity tabs"
              tabs={[
                { id: "pending" as PaneKey, label: "Pending" },
                { id: "fills" as PaneKey, label: "Fills" },
                { id: "history" as PaneKey, label: "History" },
              ]}
              selected={pane}
              onSelect={setPane}
            />
            <div
              key={pane}
              className="card chartswap"
              style={{ marginTop: 16, padding: 8, overflow: "hidden" }}
            >
              {pane === "pending" ? (
                !executing || !showDemoData ? (
                  <div className="brow">
                    <span className="cap" style={{ fontSize: 13 }}>
                      {isLive
                        ? "Pending slices stay sealed until they fill."
                        : "No pending slices. Everything is filled or settled."}
                    </span>
                    <span />
                    <span />
                  </div>
                ) : (
                  <div
                    className="brow"
                    style={{
                      borderBottom: "1px dashed var(--hairline-strong)",
                      borderRadius: "10px 10px 0 0",
                    }}
                  >
                    <span>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>Slice #5</span>
                      <br />
                      <span className="cap">waiting for trigger</span>
                    </span>
                    <span className="num" style={{ fontWeight: 600 }}>
                      110.00{" "}
                      <span className="cap" style={{ fontWeight: 400 }}>
                        XRP
                      </span>
                    </span>
                    <ProofSeal state="pending" />
                  </div>
                )
              ) : null}
              {pane === "fills" ? (
                !showDemoData ? (
                  <div className="brow">
                    <span className="cap" style={{ fontSize: 13 }}>
                      Per-slice fills live on XRPL: open the deposit account on
                      the testnet explorer to audit every OfferCreate.
                    </span>
                    <span />
                    <span />
                  </div>
                ) : !executing && !dimmed ? (
                  <div className="brow">
                    <span className="cap" style={{ fontSize: 13 }}>
                      No fills yet. Waiting for the trigger.
                    </span>
                    <span />
                    <span />
                  </div>
                ) : (
                  DEMO_FILLS.map(([slice, amount, fill, when]) => (
                    <div key={slice} className="brow">
                      <span>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{slice}</span>
                        <br />
                        <span className="cap num">
                          {amount} to {fill}
                        </span>
                      </span>
                      <span className="cap num" style={{ whiteSpace: "nowrap" }}>
                        {when}
                      </span>
                      <ProofSeal state="ok" />
                    </div>
                  ))
                )
              ) : null}
              {pane === "history"
                ? timeline.map((event) => (
                    <div
                      key={event.word}
                      className="brow"
                      style={{ color: event.done ? "var(--ink)" : "var(--ink-3)" }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{event.word}</span>
                      <span className="cap num" style={{ whiteSpace: "nowrap" }}>
                        {event.timestamp}
                      </span>
                      <span>
                        {event.proven ? <ProofSeal state="ok" animated /> : null}
                      </span>
                    </div>
                  ))
                : null}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
