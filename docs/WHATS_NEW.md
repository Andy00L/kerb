# What was built during the program

The hackathon rules ask existing projects to state what is new. Kerb inverts
the question: nothing existed before the program. The repository starts from
the official `fce-extension-scaffold` / `fce-sign` base, and every Kerb line
is dated inside the program window (opened 2026-08-04, deadline 2026-08-14).

## Timeline

| Date | What landed | Evidence |
| ---- | ----------- | -------- |
| 2026-08-04 | Plan and stack verification against the Flare docs | [`KERB_BUILD_PLAN.md`](../KERB_BUILD_PLAN.md), sources section dated 2026-08-04 |
| 2026-08-05 | The full build: contract, enclave extension, tools, webapp | commit `09bef29` |
| 2026-08-05 | Go shim host-path mount fix, TeeInstructionsSent receipt scan | commit `4a38584` |
| 2026-08-05 | Live-run hardening on Coston2: result tags, IPv4 pin, XRPL timeouts, report tool, runbook lessons | commit `fe1158a` |
| 2026-08-11 | Security audit pass: measured fills, go-ethereum-compatible browser ECIES, live deposit reads, seed replacement guard, strict hex, bounded FDC wait, local cancel wiring | this working tree, submission docs included |

## Inherited from the scaffold (disclosed, not claimed)

| Area | Paths |
| ---- | ----- |
| Extension HTTP framework | `typescript/src/base/` (server, types, encoding, crypto) |
| Bring-up scripts | `scripts/` (pre-build, start-services, post-build, use-chain, test) |
| Deploy and registration tooling frame | `go/tools/pkg/` (configs, fccutils, support, validate), `go/internal/` |
| Reference implementation | `python/` (unused by Kerb) |
| Reproducibility and deployment docs | `REPRODUCIBILITY.md`, `DEPLOYMENT_STEPS.md`, `TESTNET_DEPLOYMENT.md` |

Scaffold pieces Kerb had to repair to build at all (documented in
[`RUNBOOK.md`](RUNBOOK.md), section 1b): the tee-proxy builder Go version,
the moved `config.example.toml` path, and the `SOURCE_DATE_EPOCH=0` apt
snapshot failure. Version pins bumped to tee-node v0.0.24 and tee-proxy
v0.0.21 because Coston2 providers reject stale nodes.

## New for Kerb

| Area | Paths | Content |
| ---- | ----- | ------- |
| Contract logic | `contracts/InstructionSender.sol`, `contracts/interfaces/` | Mandate registry and lifecycle, TEE result ingestion with signature verification, FDC XRPPayment gates with replay protection (489 lines plus four interfaces) |
| Enclave application | `typescript/src/app/` | Mandate schema validation, per-mandate key derivation, FTSOv2 trigger monitor, execution engine with measured fills, XRPL order construction, supervisor (10 modules) |
| Off-chain tools | `typescript/src/tools/` | Keeper relay, four-step FDC proof pipeline, demo market maker and issuer |
| Test suite | `typescript/src/__tests__/` | 85 tests: validation, triggers, slicing, slippage rounding, partial fills, settlement legs, handler flows, confidentiality of /state |
| dApp | `webapp/` | Next.js App Router app: landing, dashboard, create flow with client-side ECIES sealing, mandate detail with live on-chain reads |
| Go additions | `go/tools/cmd/run-test/`, `go/tools/cmd/request-report/`, `go/tools/pkg/utils/instructions.go` | Kerb E2E flow (seed, mandate, cancel), report requester, instruction send helpers |
| Documentation | `README.md`, `ARCHITECTURE.md`, `docs/RUNBOOK.md`, `docs/WHATS_NEW.md`, `docs/PMW_MIGRATION.md`, `docs/UI_DESIGN_SYSTEM.md` | Product page, architecture and trust model, live bring-up with the lessons that cost debugging time, this file, the PMW mapping |

## What the audit pass changed (2026-08-11)

Full-codebase security pass before submission; every fix carries tests where
the behavior is testable:

1. **Measured fills.** `tesSUCCESS` on an immediate-or-cancel order does not
   mean it filled; the engine now counts the account's validated XRP balance
   change instead of the requested slice (`measureFilledDrops`).
2. **Browser ECIES rewritten.** The webapp encrypted with an incompatible
   scheme (HKDF + AES-256-GCM) and read the TEE key from a field the proxy
   never serves; `webapp/src/lib/ecies.ts` now implements the exact
   go-ethereum `ECIES_AES128_SHA256` format and keys from
   `machineData.publicKey`. Instruction calls now carry the required fee.
3. **Live deposit addresses.** In live mode the dApp shows only the deposit
   address read from `getMandate`, never a placeholder a user could fund by
   mistake; create resolves the real mandate id from the MandateCreated
   event.
4. **Master seed guard.** The enclave refuses a different seed while mandates
   hold derived keys, closing the documented fund-stranding foot-gun.
5. **Strict hex parsing.** Malformed payload hex now fails loudly instead of
   being silently truncated by `Buffer.from(_, "hex")`.
6. **Bounded FDC wait.** The finalisation poll times out after 20 minutes
   instead of spinning forever on a dead round.
7. **Cancel wiring.** The CANCEL_MANDATE instruction now stops the engine
   directly instead of waiting for the next status read.
