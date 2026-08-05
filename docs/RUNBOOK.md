# Kerb runbook

Everything needed to take the extension from this checkout to a live TEE machine
on Coston2. Steps marked HUMAN cannot be done by the agent: they install
toolchains outside the project tree, hold a funded key, or touch the chain.

## 1. Toolchain

Docker is available. Foundry and Go are not installed on the host, so the
project ships shims that run them in their official images with the project
bind-mounted. Put them first on PATH and every `scripts/*.sh` works unmodified:

```bash
export PATH="$PWD/scripts/bin:$PATH"
forge --version    # runs ghcr.io/foundry-rs/foundry:stable
go version         # runs golang:1.25.12
```

Caches land in `.scratch/` and files are written as the calling user, so nothing
is created outside the project tree and nothing is installed on the host. If you
prefer real installs (`foundryup`, `apt install golang-go`), drop the directory
from PATH and everything behaves the same.

| Tool | Check | Status |
|---|---|---|
| Docker | `docker info` | present, 29.5.3 with Compose v5.1.4 |
| Foundry | `forge --version` | via shim |
| Go | `go version` | via shim |
| Node | `node --version` | present, v22 |
| Tunnel | `cloudflared --version` | MISSING (HUMAN): named tunnel, or ngrok reserved domain |

## 1b. Three build breakages found by actually building

The stock fce-sign images do not build as shipped once the versions are current.
All three are fixed in this tree; they are recorded because the symptoms are
opaque.

1. **tee-proxy v0.0.21 needs Go >= 1.25.8.** The builder was pinned to
   `golang:1.25.1-alpine` with `GOTOOLCHAIN=local`, so `go mod download` fails
   with `go.mod requires go >= 1.25.8`. Builder bumped to `golang:1.25.12-alpine`.

2. **tee-proxy moved its sample config.** `config.example.toml` sits in
   `config/` from v0.0.21 on, so the old `COPY` path fails the build with
   `"/app/tee-proxy/config.example.toml": not found`. Path corrected.

3. **`SOURCE_DATE_EPOCH=0` breaks the extension image.** `start-services.sh`
   derives it from `git log`, and falls back to `0` when there is no repo or no
   commit. The runtime stage then asks snapshot.debian.org for a snapshot dated
   1969 and apt dies with exit 100. `SOURCE_DATE_EPOCH=1785542400`
   (2026-08-01T00:00:00Z) is now pinned in the env file, which also makes the
   build date stable instead of following the latest commit.

A standalone `solc` 0.8.36 in `.scratch/bin/solc` was used before Foundry was
reachable. `forge build` is the real path and now works through the shim.

## 2. Version pins

The Coston2 data providers reject votes from stale nodes, which leaves the
instruction queue permanently empty. Two pins were bumped for that reason:

- `typescript/Dockerfile`: tee-node `v0.0.21` to `v0.0.24` (identical to the
  tee-node develop branch, verified by ref comparison).
- `proxy/Dockerfile`: tee-proxy `v0.0.18` to `v0.0.21` (current tee-proxy main).

Still pending, because it needs a Go toolchain to regenerate `go.sum` (HUMAN):

```bash
cd go/tools && go get github.com/flare-foundation/tee-node@v0.0.24 \
                     github.com/flare-foundation/tee-proxy@v0.0.21 && go mod tidy
cd ../  && go get github.com/flare-foundation/tee-node@v0.0.24 && go mod tidy
```

## 3. Fill the environment (HUMAN)

`.env.local.coston2` is gitignored and has three values marked FILL ME:

1. `DEPLOYMENT_PRIVATE_KEY`: funded from https://faucet.flare.network/coston2, hex, no `0x`.
2. `INITIAL_OWNER`: the address of that key. A mismatch makes post-build fail
   with `InvalidGovernanceHash`.
3. `EXT_PROXY_URL`: the HTTPS URL of a named tunnel to host port 6674.

Never a trycloudflare quick tunnel. Data providers push to whatever URL is
stored on-chain, and a quick tunnel changes hostname on every restart, which is
what leaves machines stuck at `INITIALIZED` with a dead address registered.

The indexer credentials are already in `config/proxy/extension_proxy.coston2.docker.toml`
(gitignored). Nothing to do there.

## 4. Bring the stack up

```bash
bash ./scripts/use-chain.sh local coston2 typescript   # copies the env over .env
bash ./scripts/pre-build.sh                            # deploy + register extension
bash ./scripts/start-services.sh --chain coston2       # redis, ext-proxy, extension-tee
bash ./scripts/post-build.sh                           # allow version, governance, register TEE
```

`post-build.sh` already calls `register-tee -command rRap`. The capital `R`
requests a fresh attestation challenge on re-runs, which is what avoids
`Verification.ChallengeExpired`.

Check the machine reached production:

```bash
source .env
curl -s "$EXT_PROXY_URL/info" | jq '.machineData'
cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
  "getTeeMachineStatus(address)(uint8)" <teeId>        # 1 INITIALIZED, 2 PRODUCTION
```

If it sits at `INITIALIZED`, compare the URL registered on-chain against the one
being served:

```bash
cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
  "getTeeMachine(address)((address,address,string))" <teeId>
```

After any tunnel rotation: update `EXT_PROXY_URL`, re-run `use-chain.sh`, restart
the stack, re-run `post-build.sh`.

## 5. Kerb-specific bring-up

Two steps the scaffold does not have, because Kerb holds enclave key material.

1. Declare the TEE identity to the contract, so it accepts signed results.
   The address comes from the proxy `/info` endpoint; only the deployer can set it.

   ```bash
   source .env && source config/extension.env
   cast send $INSTRUCTION_SENDER "setTeeAddress(address)" <tee-signing-address> \
     --rpc-url "$CHAIN_URL" --private-key "$DEPLOYMENT_PRIVATE_KEY"
   ```

2. Install the enclave master seed, from which every per-mandate XRPL account is
   derived. Send 32 random bytes, ECIES-encrypted to the TEE public key from
   `/info`, through `initSeed(bytes)`. Re-sending the same seed after a restart
   rebuilds exactly the same deposit addresses; sending a different one strands
   funds held at the old addresses. `scripts/test.sh` does exactly this.

3. Point the contract at FDC so the funding and settlement proofs can be
   verified. On Coston2:

   ```bash
   cast send $INSTRUCTION_SENDER "setFdcVerification(address)" \
     0x906507E0B64bcD494Db73bd0459d1C667e14B933 \
     --rpc-url "$CHAIN_URL" --private-key "$DEPLOYMENT_PRIVATE_KEY"
   ```

One XRPL prerequisite on the user side: a sell mandate's proceeds are an issued
currency, and a Payment never creates a trustline (a DEX fill does, which is why
the deposit account needs none). The payout address must therefore hold a line
to the issuer before settlement: `node dist/tools/market-maker.js trustline
<payoutSeed>` opens it for the demo. The engine warns at execution start and
settlement reports the miss explicitly instead of burning a doomed payment.

The `_standardAddressHash` encoding, `keccak256(bytes(address))` over the
classic address string with no case normalisation, matches the state connector
spec (sourceRef: songbird-state-connector-protocol,
specs/attestations/external-chains/standardAddress.md). A cross-check against a
real `XRPPayment` proof (compare `receivingAddressHash` for a known deposit)
remains a cheap sanity step during the first live run.

## 6. How a result reaches the chain

FCC has no result callback. `sendInstructions` ends the on-chain path; the TEE
answer is stored on the proxy and read over HTTP. Something off-chain has to
relay it back in a second transaction. Kerb exposes two ingest functions that
verify the TEE signature themselves and are otherwise permissionless:

- `applyProvision(resultData, actionId, submissionTag, status, signature)`
- `applyExecutionReport(resultData, actionId, submissionTag, status, signature)`

Only `Data`, `ID`, `SubmissionTag` and `Status` are covered by the TEE
signature. Everything else in an `ActionResult`, including `Log`, `OPType` and
`OPCommand`, is unsigned and is never trusted on-chain.

Result polling: `GET {EXT_PROXY_URL}/action/result/{actionId}?submissionTag=submit`,
which returns 404 until a result is stored.

Pending results: the proxy keeps status `0` and `1` as permanently final, and
only accepts a transient update whose status is strictly higher than the stored
one. So intermediate updates must increase, and the final delivery must be `0`
or `1`. The published guidance saying to send decreasing statuses is wrong: it
makes every update after the first silently rejected.

## 7. Verification available without Docker

```bash
cd typescript && npx tsc --noEmit && npx vitest run   # 28 tests
../.scratch/bin/solc --via-ir --optimize --bin --abi \
  -o ../.scratch/solc-out --overwrite ../contracts/InstructionSender.sol
```

Note on the standards' final-check snippet: the documented dash grep
(`grep -rnP "\xe2\x80\x94|..."`) silently matches nothing in this environment,
because PCRE reads `\xe2` as codepoint U+00E2 rather than the byte, so it
reports every file clean. Use this instead, verified to return 2 on a
known-bad file and 0 on a clean one:

```bash
grep -rnP '\x{2014}|\x{2013}' <files>
```

`\x{2014}` is the PCRE codepoint form. The byte form `\xe2\x80\x94` is what
fails, including under `LC_ALL=C`.
