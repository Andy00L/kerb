"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WalletCluster } from "@/components/kerb/AppShell";
import { LiveDeposit } from "@/components/kerb/LiveDeposit";
import { DatePicker } from "@/components/kerb/ui/DatePicker";
import { ProofSeal } from "@/components/kerb/ProofSeal";
import { Fold } from "@/components/kerb/ui/Fold";
import { Menu } from "@/components/kerb/ui/Menu";
import { Tabs } from "@/components/kerb/ui/Tabs";
import { Ticker, WordMorph } from "@/components/kerb/ui/Ticker";
import { useWallet } from "@/components/kerb/WalletProvider";
import { waitForMandateId } from "@/lib/chain";
import { readAppConfig } from "@/lib/config";
import { DEMO_DEPOSIT_ADDRESS } from "@/lib/demo";
import { feedIdForPair, SUPPORTED_PAIRS, type SupportedPair } from "@/lib/feeds";
import { formatPriceMicro } from "@/lib/format";
import {
  submitMandate,
  XRPL_ADDRESS_PATTERN,
  type MandateDraft,
} from "@/lib/mandate";
import { useLivePrice } from "@/lib/useLivePrice";

/** Mandate id the demo dataset assigns to a freshly created mandate. */
const DEMO_CREATED_MANDATE_ID = 7;

type Phase = "form" | "review" | "done";
type ButtonStep = "seal" | "wallet" | "submitting" | "error";

interface FormValues {
  pair: SupportedPair;
  side: "sell" | "buy";
  kind: "stop" | "limit" | "dca";
  op: "lte" | "gte";
  price: string;
  total: string;
  slice: string;
  jitter: string;
  slippage: string;
  everySeconds: string;
  times: string;
  expiry: string;
  payout: string;
}

type FieldErrors = Partial<Record<keyof FormValues, string>>;

const INITIAL_VALUES: FormValues = {
  pair: "XRP/USD",
  side: "sell",
  kind: "stop",
  op: "lte",
  price: "2.6500",
  total: "2500.00",
  slice: "100.00",
  jitter: "15",
  slippage: "0.50",
  everySeconds: "3600",
  times: "25",
  expiry: "",
  payout: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
};

/** The demo issuer's own account is the one address with a trustline. */
const TRUSTED_DEMO_PAYOUT = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

const MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

function parseAmount(text: string): number | null {
  const value = Number.parseFloat(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function validateField(
  values: FormValues,
  field: keyof FormValues,
): string | undefined {
  const price = parseAmount(values.price);
  const total = parseAmount(values.total);
  const slice = parseAmount(values.slice);
  switch (field) {
    case "price":
      return price === null || price <= 0 ? "Enter a trigger price" : undefined;
    case "total":
      return total === null || total <= 0 ? "Enter a total size" : undefined;
    case "slice":
      if (slice === null || slice < 1) {
        return "Slice must be at least 1 XRP";
      }
      return total !== null && slice > total
        ? "Slice must be at most the total"
        : undefined;
    case "jitter": {
      const jitter = parseAmount(values.jitter);
      return jitter === null ||
        jitter < 0 ||
        jitter > 50 ||
        !Number.isInteger(jitter)
        ? "Jitter must be 0 to 50%"
        : undefined;
    }
    case "slippage": {
      const slippage = parseAmount(values.slippage);
      return slippage === null || slippage < 0.01 || slippage > 10
        ? "Slippage must be 0.01 to 10%"
        : undefined;
    }
    case "expiry": {
      const timestamp = values.expiry
        ? new Date(values.expiry).getTime()
        : Number.NaN;
      if (Number.isNaN(timestamp)) {
        return "Enter an expiry";
      }
      if (timestamp <= Date.now()) {
        return "Expiry must be in the future";
      }
      return timestamp > Date.now() + MAX_LIFETIME_MS
        ? "Expiry must be within 30 days"
        : undefined;
    }
    case "payout":
      return XRPL_ADDRESS_PATTERN.test(values.payout.trim())
        ? undefined
        : "Enter a valid XRPL r-address";
    default:
      return undefined;
  }
}

const VALIDATED_FIELDS: ReadonlyArray<keyof FormValues> = [
  "price",
  "total",
  "slice",
  "jitter",
  "slippage",
  "expiry",
  "payout",
];

function buildReviewRows(values: FormValues): Array<[string, string]> {
  const operatorWord =
    values.op === "lte" ? "falls to or below" : "rises to or above";
  const rows: Array<[string, string]> = [
    ["Pair", values.pair],
    ["Side", values.side === "sell" ? "Sell" : "Buy"],
    ["Kind", { stop: "Stop", limit: "Limit", dca: "DCA" }[values.kind]],
    ["Trigger", `${operatorWord} ${values.price}`],
    ["Total size", `${values.total} XRP`],
    ["Slice size", `${values.slice} XRP`],
    ["Jitter", `${values.jitter}%`],
    ["Max slippage", `${values.slippage}%`],
  ];
  if (values.kind === "dca") {
    rows.push(["Interval", `every ${values.everySeconds} s`]);
    rows.push(["Times", values.times]);
  }
  rows.push(["Expiry", values.expiry.replace("T", " ")]);
  rows.push([
    "Payout",
    `${values.payout.slice(0, 4)}...${values.payout.slice(-4)}`,
  ]);
  return rows;
}

function sliceSummary(values: FormValues): string {
  const total = parseAmount(values.total) ?? 0;
  const slice = Math.max(1, parseAmount(values.slice) ?? 1);
  const count = Math.max(1, Math.round(total / slice));
  return `${count} x ~${(total / count).toFixed(2)} XRP, jitter ${values.jitter}%`;
}

export default function CreateMandatePage() {
  const { address, provider, connect } = useWallet();
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const price = useLivePrice(true, feedIdForPair(values.pair));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<Phase>("form");
  const [buttonStep, setButtonStep] = useState<ButtonStep>("seal");
  const [sealedNow, setSealedNow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submitFailure, setSubmitFailure] = useState<string | null>(null);
  const [createdMandateId, setCreatedMandateId] = useState(DEMO_CREATED_MANDATE_ID);
  const { isLive, isDemoEnabled } = readAppConfig();

  // Synchronizes the default expiry with the wall clock, once.
  useEffect(() => {
    const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
    const pad = (part: number): string => String(part).padStart(2, "0");
    const localValue = `${inSevenDays.getFullYear()}-${pad(inSevenDays.getMonth() + 1)}-${pad(inSevenDays.getDate())}T${pad(inSevenDays.getHours())}:${pad(inSevenDays.getMinutes())}`;
    setValues((current) =>
      current.expiry === "" ? { ...current, expiry: localValue } : current,
    );
  }, []);

  const setField = (field: keyof FormValues, nextValue: string): void => {
    setValues((current) => ({ ...current, [field]: nextValue }));
  };

  // A pair change clears the trigger price: the previous number lives on
  // another scale (an XRP trigger makes no sense against BTC/USD).
  const pickPair = (pair: SupportedPair): void => {
    setValues((current) =>
      current.pair === pair ? current : { ...current, pair, price: "" },
    );
    setErrors((current) => ({ ...current, price: undefined }));
  };

  const blurField = (field: keyof FormValues): void => {
    setErrors((current) => ({
      ...current,
      [field]: validateField(values, field),
    }));
  };

  const validateAll = (): boolean => {
    const nextErrors: FieldErrors = {};
    for (const field of VALIDATED_FIELDS) {
      nextErrors[field] = validateField(values, field);
    }
    setErrors(nextErrors);
    return !Object.values(nextErrors).some((message) => message !== undefined);
  };

  const startSigning = async (): Promise<void> => {
    setSubmitFailure(null);
    setSealedNow(true);
    const draft: MandateDraft = {
      pair: values.pair,
      side: values.side,
      kind: values.kind,
      triggerOperator: values.op,
      triggerPrice: values.price.replace(/,/g, ""),
      totalXrp: values.total.replace(/,/g, ""),
      sliceXrp: values.slice.replace(/,/g, ""),
      jitterPercent: Number.parseInt(values.jitter, 10),
      maxSlippagePercent: Number.parseFloat(values.slippage),
      dcaEverySeconds:
        values.kind === "dca" ? Number.parseInt(values.everySeconds, 10) : null,
      dcaTimes: values.kind === "dca" ? Number.parseInt(values.times, 10) : null,
      expiryUnixSeconds: Math.floor(new Date(values.expiry).getTime() / 1_000),
      payoutAddress: values.payout.trim(),
    };
    const result = await submitMandate(
      draft,
      address ?? "0x0000000000000000000000000000000000000000",
      (nextPhase) => setButtonStep(nextPhase === "wallet" ? "wallet" : "submitting"),
      provider,
    );
    if (!result.ok) {
      setButtonStep("error");
      setSubmitFailure(result.reason);
      return;
    }
    if (isLive) {
      // The id is assigned on-chain; read it from the MandateCreated event so
      // the done screen and the detail link point at the real mandate.
      const mandateId = await waitForMandateId(
        result.transactionHash as `0x${string}`,
      );
      if (mandateId === null) {
        setButtonStep("error");
        setSubmitFailure("the transaction did not confirm; check the explorer");
        return;
      }
      setCreatedMandateId(mandateId);
    }
    setPhase("done");
    setButtonStep("seal");
  };

  const reviewRows = buildReviewRows(values);
  const trustlineWarning =
    errors.payout === undefined &&
    XRPL_ADDRESS_PATTERN.test(values.payout.trim()) &&
    values.payout.trim() !== TRUSTED_DEMO_PAYOUT;

  const isBusy = buttonStep === "wallet" || buttonStep === "submitting";
  const footerLabel = (() => {
    if (phase === "form") {
      return address === null ? "Connect wallet" : "Review and seal";
    }
    if (buttonStep === "wallet") {
      return "Confirm in wallet...";
    }
    if (buttonStep === "submitting") {
      return "Submitting...";
    }
    return "Seal and sign";
  })();

  const handleFooterClick = (): void => {
    if (phase === "form") {
      if (address === null) {
        void connect();
        return;
      }
      if (validateAll()) {
        setPhase("review");
        setSealedNow(false);
        setButtonStep("seal");
      }
      return;
    }
    if (phase === "review" && buttonStep === "seal") {
      void startSigning();
    }
  };

  const copyDepositAddress = (): void => {
    try {
      void navigator.clipboard.writeText(DEMO_DEPOSIT_ADDRESS);
    } catch (copyError) {
      console.log(`[copyDepositAddress] clipboard unavailable: ${copyError}`);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1_200);
  };

  const sealedVisible = phase === "done" || sealedNow;

  return (
    <div>
      <header
        className="rise"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>
          {phase === "done" ? `Mandate #${createdMandateId} created` : "New mandate"}
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {phase === "form" ? (
            <Menu
              label={<span className="num">{values.pair}</span>}
              buttonClassName="btn btn-quiet num"
              ariaLabel="Trigger pair"
              items={SUPPORTED_PAIRS.map((pair) => ({ value: pair, label: pair }))}
              value={values.pair}
              onPick={(pair) => pickPair(pair as SupportedPair)}
            />
          ) : (
            <span className="chip chip-neutral">{values.pair}</span>
          )}
          <span className="cap num" style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>
            FTSO <Ticker value={formatPriceMicro(price.priceMicro)} />
          </span>
          <WalletCluster />
        </div>
      </header>

      <div
        className="cols"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 360px",
          gap: 48,
          marginTop: 40,
          alignItems: "start",
        }}
      >
        <div style={{ maxWidth: 640 }}>
          {phase === "form" ? (
            <form
              style={{ display: "flex", flexDirection: "column", gap: 28 }}
              onSubmit={(event) => event.preventDefault()}
            >
              <section className="rise" style={{ animationDelay: "30ms" }}>
                <div className="seclabel">Side</div>
                <Tabs
                  className="xl"
                  ariaLabel="Side"
                  tabs={[
                    { id: "sell" as const, label: "Sell" },
                    { id: "buy" as const, label: "Buy" },
                  ]}
                  selected={values.side}
                  onSelect={(side) => setField("side", side)}
                  pillStyle={{
                    background:
                      values.side === "sell"
                        ? "rgba(229,84,75,0.16)"
                        : "rgba(55,188,101,0.16)",
                  }}
                />
              </section>

              <section className="rise" style={{ animationDelay: "60ms" }}>
                <div className="seclabel">Kind</div>
                <Tabs
                  ariaLabel="Kind"
                  tabs={[
                    { id: "stop" as const, label: "Stop" },
                    { id: "limit" as const, label: "Limit" },
                    { id: "dca" as const, label: "DCA" },
                  ]}
                  selected={values.kind}
                  onSelect={(kind) => setField("kind", kind)}
                />
              </section>

              <section className="rise" style={{ animationDelay: "90ms" }}>
                <div className="seclabel">Trigger</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <Menu
                    label={
                      <span className="num">
                        {values.op === "lte" ? "Price <=" : "Price >="}
                      </span>
                    }
                    buttonClassName="btn btn-quiet num"
                    ariaLabel="Trigger operator"
                    align="left"
                    items={[
                      { value: "lte", label: "Price <=" },
                      { value: "gte", label: "Price >=" },
                    ]}
                    value={values.op}
                    onPick={(op) => setField("op", op)}
                  />
                  <div className={`well${errors.price ? " err" : ""}`} style={{ flex: 1 }}>
                    <input
                      inputMode="decimal"
                      aria-label="Trigger price"
                      value={values.price}
                      onChange={(event) => setField("price", event.target.value)}
                      onBlur={() => blurField("price")}
                    />
                  </div>
                </div>
                <p className={`cap${errors.price ? " err" : ""}`} style={{ marginTop: 8 }}>
                  {errors.price ??
                    `Fires when the ${values.pair} FTSO feed crosses this line.`}
                </p>
              </section>

              <section className="rise" style={{ animationDelay: "120ms" }}>
                <div className="seclabel">Amount</div>
                <div className={`well${errors.total ? " err" : ""}`}>
                  <input
                    inputMode="decimal"
                    aria-label="Total size"
                    value={values.total}
                    onChange={(event) => setField("total", event.target.value)}
                    onBlur={() => blurField("total")}
                  />
                  <span className="unit">XRP</span>
                </div>
                <p className={`cap${errors.total ? " err" : ""}`} style={{ marginTop: 8 }}>
                  {errors.total ?? "Total size the mandate may spend."}
                </p>
              </section>

              <section className="rise" style={{ animationDelay: "150ms" }}>
                <div className="seclabel">Slicing</div>
                <div
                  className="slicerow"
                  style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}
                >
                  <div>
                    <div className="cap" style={{ marginBottom: 6 }}>
                      Slice size
                    </div>
                    <div className={`well${errors.slice ? " err" : ""}`}>
                      <input
                        inputMode="decimal"
                        aria-label="Slice size"
                        value={values.slice}
                        onChange={(event) => setField("slice", event.target.value)}
                        onBlur={() => blurField("slice")}
                      />
                      <span className="unit">XRP</span>
                    </div>
                    {errors.slice ? (
                      <p className="cap err" style={{ marginTop: 6 }}>
                        {errors.slice}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <div className="cap" style={{ marginBottom: 6 }}>
                      Jitter
                    </div>
                    <div className={`well${errors.jitter ? " err" : ""}`}>
                      <input
                        inputMode="numeric"
                        aria-label="Jitter percent"
                        value={values.jitter}
                        onChange={(event) => setField("jitter", event.target.value)}
                        onBlur={() => blurField("jitter")}
                      />
                      <span className="unit">%</span>
                    </div>
                    <p className={`cap num${errors.jitter ? " err" : ""}`} style={{ marginTop: 6 }}>
                      {errors.jitter ?? "0 to 50"}
                    </p>
                  </div>
                  <div>
                    <div className="cap" style={{ marginBottom: 6 }}>
                      Slippage
                    </div>
                    <div className={`well${errors.slippage ? " err" : ""}`}>
                      <input
                        inputMode="decimal"
                        aria-label="Slippage percent"
                        value={values.slippage}
                        onChange={(event) => setField("slippage", event.target.value)}
                        onBlur={() => blurField("slippage")}
                      />
                      <span className="unit">%</span>
                    </div>
                    <p className={`cap num${errors.slippage ? " err" : ""}`} style={{ marginTop: 6 }}>
                      {errors.slippage ?? "0.01 to 10"}
                    </p>
                  </div>
                </div>
              </section>

              <Fold open={values.kind === "dca"}>
                <section style={{ paddingBottom: 2 }}>
                  <div className="seclabel">Schedule</div>
                  <div
                    className="slicerow"
                    style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
                  >
                    <div>
                      <div className="cap" style={{ marginBottom: 6 }}>
                        Every
                      </div>
                      <div className="well">
                        <input
                          inputMode="numeric"
                          aria-label="Interval seconds"
                          value={values.everySeconds}
                          onChange={(event) =>
                            setField("everySeconds", event.target.value)
                          }
                        />
                        <span className="unit">sec</span>
                      </div>
                    </div>
                    <div>
                      <div className="cap" style={{ marginBottom: 6 }}>
                        Times
                      </div>
                      <div className="well">
                        <input
                          inputMode="numeric"
                          aria-label="Times"
                          value={values.times}
                          onChange={(event) => setField("times", event.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                  <p className="cap" style={{ marginTop: 8 }}>
                    Minimum interval is 60 seconds.
                  </p>
                </section>
              </Fold>

              <section className="rise" style={{ animationDelay: "180ms" }}>
                <div className="seclabel">Expiry</div>
                <DatePicker
                  value={values.expiry}
                  ariaLabel="Expiry"
                  hasError={errors.expiry !== undefined}
                  onChange={(next) => setField("expiry", next)}
                  onClose={() => blurField("expiry")}
                />
                <p className={`cap${errors.expiry ? " err" : ""}`} style={{ marginTop: 8 }}>
                  {errors.expiry ?? "Maximum 30 days per mandate; longer plans roll."}
                </p>
              </section>

              <section className="rise" style={{ animationDelay: "210ms" }}>
                <div className="seclabel">Payout</div>
                <div className={`well${errors.payout ? " err" : ""}`}>
                  <input
                    spellCheck={false}
                    aria-label="Payout address"
                    style={{ fontSize: 13, letterSpacing: "0.01em" }}
                    value={values.payout}
                    onChange={(event) => setField("payout", event.target.value)}
                    onBlur={() => blurField("payout")}
                  />
                </div>
                <p className={`cap${errors.payout ? " err" : ""}`} style={{ marginTop: 8 }}>
                  {errors.payout ?? "XRPL r-address that receives fills."}
                </p>
                {trustlineWarning ? (
                  <p className="cap err" style={{ marginTop: 6 }}>
                    This address cannot receive USD yet. Open a trustline before
                    settlement.
                  </p>
                ) : null}
              </section>
            </form>
          ) : (
            <div className="card rise">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>
                  {phase === "done" ? "Sealed strategy" : "Review"}
                </h2>
                {phase === "review" && !sealedNow ? (
                  <button
                    type="button"
                    className="btn btn-compact"
                    onClick={() => {
                      setPhase("form");
                      setButtonStep("seal");
                    }}
                  >
                    Edit
                  </button>
                ) : (
                  <span className="chip chip-neutral">Sealed in TEE</span>
                )}
              </div>
              <div style={{ height: 1, background: "var(--hairline)", margin: "12px 0 8px" }} />
              {reviewRows.map(([label, value], index) => {
                const barWidth = Math.min(170, Math.max(34, value.length * 7));
                return (
                  <div key={label} className="srow" style={{ minHeight: 30 }}>
                    <span className="sl">{label}</span>
                    <span className="sv" style={{ position: "relative" }}>
                      <span
                        style={{
                          opacity: sealedVisible ? 0 : 1,
                          transition: `opacity 400ms var(--ease) ${index * 40}ms`,
                        }}
                      >
                        {value}
                      </span>
                      <span
                        className="sealedbar"
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: `${barWidth}px`,
                          clipPath: sealedVisible
                            ? "inset(0 0 0 0)"
                            : "inset(0 100% 0 0)",
                          transition: `clip-path 400ms var(--ease) ${index * 40}ms`,
                        }}
                      />
                    </span>
                  </div>
                );
              })}
              {phase === "review" ? (
                <div
                  className="srow"
                  style={{
                    borderTop: "1px solid var(--hairline)",
                    marginTop: 8,
                    paddingTop: 10,
                  }}
                >
                  <span className="sl">Network fee</span>
                  <span className="sv num" style={{ color: "var(--ink-2)" }}>
                    ~0.002 C2FLR
                  </span>
                </div>
              ) : null}
            </div>
          )}

          {phase === "done" ? (
            <div className="card rise" style={{ marginTop: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Deposit</h2>
              <div style={{ height: 1, background: "var(--hairline)", margin: "12px 0 14px" }} />
              {isLive ? (
                // Live mode only ever shows the address read from the chain:
                // funding anything else would miss the FDC deposit proof.
                <LiveDeposit mandateId={createdMandateId} />
              ) : !isDemoEnabled ? (
                <p className="cap" style={{ fontSize: 13 }}>
                  The enclave-derived address appears once provisioning is
                  relayed on-chain. Do not send funds before it does.
                </p>
              ) : (
                <>
                  <div className="well" style={{ height: "auto", padding: "10px 14px", gap: 12 }}>
                    <span className="num" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                      {DEMO_DEPOSIT_ADDRESS}
                    </span>
                    <button
                      type="button"
                      className="btn btn-compact"
                      style={{ flex: "none" }}
                      onClick={copyDepositAddress}
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="cap num" style={{ marginTop: 8 }}>
                    Tag: {createdMandateId}, required
                  </div>
                  <p className="cap" style={{ marginTop: 6, fontSize: 13 }}>
                    Fund from any XRPL wallet. The deposit is proven on-chain by
                    FDC.
                  </p>
                </>
              )}
            </div>
          ) : null}

          {submitFailure !== null ? (
            <div
              className="card"
              style={{
                marginTop: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                border: "1px solid rgba(229,84,75,0.45)",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--down)" }}>{submitFailure}</span>
              <button
                type="button"
                className="btn btn-compact"
                onClick={() => {
                  void startSigning();
                }}
              >
                Try again
              </button>
            </div>
          ) : null}
        </div>

        <aside
          className="rail-summary"
          style={{ position: "sticky", top: 24, display: "flex", flexDirection: "column", gap: 20 }}
          aria-label="Summary"
        >
          <section className="card rise" style={{ animationDelay: "120ms" }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <WordMorph word={values.side === "sell" ? "Sell" : "Buy"} />
              <Ticker value={Number(parseAmount(values.total) ?? 0).toFixed(2)} />
              <span className="cap" style={{ fontWeight: 500 }}>
                XRP
              </span>
              <span className="vh" aria-live="polite">
                {values.side === "sell" ? "Sell" : "Buy"} {values.total} XRP
              </span>
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="srow">
                <span className="sl">{values.kind === "dca" ? "Cadence" : "Trigger"}</span>
                <span className="sv">
                  <Ticker
                    value={
                      values.kind === "dca"
                        ? `every ${values.everySeconds} s`
                        : `${values.pair === "XRP/USD" ? "price" : values.pair} ${values.op === "lte" ? "<=" : ">="} ${values.price}`
                    }
                  />
                </span>
              </div>
              <div className="srow">
                <span className="sl">Slices</span>
                <span className="sv">
                  <Ticker value={sliceSummary(values)} />
                </span>
              </div>
              <div className="srow">
                <span className="sl">Slippage</span>
                <span className="sv">
                  <Ticker value={`${values.slippage}%`} />
                </span>
              </div>
              <div className="srow">
                <span className="sl">Expiry</span>
                <span className="sv num">{values.expiry.replace("T", " ") || "--"}</span>
              </div>
              <div className="srow">
                <span className="sl">Payout</span>
                <span className="sv num">
                  {values.payout.length > 10
                    ? `${values.payout.slice(0, 4)}...${values.payout.slice(-4)}`
                    : values.payout}
                </span>
              </div>
            </div>
            <div style={{ height: 1, background: "var(--hairline)", margin: "16px 0" }} />
            <p className="cap">What gets sealed</p>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span className="cap" style={{ width: 56 }}>
                  Trigger
                </span>
                <span className="sealedbar" style={{ width: 180, maxWidth: "60%" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span className="cap" style={{ width: 56 }}>
                  Slices
                </span>
                <span className="sealedbar" style={{ width: 120, maxWidth: "45%" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span className="cap" style={{ width: 56 }}>
                  Jitter
                </span>
                <span className="sealedbar" style={{ width: 90, maxWidth: "35%" }} />
              </div>
            </div>
            <p className="cap" style={{ marginTop: 16 }}>
              After sealing you fund the deposit address; the deposit is proven
              by FDC before execution can start.
            </p>
          </section>

          <section className="papercard rise" style={{ animationDelay: "150ms" }}>
            {phase === "done" ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 14,
                  flexWrap: "wrap",
                }}
              >
                <ProofSeal state="pending" label="deposit pending" />
                <Link
                  href={`/app/m/${createdMandateId}`}
                  className="btn btn-seal"
                >
                  View mandate
                </Link>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-seal"
                style={{ width: "100%", justifyContent: "center" }}
                disabled={isBusy || buttonStep === "error"}
                onClick={handleFooterClick}
              >
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
                <WordMorph word={footerLabel} />
              </button>
            )}
            <p
              style={{
                fontSize: 13,
                color: "var(--on-paper-2)",
                marginTop: 12,
                textAlign: "center",
                textWrap: "pretty",
              }}
            >
              Sealing encrypts the strategy for the TEE. Nobody, including
              Kerb, can read it afterwards.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
