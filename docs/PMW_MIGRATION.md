# Kerb on Protocol Managed Wallets: the migration map

PMW (Protocol Managed Wallets) is the FCC system application for
protocol-level signing of transactions on external chains: k-of-n multisig,
nonce management, reissuance and nullification, and Execution Proofs through
FDC. Its status on the developer hub is "in development", with no public API
during this hackathon (sourceRef: https://dev.flare.network/fcc/overview).

Kerb was therefore built app-layer on the `fce-sign` pattern: keys derived
and held inside one enclave. This document shows, seam by seam, that Kerb is
the natural client application of PMW: when the API opens, the custody layer
swaps out and the product above it does not change.

## The custody surface today

Everything that touches key material or signatures passes through two seams,
both already isolated behind interfaces or single modules:

| Seam | Where | What it does today |
| ---- | ----- | ------------------ |
| Key derivation | [`typescript/src/app/wallet.ts`](../typescript/src/app/wallet.ts), `deriveMandateWallet` | HMAC-SHA256 from an enclave master seed to one XRPL account per mandate |
| Sign and submit | [`typescript/src/app/xrpl.ts`](../typescript/src/app/xrpl.ts), `LedgerGateway.submit` | `client.autofill`, `wallet.sign` in enclave memory, `submitAndWait`, measured balance change |

The engine ([`engine.ts`](../typescript/src/app/engine.ts)) depends only on
the `LedgerGateway` interface, never on the concrete `XrplExecutor`, which is
what makes the swap mechanical.

## Field-by-field mapping

| Kerb today (enclave signer) | PMW concept | What changes |
| --------------------------- | ----------- | ------------ |
| `deriveMandateWallet(masterSeed, mandateId)` returns a local XRPL wallet | Wallet creation instruction: one protocol-managed XRPL account per mandate, k-of-n keyholders | The deposit address comes back from a PMW instruction result instead of local derivation; `applyProvision` ingests it unchanged |
| `initSeed(bytes)` installs the master seed | Not needed | The seed, its guard, and the restart-replay procedure disappear; custody risk moves from one enclave to the PMW operator set |
| `wallet.sign(prepared)` + `submitAndWait` inside `XrplExecutor.submit` | Signing instruction with protocol nonce management | A `PmwSigner implements LedgerGateway` maps `submit(transaction)` to a PMW signing instruction and polls its Execution Proof; `measureFilledDrops` keeps working, it reads the validated ledger, not the signer |
| Settlement `Payment` built by `buildSettlementPayment` and proven by `proveSettlement` (FDC XRPPayment) | Execution Proofs | Same proof family; Kerb's settlement gate is already the shape PMW documents |
| `cancelMandate` sets CANCELLED on-chain, engine stops before next signature | Nullification | Cancellation upgrades from "the enclave promises to stop" to "the protocol refuses to co-sign" |
| Enclave crash or restart: manual settlement, never restart with live funds | Reissuance | Key loss recovery becomes a protocol operation instead of an operational rule |
| Trusted: the enclave pays the sealed payout address | User as cosigner via `TeeInstructionParams.cosigners` | The user co-signs withdrawals; the trust gap named in [ARCHITECTURE.md](../ARCHITECTURE.md) closes |

## What does not change

- `contracts/InstructionSender.sol`: the mandate registry, the FDC deposit
  and settlement gates, the replay map, and the lifecycle are signer-agnostic.
- The mandate schema and its client-side ECIES sealing: what stays
  confidential is unrelated to who holds the signing key.
- The FTSOv2 trigger engine, slicing, jitter and slippage logic: pure
  functions over prices and amounts.
- The keeper and the FDC tool: results and proofs relay the same way.

## Migration steps, in order

1. Introduce `PmwSigner implements LedgerGateway` next to `XrplExecutor`,
   selected by environment.
2. Replace the CREATE_MANDATE provisioning branch: request a PMW wallet,
   return its address as the deposit address.
3. Delete `wallet.ts`, `initSeed` and the seed guard; drop INIT_SEED from the
   contract and handlers.
4. Register the user as withdrawal cosigner; keep the enclave as the trigger
   evaluator and order composer.
5. Add `ReferencedPaymentNonexistence` to prove a missed settlement against
   an operator bond.

Honest status: the `PmwSigner` is not implemented, because there is no API to
implement it against. What exists today is the seam it plugs into, exercised
by 85 tests through the same `LedgerGateway` interface the fake ledger uses.
