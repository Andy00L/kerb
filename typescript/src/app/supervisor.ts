/**
 * Engine supervisor.
 *
 * Watches the enclave's mandate store and runs one MandateEngine per mandate,
 * exactly once. It lives outside the instruction path: instructions only create
 * and cancel mandates, while execution is driven by the price feed.
 *
 * A mandate that finishes is settled straight away, so the payout transaction
 * exists for the FDC settlement proof to attest.
 */

import { Wallet } from 'xrpl';
import { MandateReader, MandateStatus } from './chain.js';
import { MandateEngine, type EngineDependencies } from './engine.js';
import { FtsoReader } from './ftso.js';
import { getMandateRecord, listMandateIds, recordExecutionProgress } from './handlers.js';
import type { ValidatedMandate } from './mandate.js';
import { XrplExecutor, type IssuedCurrency } from './xrpl.js';

/** Contract status values the engine is allowed to report. */
const STATUS_BY_OUTCOME = {
  filled: MandateStatus.Filled,
  expired: MandateStatus.Expired,
  cancelled: MandateStatus.Expired,
} as const;

/** How often to look for mandates that have no engine yet. */
export const SUPERVISOR_SCAN_INTERVAL_MS = 5_000;

/** Everything the supervisor needs from the environment. */
export interface SupervisorConfig {
  readonly chainUrl: string;
  readonly contractAddress: string;
  readonly xrplEndpoint: string;
  readonly counterCurrency: IssuedCurrency;
}

/**
 * Read the supervisor configuration from the environment.
 *
 * @returns The configuration, or null when the engine is not configured. A
 *          missing configuration is not an error: the extension still serves
 *          instructions, it simply does not trade.
 */
export function readSupervisorConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SupervisorConfig | null {
  const chainUrl = environment.CHAIN_URL;
  const contractAddress = environment.INSTRUCTION_SENDER;
  const xrplEndpoint = environment.XRPL_ENDPOINT;
  const currency = environment.KERB_COUNTER_CURRENCY;
  const issuer = environment.KERB_COUNTER_ISSUER;

  if (!chainUrl || !contractAddress || !xrplEndpoint || !currency || !issuer) {
    return null;
  }
  return {
    chainUrl,
    contractAddress,
    xrplEndpoint,
    counterCurrency: { currency, issuer },
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Start the supervisor loop.
 *
 * The returned function stops the loop after the current scan.
 */
export function startEngineSupervisor(config: SupervisorConfig): () => void {
  const ftsoReader = new FtsoReader(config.chainUrl);
  const mandateReader = new MandateReader(config.chainUrl, config.contractAddress);
  const xrplExecutor = new XrplExecutor(config.xrplEndpoint);

  const dependencies: EngineDependencies = {
    ftsoReader,
    mandateReader,
    xrplExecutor,
    randomFraction: () => Math.random(),
    nowUnixSeconds: () => Math.floor(Date.now() / 1000),
    sleep,
  };

  const running = new Set<string>();
  let stopped = false;

  const scan = async (): Promise<void> => {
    for (const mandateId of listMandateIds()) {
      const key = mandateId.toString();
      if (running.has(key)) {
        continue;
      }
      const record = getMandateRecord(mandateId);
      if (record === undefined) {
        continue;
      }

      running.add(key);
      void runMandate(mandateId, record.walletSeed, record.mandate, dependencies, config)
        .catch((engineError) => {
          console.log(`[startEngineSupervisor] mandate ${key} stopped: ${engineError}`);
        });
    }
  };

  void (async () => {
    while (!stopped) {
      try {
        await scan();
      } catch (scanError) {
        console.log(`[startEngineSupervisor] scan failed: ${scanError}`);
      }
      await sleep(SUPERVISOR_SCAN_INTERVAL_MS);
    }
  })();

  return () => {
    stopped = true;
  };
}

/**
 * Normalise an XRPL transaction hash for the bytes32 field of a report.
 * XRPL returns 64 uppercase hex characters with no prefix.
 */
export function toBytes32Hash(transactionHash: string): string {
  if (transactionHash === '') {
    return `0x${'0'.repeat(64)}`;
  }
  const body = transactionHash.startsWith('0x') ? transactionHash.slice(2) : transactionHash;
  return `0x${body.toLowerCase().padStart(64, '0')}`;
}

/** Run one mandate to its terminal state, then settle it. */
async function runMandate(
  mandateId: bigint,
  walletSeed: string,
  mandate: ValidatedMandate,
  dependencies: EngineDependencies,
  config: SupervisorConfig,
): Promise<void> {
  const wallet = Wallet.fromSeed(walletSeed);
  const engine = new MandateEngine(
    { mandateId, mandate, wallet, counterCurrency: config.counterCurrency },
    dependencies,
  );

  const outcome = await engine.run();
  const terminalStatus = STATUS_BY_OUTCOME[outcome];

  const publishProgress = (): void => {
    const report = engine.buildReport(terminalStatus);
    recordExecutionProgress(mandateId, {
      status: terminalStatus,
      filledDrops: report.filledDrops,
      lastTransactionHash: toBytes32Hash(report.lastTransactionHash),
    });
  };

  // Publish the trading outcome before settling, so a REPORT that arrives
  // during the payout still returns the filled size.
  publishProgress();

  const settlement = await engine.settle();
  for (const transactionHash of settlement.transactionHashes) {
    console.log(`[runMandate] mandate ${mandateId} settlement tx ${transactionHash}`);
  }
  for (const failure of settlement.failures) {
    console.log(`[runMandate] mandate ${mandateId} settlement incomplete: ${failure}`);
  }
  publishProgress();
}
