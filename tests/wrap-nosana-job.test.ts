/**
 * Tests for wrapNosanaJob using a mock Nosana client injected via module mock.
 * No real network calls; no wallet files required.
 *
 * SDK state constants (from @nosana/sdk mapJob() transformation):
 *   'QUEUED', 'RUNNING', 'COMPLETED', 'STOPPED'
 *   NEVER use numeric values — mapJob() converts them to strings before returning.
 *
 * cost_nos is null in all mock tests because MockClient has no solana.connection,
 * so the ATA balance delta path is unavailable. Real runs use the ATA approach.
 *
 * outcome_code is derived from BOTH chain_state AND IPFS result content:
 *   COMPLETED + { status: 'success' } → 'ok'
 *   COMPLETED + { status: 'failed'  } → 'job_error'
 *   COMPLETED + no ipfsResult / fetch error → 'unknown'
 *   STOPPED                           → 'failed'
 *   poll timeout                      → 'timeout'
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
    // No solana.connection — cost_nos will be null in mock tests
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
  it('returns outcome_code "ok" when chain COMPLETED + IPFS status success', async () => {
    mockList.mockResolvedValue({ tx: 'txSig', job: 'JobPubkey_ok', run: 'runSig' });
    // IPFS content must include status:'success' to get outcome_code 'ok'
    mockRetrieve.mockResolvedValue({ status: 'success', opStates: [] });
    mockGet
      .mockResolvedValueOnce({ state: 'QUEUED' })
      .mockResolvedValueOnce({ state: 'RUNNING' })
      .mockResolvedValueOnce({
        state:      'COMPLETED',
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
    expect(r.chain_state).toBe('COMPLETED');
    expect(r.host).toBe('NodePubkey_ok');
    expect(r.result_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.posted_at).toBeTruthy();
    expect(r.claimed_at).toBeTruthy();
    expect(r.started_at).toBeTruthy();
    expect(r.settled_at).toBeTruthy();
    // cost_nos is null in mock tests — MockClient has no solana.connection for ATA delta
    expect(r.cost_nos).toBeNull();
  });

  it('returns outcome_code "job_error" when chain COMPLETED + IPFS status failed', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_joberr', run: 'run' });
    mockRetrieve.mockResolvedValue({ status: 'failed', opStates: [{ exitCode: 1 }] });
    mockGet.mockResolvedValue({
      state: 'COMPLETED', node: 'N', price: 0, ipfsResult: 'QmFailed',
    });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.outcome_code).toBe('job_error');
    expect(r.chain_state).toBe('COMPLETED');
    expect(r.result_hash).toMatch(/^[0-9a-f]{64}$/); // IPFS content was fetched
  });

  it('returns outcome_code "host_error" when diagnostics.reason.hostShutDown is true', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_host', run: 'run' });
    mockRetrieve.mockResolvedValue({
      status: 'failed',
      opStates: [{ diagnostics: { reason: { hostShutDown: true } } }],
    });
    mockGet.mockResolvedValue({ state: 'COMPLETED', node: 'N', ipfsResult: 'QmHost' });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.outcome_code).toBe('host_error');
    expect(r.chain_state).toBe('COMPLETED');
  });

  it('returns outcome_code "host_error" when probe emits FATAL to stderr', async () => {
    // Probe hard-fails with FATAL: on stderr when host accepted GPU market job
    // but did not expose CUDA device to container. hostShutDown is false in this case.
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_fatal', run: 'run' });
    mockRetrieve.mockResolvedValue({
      status: 'failed',
      opStates: [{
        diagnostics: { reason: { hostShutDown: false } },
        logs: [
          { type: 'stderr', log: 'FATAL: no CUDA device visible — aborting GPU conformance probe' },
        ],
      }],
    });
    mockGet.mockResolvedValue({ state: 'COMPLETED', node: 'GxsvrdX', ipfsResult: 'QmFatal' });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.outcome_code).toBe('host_error');
    expect(r.chain_state).toBe('COMPLETED');
    expect(r.ipfs_cid).toBe('QmFatal');
  });

  it('returns outcome_code "unknown" when IPFS content has no recognisable status', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_unknown', run: 'run' });
    mockRetrieve.mockResolvedValue({ foo: 'bar' }); // no status field
    mockGet.mockResolvedValue({ state: 'COMPLETED', node: 'N', ipfsResult: 'QmUnk' });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.outcome_code).toBe('unknown');
    expect(r.chain_state).toBe('COMPLETED');
    expect(r.result_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns outcome_code "unknown" when IPFS retrieve fails', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_ipfsfail', run: 'run' });
    mockRetrieve.mockRejectedValue(new Error('IPFS unreachable'));
    mockGet.mockResolvedValue({ state: 'COMPLETED', node: 'N', price: 0, ipfsResult: 'QmBad' });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.outcome_code).toBe('unknown');
    expect(r.chain_state).toBe('COMPLETED');
    expect(r.result_hash).toBeNull(); // fetch failed so no hash
  });

  it('passes market through to the receipt (schema blocker fix)', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_mkt', run: 'run' });
    mockGet.mockResolvedValue({ state: 'STOPPED' });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.market).toBe('MarketPubkey123');
    expect(r.market.length).toBeGreaterThan(0);
  });

  it('output passes JSON Schema validation (COMPLETED + success)', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_schema', run: 'run' });
    mockRetrieve.mockResolvedValue({ status: 'success', opStates: [] });
    mockGet.mockResolvedValue({
      state:      'COMPLETED',
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
    mockGet.mockResolvedValue({ state: 'QUEUED' }); // always QUEUED → timeout
    mockDelist.mockResolvedValue({});

    const r = await wrapNosanaJob(JOB_DEF, { ...OPTS, timeoutMs: 50, pollIntervalMs: 10 });
    expect(r.outcome_code).toBe('timeout');
    expect(r.chain_state).toBeNull();
    const valid = validateReceipt(r);
    expect(valid, JSON.stringify(validateReceipt.errors)).toBe(true);
  });

  it('returns outcome_code "failed" + chain_state STOPPED when job is STOPPED', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_fail', run: 'run' });
    mockGet.mockResolvedValue({ state: 'STOPPED' });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.outcome_code).toBe('failed');
    expect(r.chain_state).toBe('STOPPED');
    expect(r.settled_at).toBeTruthy();
    expect(r.result_hash).toBeNull();
  });

  it('returns outcome_code "timeout" + chain_state null when poll window expires', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_to', run: 'run' });
    mockGet.mockResolvedValue({ state: 'QUEUED' }); // never completes
    mockDelist.mockResolvedValue({});

    const r = await wrapNosanaJob(JOB_DEF, { ...OPTS, timeoutMs: 50, pollIntervalMs: 10 });
    expect(r.outcome_code).toBe('timeout');
    expect(r.chain_state).toBeNull();
    expect(r.settled_at).toBeTruthy();
    expect(mockDelist).toHaveBeenCalledWith('JobPubkey_to');
  });

  it('host is null when the job is never claimed before terminal state', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_nohost', run: 'run' });
    mockGet.mockResolvedValue({ state: 'STOPPED' }); // STOPPED with no node

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.host).toBeNull();
    expect(r.gpu_class).toBeNull();
  });

  it('result_hash is sha256 of JSON-stringified IPFS content', async () => {
    const ipfsContent = { status: 'success', opStates: [{ logs: [{ log: 'hello' }] }] };
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_hash', run: 'run' });
    mockRetrieve.mockResolvedValue(ipfsContent);
    mockGet.mockResolvedValue({ state: 'COMPLETED', node: 'N', price: 0, ipfsResult: 'QmHash' });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.result_hash).toMatch(/^[0-9a-f]{64}$/);
    const { createHash } = await import('crypto');
    const expected = createHash('sha256').update(JSON.stringify(ipfsContent)).digest('hex');
    expect(r.result_hash).toBe(expected);
  });

  it('falls back to env var wallet when walletPath is not set', async () => {
    mockList.mockResolvedValue({ tx: 'tx', job: 'JobPubkey_env', run: 'run' });
    mockGet.mockResolvedValue({ state: 'STOPPED' });

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
