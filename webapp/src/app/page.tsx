"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Ticker } from "@/components/kerb/ui/Ticker";
import { HalftoneChart } from "@/components/kerb/ui/HalftoneChart";
import {
  IconLock,
  IconShield,
  IconSlices,
} from "@/components/kerb/ui/icons";
import { buildRangeSeries } from "@/lib/chartSeries";
import {
  formatDeltaBasisPoints,
  formatPriceMicro,
  formatSignedPriceMicro,
} from "@/lib/format";
import { useLivePrice } from "@/lib/useLivePrice";

const HOW_IT_WORKS: ReadonlyArray<readonly [string, string, string]> = [
  ["01", "Write", "Pick side, kind, trigger and slices for XRP/USD."],
  ["02", "Seal", "The strategy is encrypted; only the TEE can open it."],
  ["03", "Fund", "Send XRP to the deposit address; FDC proves it landed."],
  ["04", "Let it work", "Triggers fire on FTSO prices; fills settle with proofs."],
];

const SLICE_CHIPS = ["98.20", "105.44", "87.61", "110.00", "96.75"] as const;

export default function LandingPage() {
  const price = useLivePrice(true);
  const [series, setSeries] = useState<readonly number[]>(() =>
    buildRangeSeries("landing", 8, 2.847391),
  );
  const tickCountRef = useRef(0);
  const [settlementVerified, setSettlementVerified] = useState(false);

  // Every third live reading rolls a new tail point into the demo chart.
  useEffect(() => {
    if (price.openMicro === 0n) {
      return;
    }
    tickCountRef.current += 1;
    if (tickCountRef.current % 3 !== 0) {
      return;
    }
    const value = Number(price.priceMicro) / 1_000_000;
    setSeries((current) => {
      const next = [...current, value];
      return next.length > 8 ? next.slice(next.length - 8) : next;
    });
  }, [price.priceMicro, price.openMicro]);

  const deltaMicro = price.openMicro === 0n ? 0n : price.priceMicro - price.openMicro;
  const deltaColor = deltaMicro < 0n ? "var(--down)" : "var(--up)";
  const percentText = `(${formatDeltaBasisPoints(price.priceMicro, price.openMicro)})`;

  return (
    <div style={{ minHeight: "100vh" }}>
      <header
        className="rise"
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, marginRight: 8 }}>
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              background: "var(--card)",
              border: "1px solid var(--hairline)",
              color: "var(--ink)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            K
          </span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Kerb</span>
        </span>
        <nav style={{ display: "flex", alignItems: "center", gap: 2 }} aria-label="Site">
          <a className="navlink" href="#how">
            How it works
          </a>
          <a
            className="navlink"
            href="https://dev.flare.network"
            target="_blank"
            rel="noreferrer"
          >
            Docs
          </a>
        </nav>
        <div style={{ flex: 1 }} />
        <Link className="btn btn-quiet" href="/app">
          Open app
        </Link>
      </header>

      <main>
        <section style={{ maxWidth: 780, margin: "0 auto", padding: "72px 24px 0", textAlign: "center" }}>
          <div className="rise" style={{ animationDelay: "30ms" }}>
            <span className="chip chip-neutral">Non-custodial | XRPL DEX | Flare TEE</span>
          </div>
          <h1 className="hero-h rise" style={{ animationDelay: "60ms", marginTop: 20 }}>
            Your exit plan, sealed.
          </h1>
          <p
            className="rise"
            style={{
              animationDelay: "90ms",
              fontSize: 16,
              color: "var(--ink-2)",
              margin: "16px auto 0",
              maxWidth: 620,
              textWrap: "pretty",
            }}
          >
            Kerb runs your stop-loss, limit and DCA on the XRPL DEX from inside
            a TEE. Nobody can front-run what nobody can read.
          </p>
          <div className="ctas rise" style={{ animationDelay: "120ms", marginTop: 28 }}>
            <Link className="btn btn-paper" href="/app/new">
              <span className="kchip">K</span>Start a mandate
            </Link>
            <a className="btn btn-quiet" href="#how">
              Read how it works
            </a>
          </div>
        </section>

        <section
          className="rise"
          style={{ animationDelay: "150ms", maxWidth: 980, margin: "56px auto 0", padding: "0 24px" }}
          aria-label="Live preview"
        >
          <div className="card" style={{ padding: 24 }}>
            <div className="demo">
              <div>
                <p className="cap">FTSO XRP/USD</p>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
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
                <span className="vh" aria-live="polite">
                  {formatPriceMicro(price.priceMicro)} USD, {percentText}
                </span>
              </div>
              <HalftoneChart
                series={series}
                width={480}
                height={160}
                padTop={14}
                padBottom={10}
                heightPx={160}
              />
            </div>
            <div
              className="num"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: "10px 4px",
                marginTop: 20,
                borderTop: "1px solid var(--hairline-strong)",
                borderBottom: "1px solid var(--hairline-strong)",
              }}
            >
              <span className="cap" style={{ whiteSpace: "nowrap" }}>
                FTSO live
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 13 }}>
                <Ticker value={formatPriceMicro(price.priceMicro)} />
                <Ticker value={percentText} style={{ color: deltaColor }} />
                <span className="chip chip-up">armed</span>
              </span>
            </div>
          </div>
          <p className="cap" style={{ marginTop: 10, textAlign: "center" }}>
            Live preview against the FTSOv2 XRP/USD feed on Coston2; it falls
            back to a simulated walk when the RPC is unreachable.
          </p>
        </section>

        <section
          className="rise"
          style={{ animationDelay: "180ms", maxWidth: 980, margin: "56px auto 0", padding: "0 24px" }}
          aria-label="Principles"
        >
          <div className="trio">
            <div className="card cardSealed">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--ink-2)", display: "inline-flex" }}>
                  <IconLock />
                </span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>Sealed</span>
              </div>
              <p className="cap" style={{ marginTop: 6, fontSize: 13 }}>
                The strategy is encrypted for the TEE. Operator, chain and UI
                stay blind.
              </p>
              <div style={{ marginTop: 14 }}>
                <span className="sealedbar" style={{ width: 140 }} />
              </div>
            </div>
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--ink-2)", display: "inline-flex" }}>
                  <IconShield />
                </span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>Proven</span>
              </div>
              <p className="cap" style={{ marginTop: 6, fontSize: 13 }}>
                Deposits and settlements are verified by the Flare Data
                Connector.
              </p>
              <div style={{ marginTop: 14, display: "flex", gap: 14, flexWrap: "wrap" }}>
                <span className="seal ok">deposit verified</span>
                <button
                  type="button"
                  className={
                    settlementVerified ? "seal ok sealset" : "seal pending"
                  }
                  aria-label={
                    settlementVerified
                      ? "Settlement verified"
                      : "Settlement pending, click to verify"
                  }
                  onClick={() => setSettlementVerified(true)}
                >
                  {settlementVerified ? "settlement verified" : "settlement pending"}
                </button>
              </div>
            </div>
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--ink-2)", display: "inline-flex" }}>
                  <IconSlices />
                </span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>Sliced</span>
              </div>
              <p className="cap" style={{ marginTop: 6, fontSize: 13 }}>
                Execution happens in randomized slices so the plan never leaks.
              </p>
              <div style={{ marginTop: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {SLICE_CHIPS.map((size) => (
                  <span key={size} className="chip chip-neutral num">
                    {size}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          className="rise"
          id="how"
          style={{ animationDelay: "210ms", maxWidth: 780, margin: "56px auto 0", padding: "0 24px" }}
          aria-label="How it works"
        >
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>How it works</h2>
          <div className="card" style={{ marginTop: 12, padding: 8 }}>
            {HOW_IT_WORKS.map(([number, title, sentence]) => (
              <div key={number} className="hrow">
                <span className="num" style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-3)", flex: "none" }}>
                  {number}
                </span>
                <span>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
                  <br />
                  <span className="cap" style={{ fontSize: 13 }}>{sentence}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section
          className="rise"
          style={{ animationDelay: "240ms", maxWidth: 560, margin: "56px auto 0", padding: "0 24px" }}
          aria-label="Get started"
        >
          <div className="papercard" style={{ padding: 28, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Set your kerb.</div>
            <p>Non-custodial. Proven by FDC. Sealed in a TEE.</p>
            <Link className="btn btn-seal" href="/app" style={{ marginTop: 16 }}>
              Open the app
            </Link>
          </div>
        </section>
      </main>

      <footer style={{ maxWidth: 1100, margin: "64px auto 0", padding: "0 24px 32px" }}>
        <div style={{ height: 1, background: "var(--hairline)" }} />
        <div
          className="cap"
          style={{ display: "flex", gap: 20, flexWrap: "wrap", paddingTop: 16 }}
        >
          <span style={{ fontWeight: 600, color: "var(--ink-2)" }}>Kerb</span>
          <a
            href="https://dev.flare.network"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--ink-3)" }}
          >
            Flare docs
          </a>
          <a
            href="https://testnet.xrpl.org"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--ink-3)" }}
          >
            XRPL testnet explorer
          </a>
          <span style={{ marginLeft: "auto" }}>Built on Flare + XRPL</span>
        </div>
      </footer>
    </div>
  );
}
