# Self-contained build of tee-proxy. Clones tee-proxy from GitHub at build time
# so no local sibling repos are needed.
#
# TEE_PROXY_VERSION MUST stay aligned with the extension's Go-module pins
# (go/tools/go.mod): tee-proxy v0.0.18. tee-proxy's own go.mod transitively pins
# the matching tee-node and go-flare-common line, so building it with
# `go mod download` pulls the exact governance-aware node code the extension-tee
# image uses, so no separate tee-node clone or replace directive is needed.
# Override via build arg when bumping both sides together.

# Pinned to v0.0.21, the current tee-proxy main (develop is one commit ahead).
# The Go deploy CLIs under go/tools still pin tee-proxy v0.0.18 in go.mod; that
# bump needs a Go toolchain to regenerate go.sum, see docs/RUNBOOK.md.
ARG TEE_PROXY_VERSION=v0.0.21

# tee-proxy v0.0.21 declares `go >= 1.25.8` in its go.mod, and the image sets
# GOTOOLCHAIN=local, so a 1.25.1 builder fails at `go mod download`. Pinned to
# the current 1.25 patch rather than the bare minimum, since this builder only
# produces the proxy binary and is not part of the attested TEE image.
FROM golang:1.25.12-alpine AS builder

RUN apk add --no-cache git

ARG TEE_PROXY_VERSION

WORKDIR /app
RUN git clone --depth 1 --branch ${TEE_PROXY_VERSION} https://github.com/flare-foundation/tee-proxy.git

WORKDIR /app/tee-proxy
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -a -o main ./cmd/proxy

# Final stage
FROM alpine:latest

WORKDIR /app

COPY --from=builder /app/tee-proxy/main .
# tee-proxy moved the sample config into config/ between v0.0.18 and v0.0.21.
# It only seeds a default: docker-compose mounts the real chain config over
# /app/config/config.toml at run time.
COPY --from=builder /app/tee-proxy/config/config.example.toml ./config/config.toml

RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 6661
EXPOSE 6662

CMD ["./main"]
