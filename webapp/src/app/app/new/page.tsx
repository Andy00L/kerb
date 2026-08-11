"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/kerb/AppHeader";
import { LiveDeposit } from "@/components/kerb/LiveDeposit";
import { useWallet } from "@/components/kerb/WalletProvider";
import { waitForMandateId } from "@/lib/chain";
import { readAppConfig } from "@/lib/config";
import { DEMO_DEPOSIT_ADDRESS } from "@/lib/demo";
import {
  submitMandate,
  XRPL_ADDRESS_PATTERN,
  type MandateDraft,
} from "@/lib/mandate";
import styles from "./Create.module.css";

/** Mandate id the demo dataset assigns to a freshly created mandate. */
const DEMO_CREATED_MANDATE_ID = 7;

type Phase = "form" | "review" | "done";
type ButtonStep = "seal" | "wallet" | "submitting" | "error";

interface FormValues {
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
    ["Pair", "XRP/USD"],
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
    `${values.payout.slice(0, 4)}…${values.payout.slice(-4)}`,
  ]);
  return rows;
}

export default function CreateMandatePage() {
  const { address, provider, connect } = useWallet();
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<Phase>("form");
  const [buttonStep, setButtonStep] = useState<ButtonStep>("seal");
  const [sealedNow, setSealedNow] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submitFailure, setSubmitFailure] = useState<string | null>(null);
  const [createdMandateId, setCreatedMandateId] = useState(DEMO_CREATED_MANDATE_ID);
  const isLive = readAppConfig().isLive;

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
      return "Confirm in wallet…";
    }
    if (buttonStep === "submitting") {
      return "Submitting…";
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

  const segmentedCell = (selected: boolean): string =>
    selected ? `${styles.segCell} ${styles.segCellOn}` : styles.segCell;

  return (
    <div>
      <AppHeader />
      <main className={styles.main}>
        <div className={`card ${styles.cardShell} rise`}>
          <div className={styles.cardHead}>
            <h1 className={styles.cardTitle}>
              {phase === "done"
                ? `Mandate #${createdMandateId} created`
                : "New mandate"}
            </h1>
            {phase === "review" && !sealedNow ? (
              <button
                type="button"
                className="btn btnGhost"
                onClick={() => {
                  setPhase("form");
                  setButtonStep("seal");
                }}
              >
                Edit
              </button>
            ) : null}
            {(phase === "review" && sealedNow) || phase === "done" ? (
              <span className={`mono ${styles.sealedCaption}`}>
                Sealed in TEE
              </span>
            ) : null}
          </div>
          <div className="hairlineSolid" style={{ margin: "12px 0 20px" }} />

          {phase === "form" ? (
            <div className={styles.formStack}>
              <div>
                <label htmlFor="pair" className="fieldLabel">
                  Pair
                </label>
                <div className={styles.selectWrap}>
                  <select id="pair" className={`input ${styles.select}`}>
                    <option>XRP/USD</option>
                  </select>
                  <SelectChevron />
                </div>
              </div>

              <div className={styles.segRow}>
                <div>
                  <span className="fieldLabel">Side</span>
                  <div className={`well ${styles.segTrack}`}>
                    <span
                      className={styles.segThumb}
                      style={{
                        width: "calc((100% - 6px) / 2)",
                        transform: `translateX(${values.side === "sell" ? 0 : 100}%)`,
                      }}
                    />
                    <button
                      type="button"
                      className={segmentedCell(values.side === "sell")}
                      onClick={() => setField("side", "sell")}
                    >
                      Sell
                    </button>
                    <button
                      type="button"
                      className={segmentedCell(values.side === "buy")}
                      onClick={() => setField("side", "buy")}
                    >
                      Buy
                    </button>
                  </div>
                </div>
                <div>
                  <span className="fieldLabel">Kind</span>
                  <div className={`well ${styles.segTrack}`}>
                    <span
                      className={styles.segThumb}
                      style={{
                        width: "calc((100% - 6px) / 3)",
                        transform: `translateX(${["stop", "limit", "dca"].indexOf(values.kind) * 100}%)`,
                      }}
                    />
                    {(["stop", "limit", "dca"] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className={segmentedCell(values.kind === kind)}
                        onClick={() => setField("kind", kind)}
                      >
                        {{ stop: "Stop", limit: "Limit", dca: "DCA" }[kind]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="trigger-price" className="fieldLabel">
                  Trigger
                </label>
                <div className={styles.triggerRow}>
                  <div className={styles.selectWrap}>
                    <select
                      aria-label="Trigger operator"
                      className={`input ${styles.select}`}
                      value={values.op}
                      onChange={(event) =>
                        setField("op", event.target.value as "lte" | "gte")
                      }
                    >
                      <option value="lte">Falls to or below</option>
                      <option value="gte">Rises to or above</option>
                    </select>
                    <SelectChevron />
                  </div>
                  <input
                    id="trigger-price"
                    inputMode="decimal"
                    className={`input inputMono ${errors.price ? "inputError" : ""}`}
                    value={values.price}
                    onChange={(event) => setField("price", event.target.value)}
                    onBlur={() => blurField("price")}
                  />
                </div>
                {errors.price ? (
                  <p className="fieldError">{errors.price}</p>
                ) : null}
              </div>

              <div className={styles.pairGrid}>
                <AmountField
                  id="total-size"
                  label="Total size"
                  unit="XRP"
                  value={values.total}
                  error={errors.total}
                  onChange={(next) => setField("total", next)}
                  onBlur={() => blurField("total")}
                />
                <AmountField
                  id="slice-size"
                  label="Slice size"
                  unit="XRP"
                  value={values.slice}
                  error={errors.slice}
                  onChange={(next) => setField("slice", next)}
                  onBlur={() => blurField("slice")}
                />
              </div>

              <div>
                <button
                  type="button"
                  className={`btn btnGhost ${styles.advToggle}`}
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  <svg
                    width="10"
                    height="6"
                    viewBox="0 0 10 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                    style={{
                      transform: advancedOpen ? "rotate(180deg)" : "none",
                      transition: "transform 200ms cubic-bezier(0.4,0,0.2,1)",
                    }}
                  >
                    <path d="M1 1l4 4 4-4" />
                  </svg>
                  Advanced
                </button>
                <div
                  className={styles.advWrap}
                  style={{ gridTemplateRows: advancedOpen ? "1fr" : "0fr" }}
                >
                  <div className={styles.advInner}>
                    <div className={styles.pairGrid} style={{ paddingTop: 10 }}>
                      <AmountField
                        id="jitter"
                        label="Jitter"
                        unit="%"
                        value={values.jitter}
                        error={errors.jitter}
                        onChange={(next) => setField("jitter", next)}
                        onBlur={() => blurField("jitter")}
                      />
                      <AmountField
                        id="slippage"
                        label="Max slippage"
                        unit="%"
                        value={values.slippage}
                        error={errors.slippage}
                        onChange={(next) => setField("slippage", next)}
                        onBlur={() => blurField("slippage")}
                      />
                      {values.kind === "dca" ? (
                        <>
                          <AmountField
                            id="dca-every"
                            label="Every"
                            unit="sec"
                            value={values.everySeconds}
                            onChange={(next) => setField("everySeconds", next)}
                          />
                          <AmountField
                            id="dca-times"
                            label="Times"
                            value={values.times}
                            onChange={(next) => setField("times", next)}
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="expiry" className="fieldLabel">
                  Expiry
                </label>
                <input
                  id="expiry"
                  type="datetime-local"
                  className={`input mono ${errors.expiry ? "inputError" : ""}`}
                  style={{ colorScheme: "dark", fontSize: 13 }}
                  value={values.expiry}
                  onChange={(event) => setField("expiry", event.target.value)}
                  onBlur={() => blurField("expiry")}
                />
                {errors.expiry ? (
                  <p className="fieldError">{errors.expiry}</p>
                ) : null}
              </div>

              <div>
                <label htmlFor="payout" className="fieldLabel">
                  Payout address
                </label>
                <input
                  id="payout"
                  spellCheck={false}
                  className={`input mono ${errors.payout ? "inputError" : ""}`}
                  style={{ textAlign: "left", fontSize: 13 }}
                  value={values.payout}
                  onChange={(event) => setField("payout", event.target.value)}
                  onBlur={() => blurField("payout")}
                />
                {errors.payout ? (
                  <p className="fieldError">{errors.payout}</p>
                ) : null}
                {trustlineWarning ? (
                  <p className="fieldError">
                    This address cannot receive USD yet. Open a trustline before
                    settlement.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {phase !== "form" ? (
            <div className="rise">
              {reviewRows.map(([label, value], index) => {
                const barWidth = Math.min(
                  170,
                  Math.max(34, value.length * 7),
                );
                const sealedVisible = phase === "done" || sealedNow;
                return (
                  <div
                    key={label}
                    className={styles.reviewRow}
                    style={index === 0 ? { borderTop: "none" } : undefined}
                  >
                    <span className={styles.reviewLabel}>{label}</span>
                    <span className={`mono ${styles.reviewValue}`}>
                      <span
                        style={{
                          opacity: sealedVisible ? 0 : 1,
                          transition: `opacity 400ms cubic-bezier(0.4,0,0.2,1) ${index * 40}ms`,
                        }}
                      >
                        {value}
                      </span>
                      <span
                        className={styles.reviewBar}
                        style={{
                          width: `${barWidth}px`,
                          clipPath: sealedVisible
                            ? "inset(0 0 0 0)"
                            : "inset(0 100% 0 0)",
                          transition: `clip-path 400ms cubic-bezier(0,0,0.2,1) ${index * 40}ms`,
                        }}
                      />
                    </span>
                  </div>
                );
              })}
              {phase === "review" ? (
                <div className={styles.feeRow}>
                  <span className={styles.reviewLabel}>Network fee</span>
                  <span className={`mono ${styles.feeValue}`}>
                    ~0.002 C2FLR
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {phase === "done" ? (
            <div className={styles.depositBlock}>
              <h2 className={styles.depositTitle}>Deposit</h2>
              <div className="hairlineSolid" style={{ margin: "10px 0 14px" }} />
              {isLive ? (
                // Live mode only ever shows the address read from the chain:
                // funding anything else would miss the FDC deposit proof.
                <LiveDeposit mandateId={createdMandateId} />
              ) : (
                <>
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
                    Tag: {createdMandateId}, required
                  </div>
                  <p className={styles.depositNote}>
                    Fund from any XRPL wallet. The deposit is proven on-chain
                    by FDC.
                  </p>
                </>
              )}
            </div>
          ) : null}

          {submitFailure !== null ? (
            <div className="errorBand" style={{ marginTop: 16 }}>
              <span>{submitFailure}</span>
              <button
                type="button"
                className="btn btnQuiet"
                style={{ height: 32 }}
                onClick={() => {
                  void startSigning();
                }}
              >
                Try again
              </button>
            </div>
          ) : null}

          {phase !== "done" ? (
            <button
              type="button"
              className={`btn btnPrimary ${styles.footerButton}`}
              disabled={isBusy || buttonStep === "error"}
              onClick={handleFooterClick}
            >
              {isBusy ? <Spinner /> : null}
              {footerLabel}
            </button>
          ) : (
            <Link
              href={`/app/m/${createdMandateId}`}
              className={`btn btnPrimary ${styles.footerButton}`}
            >
              View mandate
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}

function SelectChevron() {
  return (
    <svg
      width="10"
      height="6"
      viewBox="0 0 10 6"
      className={styles.chevron}
      fill="none"
      stroke="var(--ink-faint)"
      strokeWidth="1"
      aria-hidden="true"
    >
      <path d="M1 1l4 4 4-4" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={styles.spinner}
      aria-hidden="true"
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke="rgba(22,19,15,0.35)"
        strokeWidth="1.5"
      />
      <path
        d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5"
        stroke="var(--surface)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface AmountFieldProps {
  readonly id: string;
  readonly label: string;
  readonly unit?: string;
  readonly value: string;
  readonly error?: string;
  readonly onChange: (nextValue: string) => void;
  readonly onBlur?: () => void;
}

function AmountField({
  id,
  label,
  unit,
  value,
  error,
  onChange,
  onBlur,
}: AmountFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="fieldLabel">
        {label}
      </label>
      <div className={styles.amountWrap}>
        <input
          id={id}
          inputMode="decimal"
          className={`input inputMono ${error ? "inputError" : ""}`}
          style={unit === undefined ? undefined : { paddingRight: 46 }}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        {unit === undefined ? null : (
          <span className={styles.unitSuffix}>{unit}</span>
        )}
      </div>
      {error ? <p className="fieldError">{error}</p> : null}
    </div>
  );
}
