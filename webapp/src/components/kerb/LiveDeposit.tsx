"use client";

import { useState } from "react";
import { useOnChainMandate } from "@/lib/useOnChainMandate";

/**
 * Deposit block for live mode. Shows only the deposit address read from the
 * contract (recorded by applyProvision), never a placeholder: the FDC deposit
 * proof checks the payment against exactly this address and the mandate id as
 * destination tag, so funding anything else strands the money.
 */
export function LiveDeposit({ mandateId }: { mandateId: number }) {
  const mandate = useOnChainMandate(mandateId);
  const [copied, setCopied] = useState(false);
  const depositAddress =
    mandate !== null && mandate.depositAddress !== ""
      ? mandate.depositAddress
      : null;

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

  if (depositAddress === null) {
    return (
      <div className="well" style={{ padding: "14px 16px" }}>
        <p className="mono" style={{ fontSize: 13 }}>
          Provisioning…
        </p>
        <p style={{ fontSize: 13, marginTop: 6 }}>
          The enclave is deriving this mandate&apos;s deposit account. The
          address appears here once the signed provisioning result is relayed
          on-chain. Do not send funds before it does.
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        className="well"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 14px",
        }}
      >
        <span className="mono" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
          {depositAddress}
        </span>
        <button type="button" className="btn btnQuiet" onClick={copyDepositAddress}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="mono" style={{ fontSize: 12, marginTop: 8 }}>
        Tag: {mandateId}, required
      </div>
      <p style={{ fontSize: 13, marginTop: 6 }}>
        Fund from any XRPL wallet. The deposit is proven on-chain by FDC.
      </p>
    </>
  );
}
