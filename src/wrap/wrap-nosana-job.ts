/**
 * wrapNosanaJob — submit a job to the Nosana network and await a Receipt.
 *
 * Wallet loading priority:
 *   1. walletPath file — JSON array [b0, b1, …, b63] or base58 string
 *   2. env var named by walletEnvVar (default: NOSANA_WALLET_PRIVATE_KEY) — same formats
 *
 * OUTCOME MODEL
 * =============
 * chain_state  — the on-chain terminal state from @nosana/sdk mapJob():
 *                COMPLETED = node submitted a result (workload may still have failed)
 *                STOPPED   = job halted before the node submitted any result
 *
 * outcome_code — derived from BOTH chain_state AND the IPFS result content:
 *   ok          COMPLETED + result.status === 'success' (or no result to check)
 *   job_error   COMPLETED + result.status === 'failed' (application failure, e.g. OOM, exit 1)
 *   host_error  COMPLETED + result indicates infrastructure failure (hostShutDown, etc.)
 *   failed      STOPPED on-chain
 *   timeout     observer poll window closed before terminal state; chain state unknown
 *   unknown     COMPLETED but IPFS fetch failed or result was unparseable
 *
 * COST
 * ====
 * cost_nos = NET NOS debit from the poster's wallet = escrow deposit minus refund.
 * Computed from the wallet ATA balance before listing and after settlement.
 * This is NOT job.price (which is the market's per-second rate).
 *
 * STATE NOTE: @nosana/sdk jobs.get() returns state as a STRING after mapJob()
 * transforms numeric codes via jobStateMapping: 0→'QUEUED', 1→'RUNNING',
 * 2→'COMPLETED', 3→'STOPPED'. Never compare state to numeric constants.
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import type { Receipt, OutcomeCode, ChainState } from '../types/receipt.js';

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

// @nosana/sdk jobs.get() maps numeric states to these strings via mapJob().
// NEVER compare job.state to numeric constants — the mapping happens inside the SDK.
const STATE_RUNNING   = 'RUNNING';
const STATE_COMPLETED = 'COMPLETED';
const STATE_STOPPED   = 'STOPPED';

const NOS_MINT = 'nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7';

/** Internal lifecycle state tracked during polling. */
interface LifecycleState {
  job_id:      string;
  market:      string;
  host:        string | null;
  posted_at:   string;
  claimed_at:  string | null;
  started_at:  string | null;
  settled_at:  string | null;
  result_hash: string | null;
  ipfs_cid:    string | null;
  cost_nos:    number | null;
  chain_state: ChainState | null;
  outcome_code: OutcomeCode | null;
  transitions: Array<{ state: string; at: string }>;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Derive the associated NOS token account address for a wallet pubkey.
 * Returns null on any error so cost_nos falls back to null gracefully.
 */
async function getAtaBalance(
  connection: { getTokenAccountBalance(ata: unknown): Promise<{ value: { amount: string } }> },
  walletPubkey: unknown,
): Promise<number | null> {
  try {
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token') as {
      getAssociatedTokenAddressSync(mint: unknown, owner: unknown): unknown;
    };
    const { PublicKey } = await import('@solana/web3.js') as { PublicKey: new(s: string) => unknown };
    const mintPk = new PublicKey(NOS_MINT);
    const ata = getAssociatedTokenAddressSync(mintPk, walletPubkey);
    const bal = await connection.getTokenAccountBalance(ata);
    return Number(bal.value.amount);
  } catch {
    return null;
  }
}

/**
 * Wrap a Nosana job definition: post it, poll for lifecycle transitions, and
 * return a Receipt when the job reaches a terminal state.
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

  // ── Capture pre-listing ATA balance for accurate cost_nos ────────────────
  const connection = (client as unknown as { solana: { connection: unknown; wallet: { publicKey: unknown } } })
    .solana?.connection;
  const walletPubkey = (client as unknown as { solana: { wallet: { publicKey: unknown } } })
    .solana?.wallet?.publicKey;
  const preBalance = connection && walletPubkey
    ? await getAtaBalance(connection as Parameters<typeof getAtaBalance>[0], walletPubkey)
    : null;

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
    ipfs_cid:    null,
    cost_nos:    null,
    chain_state: null,
    outcome_code: null,
    transitions: [{ state: 'POSTED', at: posted_at }],
  };

  // ── Poll for lifecycle ────────────────────────────────────────────────────
  const deadline = Date.now() + timeoutMs;
  let lastState  = '';

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    const job = await client.jobs.get(job_id) as NosanaJob;
    // jobs.get() maps numeric codes to strings via mapJob():
    //   0→'QUEUED', 1→'RUNNING', 2→'COMPLETED', 3→'STOPPED'
    const jobState = String(job.state).toUpperCase();

    // Record every state transition with timestamp
    if (jobState !== lastState) {
      const at = nowIso();
      state.transitions.push({ state: jobState, at });
      process.stderr.write(`[nosana-receipts] ${job_id} → ${jobState}  ${at}\n`);
      lastState = jobState;
    }

    if (job.node && !state.host) {
      state.host       = String(job.node);  // PublicKey.toString() → base58
      state.claimed_at = nowIso();
    }
    if (jobState === STATE_RUNNING && !state.started_at) {
      state.started_at = nowIso();
    }

    if (jobState === STATE_COMPLETED && !state.outcome_code) {
      state.chain_state = 'COMPLETED';
      state.settled_at  = nowIso();

      // cost_nos: ATA delta (actual net debit), falls back to null
      if (preBalance != null && connection && walletPubkey) {
        const postBalance = await getAtaBalance(
          connection as Parameters<typeof getAtaBalance>[0], walletPubkey,
        );
        if (postBalance != null) state.cost_nos = preBalance - postBalance;
      }

      // Thread the IPFS CID — available from the job account while it's still open.
      // Store it before the account may close, so callers can re-fetch without
      // re-querying the job account (which is swept after settlement).
      if (job.ipfsResult) state.ipfs_cid = job.ipfsResult;

      // Fetch result artifact from IPFS
      let ipfsContent: unknown = null;
      if (job.ipfsResult) {
        try {
          ipfsContent = await client.ipfs.retrieve(job.ipfsResult);
          state.result_hash = createHash('sha256')
            .update(JSON.stringify(ipfsContent))
            .digest('hex');
        } catch {
          // result_hash stays null; outcome becomes 'unknown' below
        }
      }

      // Derive outcome_code from result content
      state.outcome_code = deriveOutcomeCode(ipfsContent);
    }

    if (jobState === STATE_STOPPED && !state.outcome_code) {
      state.chain_state = 'STOPPED';
      state.outcome_code = 'failed';
      state.settled_at   = nowIso();
      if (preBalance != null && connection && walletPubkey) {
        const postBalance = await getAtaBalance(
          connection as Parameters<typeof getAtaBalance>[0], walletPubkey,
        );
        if (postBalance != null) state.cost_nos = preBalance - postBalance;
      }
    }

    if (state.outcome_code) break;
  }

  // ── Timeout ───────────────────────────────────────────────────────────────
  if (!state.outcome_code) {
    state.outcome_code = 'timeout';
    state.settled_at   = nowIso();
    state.chain_state  = null; // unknown at poll-window close
    state.transitions.push({ state: 'POLL_TIMEOUT', at: state.settled_at });
    // Attempt to delist — may fail if claimed; non-fatal
    try {
      await client.jobs.delist(job_id);
      state.transitions.push({ state: 'DELIST_OK', at: nowIso() });
    } catch {
      state.transitions.push({ state: 'DELIST_FAILED', at: nowIso() });
    }
  }

  return buildReceipt(state);
}

/**
 * Derive outcome_code from IPFS result content.
 *
 * Nosana's FlowState JSON has a top-level `status` field ('success'|'failed')
 * and per-op `diagnostics.reason` flags (hostShutDown, jobStopped, jobExpired).
 * Chain COMPLETED means the node submitted a result, but the workload or host
 * may still have failed.
 */
function deriveOutcomeCode(ipfsContent: unknown): OutcomeCode {
  if (ipfsContent == null) {
    // No IPFS result — COMPLETED on chain but content unavailable
    return 'unknown';
  }
  const result = ipfsContent as {
    status?: string;
    opStates?: Array<{
      diagnostics?: { reason?: { hostShutDown?: boolean; jobExpired?: boolean } };
      logs?: Array<{ type?: string; log?: string }>;
    }>;
  };

  // Check for SDK-level host/infra failure signal
  const hostShutDown = result.opStates?.some(
    op => op.diagnostics?.reason?.hostShutDown === true,
  );
  if (hostShutDown) return 'host_error';

  // Check for probe hard-fail on host infrastructure (e.g. CUDA device not visible).
  // The probe emits 'FATAL: ...' to stderr only when the host failed to provide
  // an advertised resource — it is not an application error in the job definition.
  const fatalHostFailure = result.opStates?.some(op =>
    op.logs?.some(l => l.type === 'stderr' && l.log?.trimStart().startsWith('FATAL:')),
  );
  if (fatalHostFailure) return 'host_error';

  if (result.status === 'success') return 'ok';
  if (result.status === 'failed')  return 'job_error';

  // status present but unknown value, or structure unexpected
  return 'unknown';
}

function buildReceipt(s: LifecycleState): Receipt {
  return {
    receipt_version: '0.1.0',
    provider:        'nosana',
    job_id:          s.job_id,
    market:          s.market,
    host:            s.host,
    gpu_class:       null,
    posted_at:       s.posted_at,
    claimed_at:      s.claimed_at,
    started_at:      s.started_at,
    settled_at:      s.settled_at,
    result_hash:     s.result_hash,
    ipfs_cid:        s.ipfs_cid,
    cost_nos:        s.cost_nos,
    chain_state:     s.chain_state,
    outcome_code:    s.outcome_code ?? 'unknown',
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
// Runtime types from @nosana/sdk after mapJob() transformation.
// Despite the Job typedef, state is a string and node/price are objects.
interface NosanaJob {
  state:       string;           // 'QUEUED'|'RUNNING'|'COMPLETED'|'STOPPED' after mapJob
  node?:       { toString(): string };   // PublicKey object at runtime
  price?:      { valueOf(): number };    // BN object — PER-SECOND RATE, not total cost
  ipfsResult?: string;           // IPFS CID string after solHashToIpfsHash
}
