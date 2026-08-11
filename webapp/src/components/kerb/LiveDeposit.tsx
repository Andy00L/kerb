"use client";

import { useState } from "react";
import { useOnChainMandate } from "@/lib/useOnChainMandate";

/**
 * Deposit block for live mode. Shows only the deposit address read from the
 * contract (recorded by applyProvision), never a placeholder: the FDC deposit
 * proof checks the payment against exactly this address and the mandate id as
 * destination tag, so funding anything else strands the money.
 */
export function LiveDeposit({ mandateId }: { readonly mandateId: number }) {
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
      <div
        className="well"
        style={{
          height: "auto",
          padding: "12px 14px",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 6,
        }}
      >
        <p className="num" style={{ fontSize: 13 }}>
          Provisioning...
        </p>
        <p className="cap" style={{ fontSize: 13 }}>
          The enclave is deriving this mandate&apos;s deposit account. The
          address appears here once the signed provisioning result is relayed
          on-chain. Do not send funds before it does.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="well" style={{ height: "auto", padding: "10px 14px", gap: 12 }}>
        <span className="num" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
          {depositAddress}
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
        Tag: {mandateId}, required
      </div>
      <p className="cap" style={{ marginTop: 6, fontSize: 13 }}>
        Fund from any XRPL wallet. The deposit is proven on-chain by FDC.
      </p>
    </>
  );
}
