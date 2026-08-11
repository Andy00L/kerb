import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { Wallet } from 'xrpl';
import { Server } from '../base/server.js';
import { stringToBytes32Hex } from '../base/types.js';
import { bytesToHex } from '../base/encoding.js';
import {
  OP_COMMAND_CANCEL_MANDATE,
  OP_COMMAND_CREATE_MANDATE,
  OP_COMMAND_INIT_SEED,
  OP_TYPE_KERB,
  VERSION,
} from '../app/config.js';
import {
  register,
  reportState,
  resetState,
  setClock,
  setSignPort,
} from '../app/handlers.js';
import { deriveMandateWallet } from '../app/wallet.js';

const NOW_UNIX_SECONDS = 1_800_000_000;
const CONTRACT_ADDRESS = '0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE';
const XRP_USD_FEED_ID = '0x015852502f55534400000000000000000000000000';
const PAYOUT_ADDRESS = Wallet.fromEntropy(new Uint8Array(16).fill(3)).classicAddress;
const MASTER_SEED = new Uint8Array(32).fill(7);

/** Plaintext the mock node hands back for the next decrypt call. */
let decryptPlaintext: Uint8Array = new Uint8Array();
let decryptShouldFail = false;
let mockNode: http.Server;
let server: Server;

function startMockNode(): Promise<number> {
  return new Promise((resolve) => {
    mockNode = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/decrypt') {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        if (decryptShouldFail) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'can not decrypt' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            decryptedMessage: Buffer.from(decryptPlaintext).toString('base64'),
          }),
        );
      });
    });
    mockNode.listen(0, '127.0.0.1', () => {
      resolve((mockNode.address() as AddressInfo).port);
    });
  });
}

function buildActionBody(
  opType: string,
  opCommand: string,
  originalMessage: string,
): string {
  const dataFixed = {
    instructionId: '0x01',
    opType: stringToBytes32Hex(opType),
    opCommand: stringToBytes32Hex(opCommand),
    originalMessage,
  };
  return JSON.stringify({
    data: {
      id: '0x02',
      type: 'instruction',
      submissionTag: 'submit',
      message: bytesToHex(new TextEncoder().encode(JSON.stringify(dataFixed))),
    },
  });
}

function buildMandateJson(): string {
  return JSON.stringify({
    v: 1,
    pair: 'XRP/USD',
    side: 'sell',
    kind: 'stop',
    trigger: { feedId: XRP_USD_FEED_ID, op: 'lte', price: '2.85' },
    size: { total: '250', slice: '50', jitterPct: 20 },
    bound: { maxSlippagePct: 1 },
    expiry: NOW_UNIX_SECONDS + 3600,
    payout: { xrplAddress: PAYOUT_ADDRESS },
  });
}

function buildCreateEnvelope(mandateId: bigint, ciphertext: string): string {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'bytes' }],
    [mandateId, CONTRACT_ADDRESS as `0x${string}`, ciphertext as `0x${string}`],
  );
}

async function postAction(body: string): Promise<[number, Record<string, unknown>]> {
  const [status, payload] = await server.handleRequestDirect('POST', '/action', body);
  return [status, payload as Record<string, unknown>];
}

async function installMasterSeed(): Promise<void> {
  decryptPlaintext = MASTER_SEED;
  await postAction(
    buildActionBody(OP_TYPE_KERB, OP_COMMAND_INIT_SEED, bytesToHex(new Uint8Array([1, 2]))),
  );
}

beforeEach(async () => {
  resetState();
  decryptShouldFail = false;
  const port = await startMockNode();
  setSignPort(String(port));
  setClock(() => NOW_UNIX_SECONDS);
  server = new Server('0', String(port), VERSION, register, reportState);
});

afterEach(async () => {
  await new Promise<void>((resolve) => mockNode.close(() => resolve()));
});

describe('KERB handlers', () => {
  it('installs the master seed then provisions a mandate deposit address', async () => {
    await installMasterSeed();

    const stateBefore = (await server.handleRequestDirect('GET', '/state', ''))[1] as {
      state: { hasMasterSeed: boolean };
    };
    expect(stateBefore.state.hasMasterSeed).toBe(true);

    decryptPlaintext = new TextEncoder().encode(buildMandateJson());
    const envelope = buildCreateEnvelope(1n, '0xdeadbeef');
    const [httpStatus, result] = await postAction(
      buildActionBody(OP_TYPE_KERB, OP_COMMAND_CREATE_MANDATE, envelope),
    );

    expect(httpStatus).toBe(200);
    expect(result.status).toBe(1);

    const [contractAddress, mandateId, depositAddress] = decodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'string' }],
      result.data as `0x${string}`,
    );
    expect(contractAddress.toLowerCase()).toBe(CONTRACT_ADDRESS.toLowerCase());
    expect(mandateId).toBe(1n);
    expect(depositAddress).toBe(deriveMandateWallet(MASTER_SEED, 1n).classicAddress);
  });

  it('refuses to provision before the master seed is installed', async () => {
    decryptPlaintext = new TextEncoder().encode(buildMandateJson());
    const [, result] = await postAction(
      buildActionBody(
        OP_TYPE_KERB,
        OP_COMMAND_CREATE_MANDATE,
        buildCreateEnvelope(1n, '0xdeadbeef'),
      ),
    );
    expect(result.status).toBe(0);
    expect(String(result.log)).toContain('master seed not installed');
  });

  it('rejects a mandate whose schema does not validate', async () => {
    await installMasterSeed();
    decryptPlaintext = new TextEncoder().encode(JSON.stringify({ v: 1, rogue: true }));

    const [, result] = await postAction(
      buildActionBody(
        OP_TYPE_KERB,
        OP_COMMAND_CREATE_MANDATE,
        buildCreateEnvelope(2n, '0xdeadbeef'),
      ),
    );
    expect(result.status).toBe(0);
    expect(String(result.log)).toContain('mandate rejected');
  });

  it('refuses to provision the same mandate id twice', async () => {
    await installMasterSeed();
    decryptPlaintext = new TextEncoder().encode(buildMandateJson());
    const envelope = buildCreateEnvelope(3n, '0xdeadbeef');

    const [, first] = await postAction(
      buildActionBody(OP_TYPE_KERB, OP_COMMAND_CREATE_MANDATE, envelope),
    );
    expect(first.status).toBe(1);

    const [, second] = await postAction(
      buildActionBody(OP_TYPE_KERB, OP_COMMAND_CREATE_MANDATE, envelope),
    );
    expect(second.status).toBe(0);
    expect(String(second.log)).toContain('already provisioned');
  });

  it('reports a decryption failure distinctly from a schema failure', async () => {
    await installMasterSeed();
    decryptShouldFail = true;

    const [, result] = await postAction(
      buildActionBody(
        OP_TYPE_KERB,
        OP_COMMAND_CREATE_MANDATE,
        buildCreateEnvelope(4n, '0xdeadbeef'),
      ),
    );
    expect(result.status).toBe(0);
    expect(String(result.log)).toContain('decryption failed');
  });

  it('cancels a known mandate and refuses an unknown one', async () => {
    await installMasterSeed();
    decryptPlaintext = new TextEncoder().encode(buildMandateJson());
    await postAction(
      buildActionBody(
        OP_TYPE_KERB,
        OP_COMMAND_CREATE_MANDATE,
        buildCreateEnvelope(5n, '0xdeadbeef'),
      ),
    );

    const cancelEnvelope = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }],
      [5n, CONTRACT_ADDRESS as `0x${string}`],
    );
    const [, cancelled] = await postAction(
      buildActionBody(OP_TYPE_KERB, OP_COMMAND_CANCEL_MANDATE, cancelEnvelope),
    );
    expect(cancelled.status).toBe(1);

    const unknownEnvelope = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }],
      [99n, CONTRACT_ADDRESS as `0x${string}`],
    );
    const [, unknown] = await postAction(
      buildActionBody(OP_TYPE_KERB, OP_COMMAND_CANCEL_MANDATE, unknownEnvelope),
    );
    expect(unknown.status).toBe(0);
    expect(String(unknown.log)).toContain('unknown mandate');
  });

  it('keeps confidential mandate detail out of the reported state', async () => {
    await installMasterSeed();
    decryptPlaintext = new TextEncoder().encode(buildMandateJson());
    await postAction(
      buildActionBody(
        OP_TYPE_KERB,
        OP_COMMAND_CREATE_MANDATE,
        buildCreateEnvelope(6n, '0xdeadbeef'),
      ),
    );

    const stateJson = JSON.stringify(reportState());
    expect(stateJson).toContain('"mandateCount":1');
    expect(stateJson).not.toContain('2.85');
    expect(stateJson).not.toContain(PAYOUT_ADDRESS);
    expect(stateJson).not.toContain(deriveMandateWallet(MASTER_SEED, 6n).classicAddress);
  });

  it('refuses to replace the master seed while mandates hold derived keys', async () => {
    await installMasterSeed();
    decryptPlaintext = new TextEncoder().encode(buildMandateJson());
    await postAction(
      buildActionBody(
        OP_TYPE_KERB,
        OP_COMMAND_CREATE_MANDATE,
        buildCreateEnvelope(7n, '0xdeadbeef'),
      ),
    );

    // A different seed would re-derive every deposit address: refused.
    decryptPlaintext = new Uint8Array(32).fill(9);
    const [, replaced] = await postAction(
      buildActionBody(OP_TYPE_KERB, OP_COMMAND_INIT_SEED, bytesToHex(new Uint8Array([1]))),
    );
    expect(replaced.status).toBe(0);
    expect(String(replaced.log)).toContain('refusing to replace the master seed');

    // Replaying the SAME seed is the documented restart recovery: accepted.
    decryptPlaintext = MASTER_SEED;
    const [, replayed] = await postAction(
      buildActionBody(OP_TYPE_KERB, OP_COMMAND_INIT_SEED, bytesToHex(new Uint8Array([1]))),
    );
    expect(replayed.status).toBe(1);
  });

  it('answers an unknown op type with HTTP 501', async () => {
    const [status] = await server.handleRequestDirect(
      'POST',
      '/action',
      buildActionBody('NOPE', 'NOPE', '0x00'),
    );
    expect(status).toBe(501);
  });
});
