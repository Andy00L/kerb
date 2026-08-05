/** Kerb extension configuration constants. */

export const VERSION = '0.1.0';

/**
 * OPType and OPCommand constants. Every string here must match the bytes32
 * constant of the same name in contracts/InstructionSender.sol character for
 * character. A mismatch is the documented first cause of "unsupported op type"
 * and "unsupported op command" responses, because Solidity sends bytes32("...")
 * and the framework compares the same right-padded encoding.
 */
export const OP_TYPE_KERB = 'KERB';
export const OP_COMMAND_INIT_SEED = 'INIT_SEED';
export const OP_COMMAND_CREATE_MANDATE = 'CREATE_MANDATE';
export const OP_COMMAND_CANCEL_MANDATE = 'CANCEL_MANDATE';
export const OP_COMMAND_REPORT = 'REPORT';

/**
 * Longest life a mandate may request, in seconds (30 days). The enclave holds
 * per-mandate key material for the whole window, so an unbounded expiry would
 * mean unbounded in-memory retention.
 */
export const MAX_MANDATE_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/**
 * Largest total size a single mandate may trade, in drops of XRP.
 * 1 XRP = 1_000_000 drops (sourceRef: https://xrpl.org/basic-data-types.html).
 * Capped at 100_000 XRP so a malformed decimal cannot create an order that
 * would drain a funded deposit account in one fill.
 */
export const DROPS_PER_XRP = 1_000_000n;
export const MAX_MANDATE_TOTAL_DROPS = 100_000n * DROPS_PER_XRP;

/** Smallest tradeable slice, in drops. Below this the fill is dust. */
export const MIN_SLICE_DROPS = 1n * DROPS_PER_XRP;

/**
 * Bounds on the randomisation applied to slice size and timing. Jitter hides
 * the exact shape of the order; above 50 percent it would distort the mandate
 * the user actually asked for.
 */
export const MAX_JITTER_PERCENT = 50;

/** Bounds on the slippage guard, in percent. */
export const MIN_SLIPPAGE_PERCENT = 0.01;
export const MAX_SLIPPAGE_PERCENT = 10;

/** Bounds on the DCA schedule. */
export const MIN_DCA_INTERVAL_SECONDS = 60;
export const MAX_DCA_EXECUTIONS = 1000;

/**
 * Consecutive feed reads that must agree before a trigger fires. The FTSOv2
 * block-latency feed updates about every 1.8 seconds, so three readings damp
 * single-block noise without adding a meaningful delay.
 */
export const TRIGGER_CONFIRMATIONS = 3;

/** How long to wait for the TEE node sign server before giving up, in ms. */
export const NODE_REQUEST_TIMEOUT_MS = 30_000;
