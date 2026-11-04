/**
 * wrapNosanaJob — submit a job to the Nosana network and await a Receipt.
 *
 * Wallet loading priority:
 *   1. walletPath file — JSON array [b0, b1, …, b63] or base58 string
 *   2. env var named by walletEnvVar (default: NOSANA_WALLET_PRIVATE_KEY) — same formats
 *
 * The @nosana/sdk Client handles both formats internally via getWallet().
 * Never prints or returns the keypair bytes.
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import type { Receipt, OutcomeCode } from '../types/receipt.js';

export interface WrapOptions {
  /** Market public key to post the job to (e.g. RTX 4090 market). */
  market: string;
  /**
   * Path to a keypair file — JSON array of 64 bytes or base58 string.
   * If omitted, falls back to the env var named by walletEnvVar.
   */
  walletPath?: string;
  /**
   * Name of the env var that holds the keypair (JSON array or base58).
   * Default: 'NOSANA_WALLET_PRIVATE_KEY'. Only used when walletPath is unset.
   */
  walletEnvVar?: string;
  /** Solana RPC endpoint. Defaults to mainnet-beta. */
  rpcUrl?: string;
  /** How often to poll for job status updates, in ms. Default 6000. */
  pollIntervalMs?: number;
  /** Abort and emit a 'timeout' receipt after this many ms. Default 300_000. */
  timeoutMs?: number;
  /** On-chain job timeout in seconds. Default 1800. */
  jobTimeoutSecs?: number;
}

// Numeric job states from @nosana/sdk jobStateMapping
const STATE_RUNNING   = 1;
const STATE_COMPLETED = 2;
const STATE_STOPPED   = 3; // failed, cancelled, or forcibly stopped

/** Internal lifecycle state tracked during polling. */
interface LifecycleState {
  job_id:     string;
  market:     string;
  host:       string | null;
  posted_at:  string;
  claimed_at: string | null;
  started_at: string | null;
  settled_at: string | null;
  result_hash: string | null;
  cost_nos:   number | null;
  outcome_code: OutcomeCode | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Wrap a Nosana job definition: post it, poll for lifecycle transitions, and
 * return a Receipt when the job reaches a terminal state.
 *
 * Timestamps are observer-side wall-clock times from the polling process —
 * NOT on-chain timestamps. Use them for approximate duration measurement only.
 *
 * On timeout the job remains live on-chain. wrapNosanaJob attempts to delist
 * it via jobs.delist() but this may fail if the job has already been claimed.
 * Monitor the job address directly if precise on-chain cancellation matters.
 *
 * @param jobDef   Nosana job definition object (compatible with @nosana/sdk JobDefinition).
 * @param options  Market, wallet, and tuning parameters.
 */
export async function wrapNosanaJob(
  jobDef: Record<string, unknown>,
  options: WrapOptions,
): Promise<Receipt> {
  const {
    market,
    walletPath,
    walletEnvVar = 'NOSANA_WALLET_PRIVATE_KEY',
    pollIntervalMs = 6_000,
    timeoutMs      = 300_000,
    jobTimeoutSecs = 1_800,
  } = options;

  // ── Load wallet string (passed verbatim to @nosana/sdk; SDK decodes JSON or base58) ──
  let walletRaw: string;
  if (walletPath) {
    walletRaw = readFileSync(walletPath, 'utf-8').trim();
  } else {
    const val = process.env[walletEnvVar];
    if (!val) {
      throw new Error(
        `wrapNosanaJob: no wallet supplied — set walletPath or ${walletEnvVar} env var`,
      );
    }
    walletRaw = val.trim();
  }

  // ── Lazy-load @nosana/sdk (optional peer dep) ────────────────────────────
  const { Client } = await import('@nosana/sdk') as { Client: NosanaClientCtor };

  // SDK Client(environment, wallet, config?) — wallet accepts JSON string or base58 string
  const client = new Client('mainnet', walletRaw as unknown as never);

  // ── Post job ─────────────────────────────────────────────────────────────
  const posted_at = nowIso();
  // jobs.list() pins the job def to IPFS, submits on-chain, and returns job address
  const { job: job_id } = await client.jobs.list(jobDef, jobTimeoutSecs, market) as ListResult;

  const state: LifecycleState = {
    job_id,
    market,
    host:        null,
    posted_at,
    claimed_at:  null,
    started_at:  null,
    settled_at:  null,
    result_hash: null,
    cost_nos:    null,
    outcome_code: null,
  };

  // ── Poll for lifecycle ────────────────────────────────────────────────────
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    const job = await client.jobs.get(job_id) as NosanaJob;
    const jobState = typeof job.state === 'string' ? parseInt(job.state, 10) : job.state;

    if (job.node && !state.host) {
      state.host       = String(job.node);
      state.claimed_at = nowIso();
    }
    if (jobState === STATE_RUNNING && !state.started_at) {
      state.started_at = nowIso();
    }
    if (jobState === STATE_COMPLETED && !state.outcome_code) {
      state.outcome_code = 'ok';
      state.settled_at   = nowIso();
      if (job.price != null) state.cost_nos = Number(job.price);

      // Fetch result artifact from IPFS and hash its content
      if (job.ipfsResult) {
        try {
          const content = await client.ipfs.retrieve(job.ipfsResult);
          state.result_hash = createHash('sha256')
            .update(JSON.stringify(content))
            .digest('hex');
        } catch {
          // result_hash stays null if IPFS fetch fails
        }
      }
    }
    if (jobState === STATE_STOPPED && !state.outcome_code) {
      // STOPPED covers failed, cancelled, and forcibly stopped jobs
      state.outcome_code = 'failed';
      state.settled_at   = nowIso();
      if (job.price != null) state.cost_nos = Number(job.price);
    }

    if (state.outcome_code) break;
  }

  // ── Timeout ───────────────────────────────────────────────────────────────
  if (!state.outcome_code) {
    state.outcome_code = 'timeout';
    state.settled_at   = nowIso();
    // Attempt to delist — may fail if claimed; non-fatal
    try {
      await client.jobs.delist(job_id);
    } catch {
      // best-effort; job may still be live on-chain
    }
  }

  return buildReceipt(state);
}

function buildReceipt(s: LifecycleState): Receipt {
  return {
    receipt_version: '0.1.0',
    provider:        'nosana',
    job_id:          s.job_id,
    market:          s.market,
    host:            s.host,
    gpu_class:       null, // @nosana/sdk Job does not expose gpu_class; set by caller if needed
    posted_at:       s.posted_at,
    claimed_at:      s.claimed_at,
    started_at:      s.started_at,
    settled_at:      s.settled_at,
    result_hash:     s.result_hash,
    cost_nos:        s.cost_nos,
    outcome_code:    s.outcome_code ?? 'failed',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Minimal type stubs for lazy-loaded SDK ───────────────────────────────────

interface NosanaClient {
  jobs: {
    list(jobDef: unknown, timeoutSecs: number, market: string): Promise<ListResult>;
    get(jobId: string): Promise<NosanaJob>;
    delist(jobId: string): Promise<unknown>;
  };
  ipfs: {
    retrieve(hash: string): Promise<unknown>;
  };
}
interface NosanaClientCtor {
  new(environment: string, wallet: never): NosanaClient;
}
interface ListResult {
  tx:  string;
  job: string;
  run: string;
}
interface NosanaJob {
  state:      number | string;
  node?:      string;
  price?:     number | string;
  ipfsResult?: string;
}
