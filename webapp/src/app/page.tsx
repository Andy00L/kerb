"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Ticker } from "@/components/kerb/ui/Ticker";
import { HalftoneChart } from "@/components/kerb/ui/HalftoneChart";
import {
  IconArrowRight,
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
      <section
        className="onlight"
        style={{
          position: "relative",
          minHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          background: "#e6e1db",
        }}
      >
        <Image
          src="/landing/breakwater.webp"
          alt="A dark stone breakwater holding back a calm sea at dawn"
          fill
          priority
          sizes="100vw"
          style={{
            objectFit: "cover",
            objectPosition: "82% 56%",
            WebkitMaskImage:
              "linear-gradient(to bottom, black 0%, black 88%, transparent 100%)",
            maskImage:
              "linear-gradient(to bottom, black 0%, black 88%, transparent 100%)",
          }}
        />
        <header
          className="rise"
          style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
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
                background: "var(--on-paper)",
                color: "var(--paper)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              K
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--on-paper)" }}>
              Kerb
            </span>
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
          <Link className="btn btn-seal" href="/app">
            Open app
          </Link>
        </header>
        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            maxWidth: 1100,
            margin: "0 auto",
            padding: "0 24px 64px",
            flex: 1,
            display: "flex",
            alignItems: "center",
          }}
        >
          <div style={{ maxWidth: 760 }}>
            <div className="rise" style={{ animationDelay: "30ms" }}>
              <span
                className="chip"
                style={{
                  color: "var(--on-paper-2)",
                  border: "1px solid rgba(13,13,13,0.25)",
                }}
              >
                Non-custodial | XRPL DEX | Flare TEE
              </span>
            </div>
            <h1 className="hero-h" style={{ marginTop: 24, color: "var(--on-paper)" }}>
              <span className="animmask">
                <span className="animseg" style={{ animationDelay: "80ms" }}>
                  Your exit plan,
                </span>
              </span>
              <span className="animmask">
                <span className="animseg" style={{ animationDelay: "180ms" }}>
                  sealed.
                </span>
              </span>
            </h1>
            <p
              className="rise"
              style={{
                animationDelay: "260ms",
                fontSize: 20,
                lineHeight: 1.45,
                color: "var(--on-paper-2)",
                margin: "20px 0 0",
                maxWidth: 540,
                textWrap: "pretty",
              }}
            >
              Kerb runs your stop-loss, limit and DCA on the XRPL DEX from
              inside a TEE. Nobody can front-run what nobody can read.
            </p>
            <div
              className="rise"
              style={{
                animationDelay: "340ms",
                marginTop: 32,
                display: "flex",
                alignItems: "center",
                gap: 20,
                flexWrap: "wrap",
              }}
            >
              <Link className="btn btn-seal" href="/app/new">
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: "var(--paper)",
                    color: "var(--on-paper)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 600,
                    flex: "none",
                  }}
                >
                  K
                </span>
                Start a mandate
              </Link>
              <a
                className="alink"
                href="#how"
                style={{ color: "var(--on-paper)", fontWeight: 600, fontSize: 14 }}
              >
                Read how it works
                <span className="arr" aria-hidden style={{ color: "var(--on-paper-2)" }}>
                  <IconArrowRight />
                </span>
              </a>
            </div>
          </div>
        </div>
      </section>

      <main>
        <div style={{ position: "relative" }}>
          {/* Dusk plate: carries the hero's pale mist down into the charcoal
              page; its own pixels fade out long before the section ends. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/landing/dusk.webp"
            alt=""
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "auto",
              WebkitMaskImage:
                "linear-gradient(to bottom, black 0%, black 72%, transparent 100%)",
              maskImage:
                "linear-gradient(to bottom, black 0%, black 72%, transparent 100%)",
            }}
          />
          <div style={{ position: "relative" }}>
        <section
          className="rise"
          style={{ animationDelay: "150ms", maxWidth: 980, margin: "0 auto", padding: "56px 24px 0" }}
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
          </div>
        </div>

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
          className="onlight"
          aria-label="The keeper"
          style={{
            position: "relative",
            minHeight: "68vh",
            marginTop: 72,
            display: "flex",
            alignItems: "center",
            background: "#eae5e0",
          }}
        >
          <Image
            src="/landing/lighthouse.webp"
            alt="A lighthouse with an oxidized copper lantern on a headland above a calm sea"
            fill
            sizes="100vw"
            style={{ objectFit: "cover", objectPosition: "80% 50%" }}
          />
          <div
            style={{
              position: "relative",
              zIndex: 1,
              width: "100%",
              maxWidth: 1100,
              margin: "0 auto",
              padding: "64px 24px",
            }}
          >
            <div style={{ maxWidth: 640 }}>
              <h2
                style={{
                  fontSize: "clamp(36px, 4.5vw, 56px)",
                  fontWeight: 500,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.08,
                  color: "var(--on-paper)",
                  textWrap: "pretty",
                }}
              >
                <span className="animmask">
                  <span className="animseg">It watches the price</span>
                </span>
                <span className="animmask">
                  <span className="animseg" style={{ animationDelay: "100ms" }}>
                    so you can look away.
                  </span>
                </span>
              </h2>
              <p
                style={{
                  fontSize: 16,
                  color: "var(--on-paper-2)",
                  marginTop: 14,
                  maxWidth: 440,
                  textWrap: "pretty",
                }}
              >
                The enclave keeps its eye on the FTSO feed around the clock.
                Your trigger fires whether you are awake or not.
              </p>
              <div style={{ marginTop: 24 }}>
                <Link className="wsarrow" href="/app" aria-label="Open the app">
                  <IconArrowRight size={20} />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section
          className="rise"
          style={{ animationDelay: "240ms", maxWidth: 560, margin: "72px auto 0", padding: "0 24px" }}
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

      <footer style={{ margin: "64px auto 0", padding: 0 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px" }}>
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
        </div>
        <div aria-hidden style={{ overflow: "hidden", marginTop: 48 }}>
          <div
            style={{
              fontSize: "clamp(110px, 28vw, 400px)",
              fontWeight: 600,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              color: "var(--ink)",
              textAlign: "center",
              transform: "translateY(0.14em)",
              whiteSpace: "nowrap",
              userSelect: "none",
            }}
          >
            Kerb
          </div>
        </div>
      </footer>
    </div>
  );
}
