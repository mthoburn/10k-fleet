/**
 * Tests for wrapNosanaJob using a mock Nosana client injected via module mock.
 * No real network calls; no wallet files required.
 *
 * SDK state constants (from @nosana/sdk jobStateMapping):
 *   0 = QUEUED, 1 = RUNNING, 2 = COMPLETED, 3 = STOPPED
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import receiptSchema from '../src/schema/receipt.schema.json';

// ── Mock @nosana/sdk before importing the subject ─────────────────────────────

const mockList    = vi.fn();
const mockGet     = vi.fn();
const mockDelist  = vi.fn();
const mockRetrieve = vi.fn();

vi.mock('@nosana/sdk', () => ({
  Client: class MockClient {
    jobs = { list: mockList, get: mockGet, delist: mockDelist };
    ipfs = { retrieve: mockRetrieve };
  },
}));

// ── Mock fs.readFileSync for the wallet path ──────────────────────────────────

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: (path: string, _enc: string) => {
      if (path === '/mock/keypair.json') return JSON.stringify(Array(64).fill(0));
      return actual.readFileSync(path, _enc as BufferEncoding);
    },
  };
});

// ── Import subject AFTER mocks ────────────────────────────────────────────────

import { wrapNosanaJob } from '../src/wrap/wrap-nosana-job.js';

const JOB_DEF = { version: '0.1', ops: [] };
const OPTS    = {
  market:         'MarketPubkey123',
  walletPath:     '/mock/keypair.json',
  pollIntervalMs: 10,
  timeoutMs:      500,
  jobTimeoutSecs: 60,
};

// ── AJV schema validator ──────────────────────────────────────────────────────

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validateReceipt = ajv.compile(receiptSchema);

beforeEach(() => {
  mockList.mockReset();
  mockGet.mockReset();
  mockDelist.mockReset();
  mockRetrieve.mockReset();
});

describe('wrapNosanaJob', () => {
  it('returns a receipt with outcome_code "ok" on a successful run', async () => {
    mockList.mockResolvedValue({ tx: 'txSig', job: 'JobPubkey_ok', run: 'runSig' });
    mockRetrieve.mockResolvedValue({ benchmark_id: 'test', measured_tflops: 40 });
    mockGet
      .mockResolvedValueOnce({ state: 0 })                        // QUEUED
      .mockResolvedValueOnce({ state: 1 })                        // RUNNING
      .mockResolvedValueOnce({
        state:      2,                                             // COMPLETED
        node:       'NodePubkey_ok',
        price:      0.014,
        ipfsResult: 'QmSomeCid',
      });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);

    expect(r.receipt_version).toBe('0.1.0');
    expect(r.provider).toBe('nosana');
    expect(r.job_id).toBe('JobPubkey_ok');
    expect(r.market).toBe(OPTS.market);
    expect(r.outcome_code).toBe('ok');
    expect(r.host).toBe('NodePubkey_ok');
    expect(r.result_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.posted_at).toBeTruthy();
    expect(r.claimed_at).toBeTruthy();
    expect(r.started_at).toBeTruthy();
    expect(r.settled_at).toBeTruthy();
    expect(r.cost_nos).toBe(0.014);
  });

  it('passes market through to the receipt (schema blocker fix)', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_mkt', run: 'run' });
    mockGet.mockResolvedValue({ state: 3 }); // STOPPED

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.market).toBe('MarketPubkey123');
    expect(r.market.length).toBeGreaterThan(0);
  });

  it('output passes JSON Schema validation', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_schema', run: 'run' });
    mockRetrieve.mockResolvedValue({ foo: 'bar' });
    mockGet.mockResolvedValue({
      state:      2,
      node:       'NodePubkeyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
      price:      0.005,
      ipfsResult: 'QmValidCid',
    });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    const valid = validateReceipt(r);
    expect(valid, JSON.stringify(validateReceipt.errors)).toBe(true);
  });

  it('schema validation passes for a timeout receipt (all nullables null)', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_timeout_schema', run: 'run' });
    mockGet.mockResolvedValue({ state: 0 }); // always QUEUED → timeout
    mockDelist.mockResolvedValue({});

    const r = await wrapNosanaJob(JOB_DEF, { ...OPTS, timeoutMs: 50, pollIntervalMs: 10 });
    expect(r.outcome_code).toBe('timeout');
    const valid = validateReceipt(r);
    expect(valid, JSON.stringify(validateReceipt.errors)).toBe(true);
  });

  it('returns outcome_code "failed" when the job state is STOPPED (3)', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_fail', run: 'run' });
    mockGet.mockResolvedValue({ state: 3 });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.outcome_code).toBe('failed');
    expect(r.settled_at).toBeTruthy();
    expect(r.result_hash).toBeNull();
  });

  it('returns outcome_code "timeout" when the job does not settle within timeoutMs', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_to', run: 'run' });
    mockGet.mockResolvedValue({ state: 0 }); // never completes
    mockDelist.mockResolvedValue({});

    const r = await wrapNosanaJob(JOB_DEF, { ...OPTS, timeoutMs: 50, pollIntervalMs: 10 });
    expect(r.outcome_code).toBe('timeout');
    expect(r.settled_at).toBeTruthy();
    expect(mockDelist).toHaveBeenCalledWith('JobPubkey_to');
  });

  it('host is null when the job is queued and never claimed before terminal state', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_nohost', run: 'run' });
    mockGet.mockResolvedValue({ state: 3 }); // STOPPED with no node

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.host).toBeNull();
    expect(r.gpu_class).toBeNull(); // sdk does not expose gpu_class
  });

  it('result_hash is sha256 of JSON-stringified IPFS content', async () => {
    const ipfsContent = { ops: [{ logs: [{ log: 'hello' }] }] };
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_hash', run: 'run' });
    mockRetrieve.mockResolvedValue(ipfsContent);
    mockGet.mockResolvedValue({ state: 2, node: 'N', price: 0, ipfsResult: 'QmHash' });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.result_hash).toMatch(/^[0-9a-f]{64}$/);
    // deterministic — same content → same hash
    const { createHash } = await import('crypto');
    const expected = createHash('sha256').update(JSON.stringify(ipfsContent)).digest('hex');
    expect(r.result_hash).toBe(expected);
  });

  it('result_hash is null when IPFS retrieve fails', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_ipfsfail', run: 'run' });
    mockRetrieve.mockRejectedValue(new Error('IPFS unreachable'));
    mockGet.mockResolvedValue({ state: 2, node: 'N', price: 0, ipfsResult: 'QmBad' });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.outcome_code).toBe('ok');
    expect(r.result_hash).toBeNull();
  });

  it('falls back to env var wallet when walletPath is not set', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_env', run: 'run' });
    mockGet.mockResolvedValue({ state: 3 });

    const envKey = 'TEST_WALLET_VAR_XYZ';
    process.env[envKey] = JSON.stringify(Array(64).fill(1));
    try {
      const r = await wrapNosanaJob(JOB_DEF, { ...OPTS, walletPath: undefined, walletEnvVar: envKey });
      expect(r.job_id).toBe('JobPubkey_env');
    } finally {
      delete process.env[envKey];
    }
  });

  it('throws when no wallet source is available', async () => {
    await expect(
      wrapNosanaJob(JOB_DEF, { ...OPTS, walletPath: undefined, walletEnvVar: 'DEFINITELY_NOT_SET_XYZ_ABC' }),
    ).rejects.toThrow(/wallet/i);
  });
});
