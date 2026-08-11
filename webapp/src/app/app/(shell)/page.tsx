"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { WalletCluster } from "@/components/kerb/AppShell";
import { ProofSeal } from "@/components/kerb/ProofSeal";
import { Fold } from "@/components/kerb/ui/Fold";
import { HalftoneChart } from "@/components/kerb/ui/HalftoneChart";
import { Menu } from "@/components/kerb/ui/Menu";
import { Tabs } from "@/components/kerb/ui/Tabs";
import { Ticker } from "@/components/kerb/ui/Ticker";
import {
  IconArrowRight,
  IconChevronDown,
  IconClose,
  IconEye,
  IconEyeOff,
  IconOpen,
  IconSearch,
} from "@/components/kerb/ui/icons";
import { useWallet } from "@/components/kerb/WalletProvider";
import { buildRangeSeries } from "@/lib/chartSeries";
import {
  DEMO_MANDATES,
  type DemoMandate,
  type MandateStatusWord,
} from "@/lib/demo";
import { formatDeltaBasisPoints, formatXrpCents } from "@/lib/format";
import { useLivePrice } from "@/lib/useLivePrice";

const RANGE_TABS = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "ALL"] as const;
type RangeKey = (typeof RANGE_TABS)[number];
type ModeKey = "value" | "pnl";
type SortKey = "By status" | "By kind" | "By date";

const ACTIVE_WORDS: readonly MandateStatusWord[] = [
  "Created",
  "Provisioned",
  "Funded",
  "Executing",
];

interface Suggestion {
  readonly title: string;
  readonly chip: string;
  readonly caption: string;
}

const SUGGESTIONS: readonly Suggestion[] = [
  {
    title: "Stop-loss",
    chip: "Protect the downside",
    caption: "Sell automatically if FTSO drops below your line.",
  },
  {
    title: "DCA",
    chip: "Average in quietly",
    caption: "Buy a slice on a schedule with jitter.",
  },
  {
    title: "Limit",
    chip: "Name your price",
    caption: "Sell only at your target or better.",
  },
];

interface PaperNote {
  readonly title: string;
  readonly body: string;
}

const PAPER_NOTES: readonly PaperNote[] = [
  {
    title: "Your exit plan, sealed.",
    body: "The strategy is encrypted inside a TEE. The operator, the chain and this UI cannot read it.",
  },
  {
    title: "Proofs, not promises.",
    body: "Deposits and settlements are verified by the Flare Data Connector before value moves.",
  },
];

function isActive(status: MandateStatusWord): boolean {
  return ACTIVE_WORDS.includes(status);
}

function rowCaption(row: DemoMandate): string {
  switch (row.status) {
    case "Created":
      return "Created, waiting for deposit";
    case "Funded":
      return "Funded, ready";
    default:
      return row.status;
  }
}

function sortRows(rows: readonly DemoMandate[], sort: SortKey): DemoMandate[] {
  const copy = [...rows];
  if (sort === "By kind") {
    copy.sort((a, b) => a.kind.localeCompare(b.kind) || b.id - a.id);
  } else if (sort === "By date") {
    copy.sort((a, b) => b.id - a.id);
  }
  return copy;
}

export default function DashboardPage() {
  const router = useRouter();
  const { address, connect } = useWallet();
  const price = useLivePrice(true);
  const [cancelledIds, setCancelledIds] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [masked, setMasked] = useState(false);
  const [range, setRange] = useState<RangeKey>("1D");
  const [mode, setMode] = useState<ModeKey>("value");
  const [sort, setSort] = useState<SortKey>("By status");
  const [activeOpen, setActiveOpen] = useState(true);
  const [doneOpen, setDoneOpen] = useState(true);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [noteIndex, setNoteIndex] = useState(0);
  const [hiddenNotes, setHiddenNotes] = useState<ReadonlySet<string>>(new Set());
  const [greeting, setGreeting] = useState("Good day");
  const dayRowRef = useRef<HTMLDivElement>(null);

  // The greeting depends on the viewer's clock, which the server cannot know.
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(
      hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening",
    );
  }, []);

  const connected = address !== null;
  const rows = DEMO_MANDATES.map((mandate) =>
    cancelledIds.has(mandate.id)
      ? { ...mandate, status: "Cancelled" as const, cancellable: false }
      : mandate,
  );
  const activeRows = sortRows(rows.filter((row) => isActive(row.status)), sort);
  const doneRows = sortRows(rows.filter((row) => !isActive(row.status)), sort);

  const protectedCents = activeRows.reduce(
    (sum, row) => sum + row.totalCents,
    0n,
  );
  const basisPoints =
    price.openMicro === 0n
      ? 0n
      : ((price.priceMicro - price.openMicro) * 10_000n) / price.openMicro;
  const deltaCents =
    (protectedCents * (basisPoints < 0n ? -basisPoints : basisPoints)) / 10_000n;
  const deltaSign = basisPoints < 0n ? "-" : "+";
  const deltaColor = basisPoints < 0n ? "var(--down)" : "var(--up)";
  const percentText = `(${formatDeltaBasisPoints(price.priceMicro, price.openMicro)})`;

  const chartSeries = useMemo(
    () => buildRangeSeries(`${range}:${mode}`, 64, 1),
    [range, mode],
  );

  const markCancelled = (mandateId: number): void => {
    setCancelledIds((current) => new Set(current).add(mandateId));
  };

  const visibleNotes = PAPER_NOTES.filter((note) => !hiddenNotes.has(note.title));
  const clampedNote = Math.min(noteIndex, Math.max(0, visibleNotes.length - 1));

  const executingRow = rows.find((row) => row.status === "Executing");

  return (
    <div>
      <header
        className="rise"
        style={{
          animationDelay: "30ms",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
            {greeting}
          </h1>
          <span className="chip chip-neutral">Testnet</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {connected ? (
            <Menu
              label={
                <>
                  <span className="kchip">K</span>New mandate
                </>
              }
              buttonClassName="btn btn-paper"
              ariaLabel="New mandate kind"
              items={[
                { value: "stop", label: "Stop-loss" },
                { value: "limit", label: "Limit" },
                { value: "dca", label: "DCA" },
              ]}
              onPick={() => router.push("/app/new")}
            />
          ) : null}
          {connected ? (
            <Link href="/app/m/7" className="btn btn-quiet hact">
              Deposit
            </Link>
          ) : null}
          <WalletCluster />
        </div>
      </header>

      {!connected ? (
        <div
          className="card rise"
          style={{ marginTop: 40, textAlign: "center", padding: 40 }}
        >
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            Connect a wallet to see your mandates
          </div>
          <p className="cap" style={{ marginTop: 4 }}>
            Installed wallets are detected; the demo identity walks every flow
            on sample data.
          </p>
          <button
            type="button"
            className="btn btn-paper"
            style={{ marginTop: 16 }}
            onClick={() => {
              void connect();
            }}
          >
            <span className="kchip">K</span>Connect wallet
          </button>
        </div>
      ) : (
        <>
          <section
            className="rise"
            style={{ animationDelay: "60ms", marginTop: 40 }}
            aria-label="Protected value"
          >
            <p className="cap">Protected value</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
              <Ticker
                value={formatXrpCents(protectedCents)}
                masked={masked}
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
                XRP
              </span>
              <button
                type="button"
                className="btn-icon"
                aria-label={masked ? "Show balances" : "Hide balances"}
                aria-pressed={masked}
                style={{ alignSelf: "center" }}
                onClick={() => setMasked((current) => !current)}
              >
                {masked ? <IconEyeOff /> : <IconEye />}
              </button>
              <span className="vh" aria-live="polite">
                {formatXrpCents(protectedCents)} XRP, {percentText} in the last day
              </span>
            </div>
            <Link
              href="/app/m/6"
              className="alink num"
              style={{ marginTop: 6, fontSize: 14, fontWeight: 600, color: deltaColor }}
            >
              <Ticker
                value={`${deltaSign}${formatXrpCents(deltaCents)}`}
                masked={masked}
              />
              <Ticker value={percentText} />
              <span style={{ color: "var(--ink-3)", fontWeight: 400, fontSize: 12.5 }}>
                in the last day
              </span>
              <span className="arr" aria-hidden>
                <IconArrowRight />
              </span>
            </Link>
          </section>

          <section
            className="card rise"
            style={{ animationDelay: "90ms", marginTop: 24 }}
            aria-label="Value chart"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Tabs
                className="num"
                ariaLabel="Range"
                tabs={RANGE_TABS.map((key) => ({ id: key, label: key }))}
                selected={range}
                onSelect={setRange}
              />
              <div style={{ flex: 1 }} />
              <Tabs
                ariaLabel="Mode"
                tabs={[
                  { id: "value" as ModeKey, label: "Value" },
                  { id: "pnl" as ModeKey, label: "P&L" },
                ]}
                selected={mode}
                onSelect={setMode}
              />
            </div>
            <div style={{ marginTop: 16 }}>
              <HalftoneChart
                series={chartSeries}
                swapKey={`${range}:${mode}`}
                className="chartsvg"
              />
            </div>
          </section>

          <div
            className="insights rise"
            style={{
              animationDelay: "120ms",
              marginTop: 24,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
            }}
          >
            <div className="card c1">
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span id="execTitle">Executing now</span>
                <span className="arr" aria-hidden>
                  <IconArrowRight />
                </span>
              </div>
              <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
                <Ticker
                  value={
                    executingRow === undefined
                      ? "--"
                      : `${formatXrpCents(executingRow.filledCents)} / ${formatXrpCents(executingRow.totalCents)}`
                  }
                  masked={masked}
                  style={{ fontSize: 18, fontWeight: 600 }}
                />
                <span className="cap" style={{ fontWeight: 500 }}>
                  XRP
                </span>
              </div>
              <p className="cap" style={{ marginTop: 4 }}>
                {executingRow === undefined
                  ? "Nothing is executing right now"
                  : `Stop-loss #${executingRow.id} is filling in slices`}
              </p>
              <Link
                href={`/app/m/${executingRow?.id ?? 6}`}
                aria-labelledby="execTitle"
                style={{ position: "absolute", inset: 0, borderRadius: 16 }}
              />
            </div>
            <div className="card c1">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>Fees saved</div>
                  <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
                    <Ticker
                      value="12.40"
                      masked={masked}
                      style={{ fontSize: 18, fontWeight: 600 }}
                    />
                    <span className="cap" style={{ fontWeight: 500 }}>
                      XRP
                    </span>
                  </div>
                  <p className="cap" style={{ marginTop: 4 }}>
                    this month
                  </p>
                </div>
                <svg
                  width="224"
                  height="44"
                  viewBox="0 0 224 44"
                  style={{ flex: "none", maxWidth: "45%" }}
                  aria-hidden
                >
                  <defs>
                    <linearGradient id="sparkA" x1="0%" x2="0%" y1="0%" y2="100%">
                      <stop stopColor="#5b88d9" stopOpacity="0.376" />
                      <stop offset="85%" stopColor="#5b88d9" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    fill="url(#sparkA)"
                    strokeWidth={0}
                    d="M0,36 L28,30 L56,33 L84,24 L112,27 L140,18 L168,21 L196,12 L224,8 L224,44 L0,44 Z"
                  />
                  <path
                    stroke="#5b88d9"
                    strokeWidth={1.5}
                    fill="transparent"
                    d="M0,36 L28,30 L56,33 L84,24 L112,27 L140,18 L168,21 L196,12 L224,8"
                  />
                </svg>
              </div>
            </div>
          </div>

          <section className="rise" style={{ animationDelay: "150ms", marginTop: 48 }} aria-label="Mandates">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Mandates</h2>
              <Menu
                label={<span>{sort}</span>}
                ariaLabel="Sort mandates"
                items={[
                  { value: "By status", label: "By status" },
                  { value: "By kind", label: "By kind" },
                  { value: "By date", label: "By date" },
                ]}
                value={sort}
                onPick={(value) => setSort(value as SortKey)}
              />
            </div>
            {rows.length === 0 ? (
              <div className="card" style={{ marginTop: 12, textAlign: "center", padding: 40 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>No mandates yet</div>
                <p className="cap" style={{ marginTop: 4 }}>
                  Seal your first strategy to see it here.
                </p>
                <Link
                  href="/app/new"
                  style={{
                    marginTop: 16,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    height: 40,
                    padding: "0 14px",
                    background: "var(--well)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 12,
                    color: "var(--ink-3)",
                    fontSize: 14,
                  }}
                >
                  <IconSearch size={16} />
                  Search a pair or kind
                </Link>
              </div>
            ) : (
              <div className="card" style={{ marginTop: 12, padding: 8 }}>
                <button
                  type="button"
                  className="secthead"
                  aria-expanded={activeOpen}
                  onClick={() => setActiveOpen((open) => !open)}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>Active</span>
                    <span className="chip chip-neutral num">{activeRows.length}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                      <Ticker
                        value={formatXrpCents(protectedCents)}
                        masked={masked}
                        style={{ fontWeight: 600 }}
                      />
                      <span className="cap">XRP</span>
                    </span>
                    <IconChevronDown />
                  </span>
                </button>
                <Fold open={activeOpen}>
                  {activeRows.map((row) => (
                    <div
                      key={row.id}
                      className="lrow"
                      role="link"
                      tabIndex={0}
                      style={
                        row.status === "Created"
                          ? {
                              borderBottom: "1px dashed var(--hairline-strong)",
                              borderRadius: "10px 10px 0 0",
                              cursor: "pointer",
                            }
                          : { cursor: "pointer" }
                      }
                      onClick={() => router.push(`/app/m/${row.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`/app/m/${row.id}`);
                        }
                      }}
                    >
                      <span>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>
                          {row.kind === "DCA" ? "DCA" : row.kind === "limit" ? "Limit" : "Stop-loss"} #{row.id}
                        </span>{" "}
                        {row.status === "Executing" ? (
                          <span className="chip chip-up">armed</span>
                        ) : null}
                        <br />
                        <span className="cap">{rowCaption(row)}</span>
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                        {row.status === "Created" ? (
                          <span className="num" style={{ color: "var(--ink-3)", fontWeight: 600 }}>
                            --
                          </span>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                            <Ticker
                              value={
                                row.status === "Executing"
                                  ? `${formatXrpCents(row.filledCents)} / ${formatXrpCents(row.totalCents)}`
                                  : formatXrpCents(row.totalCents)
                              }
                              masked={masked}
                              style={{ fontWeight: 600 }}
                            />
                            <span className="cap">XRP</span>
                          </span>
                        )}
                        {row.cancellable ? (
                          <button
                            type="button"
                            className="btn btn-compact"
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
                  ))}
                </Fold>
                <button
                  type="button"
                  className="secthead"
                  aria-expanded={doneOpen}
                  style={{ borderTop: "1px solid var(--hairline)", borderRadius: 0 }}
                  onClick={() => setDoneOpen((open) => !open)}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>Done</span>
                    <span className="chip chip-neutral num">{doneRows.length}</span>
                  </span>
                  <IconChevronDown />
                </button>
                <Fold open={doneOpen}>
                  {doneRows.map((row) => (
                    <div
                      key={row.id}
                      className="lrow"
                      role="link"
                      tabIndex={0}
                      style={{
                        cursor: "pointer",
                        opacity:
                          row.status === "Cancelled" || row.status === "Expired"
                            ? 0.55
                            : 1,
                      }}
                      onClick={() => router.push(`/app/m/${row.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`/app/m/${row.id}`);
                        }
                      }}
                    >
                      <span>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>
                          {row.kind === "DCA" ? "DCA" : row.kind === "limit" ? "Limit" : "Stop"} #{row.id}
                        </span>
                        <br />
                        <span className="cap">{row.status}</span>
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                        {row.status === "Settled" ? (
                          <ProofSeal label="verified" />
                        ) : null}
                        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                          <Ticker
                            value={formatXrpCents(row.filledCents)}
                            masked={masked}
                            style={{ fontWeight: 600 }}
                          />
                          <span className="cap">XRP</span>
                        </span>
                      </span>
                    </div>
                  ))}
                </Fold>
              </div>
            )}
          </section>

          <section
            className="rise"
            style={{ animationDelay: "180ms", marginTop: 48 }}
            aria-label="Suggested automations"
          >
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Suggested automations</h2>
            <div className="card" style={{ marginTop: 12, padding: 8 }}>
              {SUGGESTIONS.map((suggestion) => (
                <Fold key={suggestion.title} open={!dismissed.has(suggestion.title)}>
                  <div className="lrow">
                    <span>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{suggestion.title}</span>{" "}
                      <span className="chip chip-up">{suggestion.chip}</span>
                      <br />
                      <span className="cap">{suggestion.caption}</span>
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: "none" }}>
                      <Link className="btn btn-compact" href="/app/new">
                        Create
                      </Link>
                      <button
                        type="button"
                        className="btn-icon"
                        aria-label={`Dismiss ${suggestion.title} suggestion`}
                        onClick={() =>
                          setDismissed((current) =>
                            new Set(current).add(suggestion.title),
                          )
                        }
                      >
                        <IconClose />
                      </button>
                    </span>
                  </div>
                </Fold>
              ))}
            </div>
          </section>

          {visibleNotes.length > 0 ? (
            <section
              className="rise"
              style={{ animationDelay: "210ms", marginTop: 48 }}
              aria-label="Kerb notes"
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <span key={`${clampedNote}-${visibleNotes.length}`} className="cap num tkflash">
                  {clampedNote + 1} of {visibleNotes.length}
                </span>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="Previous card"
                  disabled={clampedNote <= 0}
                  onClick={() => setNoteIndex((index) => Math.max(0, index - 1))}
                >
                  <span style={{ transform: "rotate(90deg)", display: "inline-flex" }}>
                    <IconChevronDown />
                  </span>
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="Next card"
                  disabled={clampedNote >= visibleNotes.length - 1}
                  onClick={() =>
                    setNoteIndex((index) =>
                      Math.min(visibleNotes.length - 1, index + 1),
                    )
                  }
                >
                  <span style={{ transform: "rotate(-90deg)", display: "inline-flex" }}>
                    <IconChevronDown />
                  </span>
                </button>
              </div>
              <div style={{ overflow: "hidden", borderRadius: 20 }}>
                <div
                  style={{
                    display: "flex",
                    transition: "transform 350ms var(--ease)",
                    transform: `translateX(-${clampedNote * 100}%)`,
                  }}
                >
                  {visibleNotes.map((note) => (
                    <div key={note.title} style={{ flex: "0 0 100%" }}>
                      <div className="papercard">
                        <div style={{ position: "absolute", top: 14, right: 14, display: "flex", gap: 4 }}>
                          <Link
                            href="/"
                            className="btn-icon pic"
                            aria-label="Open the landing page"
                            style={{ width: 32, height: 32 }}
                          >
                            <IconOpen />
                          </Link>
                          <button
                            type="button"
                            className="btn-icon pic"
                            aria-label="Dismiss card"
                            style={{ width: 32, height: 32 }}
                            onClick={() => {
                              setHiddenNotes((current) =>
                                new Set(current).add(note.title),
                              );
                              setNoteIndex(0);
                            }}
                          >
                            <IconClose />
                          </button>
                        </div>
                        <b style={{ fontWeight: 600, fontSize: 15 }}>{note.title}</b>
                        <p style={{ maxWidth: 520 }}>{note.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <section
            className="rise"
            style={{ animationDelay: "240ms", marginTop: 48 }}
            aria-label="Upcoming expiries"
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Upcoming expiries</h2>
              <span style={{ display: "inline-flex", gap: 4 }}>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="Scroll expiries left"
                  onClick={() =>
                    dayRowRef.current?.scrollBy({ left: -180, behavior: "smooth" })
                  }
                >
                  <span style={{ transform: "rotate(90deg)", display: "inline-flex" }}>
                    <IconChevronDown />
                  </span>
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="Scroll expiries right"
                  onClick={() =>
                    dayRowRef.current?.scrollBy({ left: 180, behavior: "smooth" })
                  }
                >
                  <span style={{ transform: "rotate(-90deg)", display: "inline-flex" }}>
                    <IconChevronDown />
                  </span>
                </button>
              </span>
            </div>
            <div ref={dayRowRef} className="dayrow" style={{ marginTop: 12 }}>
              {[
                { day: "12", label: "Today", logos: ["X", "U"], href: "/app/m/6" },
                { day: "13", label: "Wed", logos: ["X"], href: "/app/m/5" },
                { day: "14", label: "Thu", logos: ["X"], href: "/app/m/4" },
                { day: "15", label: "Fri", logos: [], href: null },
              ].map((card) => (
                <div key={card.day} className="daycard">
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span className="num" id={`day${card.day}`} style={{ fontSize: 18, fontWeight: 600 }}>
                      {card.day}
                    </span>
                    <span className="cap">{card.label}</span>
                  </div>
                  {card.logos.length > 0 ? (
                    <div style={{ marginTop: 14, display: "flex" }}>
                      {card.logos.map((letter, index) => (
                        <span
                          key={letter}
                          className="logo24"
                          style={
                            index > 0
                              ? { marginLeft: -6 }
                              : { position: "relative", zIndex: 1 }
                          }
                        >
                          {letter}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="cap num" style={{ marginTop: 14 }}>
                      --
                    </div>
                  )}
                  {card.href !== null ? (
                    <Link
                      href={card.href}
                      aria-labelledby={`day${card.day}`}
                      style={{ position: "absolute", inset: 0, borderRadius: 16 }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
