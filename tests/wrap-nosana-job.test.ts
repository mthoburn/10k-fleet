/**
 * Tests for wrapNosanaJob using a mock Nosana client injected via module mock.
 * No real network calls; no wallet files required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @nosana/sdk before importing the subject ─────────────────────────────

const mockPost = vi.fn();
const mockGet  = vi.fn();

vi.mock('@nosana/sdk', () => ({
  Client: class MockClient {
    jobs = { post: mockPost, get: mockGet };
    async init() {}
  },
}));

vi.mock('@solana/web3.js', () => ({
  Keypair: {
    fromSecretKey: (_bytes: Uint8Array) => ({ publicKey: { toString: () => 'MockKeypub' } }),
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

// ── Import subject AFTER mocks are in place ───────────────────────────────────

import { wrapNosanaJob } from '../src/wrap/wrap-nosana-job.js';

const JOB_DEF = { version: '0.1', type: 'container', ops: [] };
const OPTS = { market: 'MarketPubkey123', walletPath: '/mock/keypair.json', pollIntervalMs: 10, timeoutMs: 500 };

beforeEach(() => {
  mockPost.mockReset();
  mockGet.mockReset();
});

describe('wrapNosanaJob', () => {
  it('returns a receipt with outcome_code "ok" on a successful run', async () => {
    mockPost.mockResolvedValue({ publicKey: { toString: () => 'JobPubkey_ok' } });
    mockGet
      .mockResolvedValueOnce({ state: 'queued' })
      .mockResolvedValueOnce({ state: 'running' })
      .mockResolvedValueOnce({
        state:    'completed',
        node:     'NodePubkey_ok',
        gpuClass: 'RTX 4090',
        result:   '{"benchmark_id":"test","result_hash":"aabbcc","measured_tflops":40}',
        costNos:  0.014,
      });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);

    expect(r.receipt_version).toBe('0.1.0');
    expect(r.provider).toBe('nosana');
    expect(r.job_id).toBe('JobPubkey_ok');
    expect(r.outcome_code).toBe('ok');
    expect(r.host).toBe('NodePubkey_ok');
    expect(r.gpu_class).toBe('RTX 4090');
    expect(r.result_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.posted_at).toBeTruthy();
    expect(r.claimed_at).toBeTruthy();
    expect(r.started_at).toBeTruthy();
    expect(r.settled_at).toBeTruthy();
    expect(r.cost_usd).toBe(0.014);
  });

  it('returns outcome_code "failed" when the job fails', async () => {
    mockPost.mockResolvedValue({ publicKey: { toString: () => 'JobPubkey_fail' } });
    mockGet.mockResolvedValue({ state: 'failed' });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.outcome_code).toBe('failed');
    expect(r.settled_at).toBeTruthy();
    expect(r.result_hash).toBeNull();
  });

  it('returns outcome_code "cancelled" when the job is cancelled', async () => {
    mockPost.mockResolvedValue({ publicKey: { toString: () => 'JobPubkey_cancel' } });
    mockGet.mockResolvedValue({ state: 'cancelled' });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.outcome_code).toBe('cancelled');
  });

  it('returns outcome_code "timeout" when the job does not settle within timeoutMs', async () => {
    mockPost.mockResolvedValue({ publicKey: { toString: () => 'JobPubkey_timeout' } });
    mockGet.mockResolvedValue({ state: 'queued' }); // never completes

    const r = await wrapNosanaJob(JOB_DEF, { ...OPTS, timeoutMs: 50, pollIntervalMs: 10 });
    expect(r.outcome_code).toBe('timeout');
    expect(r.settled_at).toBeTruthy();
  });

  it('host and gpu_class are null when the job is posted but not yet claimed', async () => {
    mockPost.mockResolvedValue({ publicKey: { toString: () => 'JobPubkey_queued' } });
    mockGet.mockResolvedValue({ state: 'failed' }); // fail before claim

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.host).toBeNull();
    expect(r.gpu_class).toBeNull();
  });

  it('result_hash is a sha256 of the job stdout on success', async () => {
    const stdout = 'hello world';
    mockPost.mockResolvedValue({ publicKey: { toString: () => 'JobPubkey_hash' } });
    mockGet.mockResolvedValue({ state: 'completed', result: stdout });

    const r = await wrapNosanaJob(JOB_DEF, OPTS);
    expect(r.result_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
