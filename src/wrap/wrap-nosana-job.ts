/**
 * wrapNosanaJob — submit a job to the Nosana network and await a Receipt.
 *
 * Reads a Solana keypair from `walletPath` (a JSON array of 64 bytes).
 * Never prints or returns the keypair bytes.
 *
 * Usage:
 *   const receipt = await wrapNosanaJob(jobDef, {
 *     market: 'RTX_4090_MARKET_PUBKEY',
 *     walletPath: '/path/to/keypair.json',
 *   });
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import type { Receipt, OutcomeCode } from '../types/receipt.js';

export interface WrapOptions {
  /** Market public key to post the job to (e.g. RTX 4090 market). */
  market: string;
  /**
   * Path to a Solana keypair JSON file (array of 64 bytes).
   * Provided by the caller at runtime — never committed or printed by this library.
   */
  walletPath: string;
  /** Solana RPC endpoint. Defaults to mainnet-beta. */
  rpcUrl?: string;
  /** How often to poll for job status updates, in ms. Default 6000. */
  pollIntervalMs?: number;
  /** Abort and emit a 'timeout' receipt after this many ms. Default 300_000. */
  timeoutMs?: number;
}

/** Internal lifecycle state tracked during polling. */
interface LifecycleState {
  job_id: string;
  host: string | null;
  gpu_class: string | null;
  posted_at: string;
  claimed_at: string | null;
  started_at: string | null;
  settled_at: string | null;
  result_hash: string | null;
  cost_usd: number | null;
  outcome_code: OutcomeCode | null;
  stdout: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Wrap a Nosana job definition: post it, poll for lifecycle transitions, and
 * return a Receipt when the job reaches a terminal state.
 *
 * The receipt is emitted on outcome_code: ok | failed | timeout | cancelled.
 * No budget logic is applied — billing is handled by the Nosana protocol.
 *
 * @param jobDef   Nosana job definition object (compatible with @nosana/sdk).
 * @param options  Market, wallet path, and tuning parameters.
 */
export async function wrapNosanaJob(
  jobDef: Record<string, unknown>,
  options: WrapOptions,
): Promise<Receipt> {
  const {
    market,
    walletPath,
    rpcUrl = 'https://api.mainnet-beta.solana.com',
    pollIntervalMs = 6_000,
    timeoutMs = 300_000,
  } = options;

  // ── Load wallet (never logged or returned) ───────────────────────────────
  const keypairBytes: number[] = JSON.parse(readFileSync(walletPath, 'utf-8'));

  // ── Lazy-load @nosana/sdk to keep this package optional-peer ────────────
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = await import('@nosana/sdk') as { Client: NosanaClientCtor };
  const { Keypair } = await import('@solana/web3.js') as { Keypair: SolanaKeypairCtor };

  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairBytes));

  const client = new Client({ rpc: rpcUrl });
  await client.init(keypair, market);

  // ── Post job ─────────────────────────────────────────────────────────────
  const posted_at = nowIso();
  const jobAccount = await client.jobs.post(jobDef);
  const job_id: string = jobAccount.publicKey.toString();

  const state: LifecycleState = {
    job_id,
    host: null,
    gpu_class: null,
    posted_at,
    claimed_at: null,
    started_at: null,
    settled_at: null,
    result_hash: null,
    cost_usd: null,
    outcome_code: null,
    stdout: null,
  };

  // ── Poll for lifecycle ────────────────────────────────────────────────────
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    const job = await client.jobs.get(job_id);

    if (job.node && !state.host) {
      state.host = String(job.node);
      state.claimed_at = nowIso();
    }
    if (job.gpuClass && !state.gpu_class) {
      state.gpu_class = String(job.gpuClass);
    }
    if (job.state === 'running' && !state.started_at) {
      state.started_at = nowIso();
    }
    if (job.state === 'cancelled' && !state.outcome_code) {
      state.outcome_code = 'cancelled';
      state.settled_at = nowIso();
    }
    if (job.state === 'failed' && !state.outcome_code) {
      state.outcome_code = 'failed';
      state.settled_at = nowIso();
    }
    if (job.state === 'completed' && !state.outcome_code) {
      state.outcome_code = 'ok';
      state.settled_at = nowIso();
      state.stdout = job.result ?? null;
      if (state.stdout) {
        state.result_hash = createHash('sha256')
          .update(state.stdout)
          .digest('hex');
      }
      if (job.costNos != null) {
        state.cost_usd = Number(job.costNos);
      }
    }

    if (state.outcome_code) break;
  }

  // ── Timeout ───────────────────────────────────────────────────────────────
  if (!state.outcome_code) {
    state.outcome_code = 'timeout';
    state.settled_at = nowIso();
  }

  return buildReceipt(state);
}

function buildReceipt(s: LifecycleState): Receipt {
  return {
    receipt_version: '0.1.0',
    provider: 'nosana',
    job_id: s.job_id,
    market: '', // set by caller context — not available from job state
    host: s.host,
    gpu_class: s.gpu_class,
    posted_at: s.posted_at,
    claimed_at: s.claimed_at,
    started_at: s.started_at,
    settled_at: s.settled_at,
    result_hash: s.result_hash,
    cost_usd: s.cost_usd,
    outcome_code: s.outcome_code ?? 'failed',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Minimal type stubs for lazy-loaded SDK ───────────────────────────────────
// These exist only to satisfy TypeScript without making @nosana/sdk a hard dep.
// The actual types come from the installed package at runtime.

interface NosanaClient {
  init(keypair: unknown, market: string): Promise<void>;
  jobs: {
    post(jobDef: unknown): Promise<{ publicKey: { toString(): string } }>;
    get(jobId: string): Promise<NosanaJobState>;
  };
}
interface NosanaClientCtor {
  new(opts: { rpc: string }): NosanaClient;
}
interface NosanaJobState {
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  node?: string;
  gpuClass?: string;
  result?: string;
  costNos?: number | string;
}
interface SolanaKeypairCtor {
  fromSecretKey(bytes: Uint8Array): unknown;
}
