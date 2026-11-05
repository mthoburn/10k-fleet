/**
 * Core receipt types for nosana-receipts v0.1.x
 *
 * Venue-agnostic: `provider` identifies the compute venue ("nosana"),
 * not a specific node. `host` is the node's on-chain public key once claimed.
 *
 * Lifecycle timestamps (posted_at, claimed_at, started_at, settled_at) are
 * observer-side wall-clock times recorded by the polling process — they are
 * NOT on-chain timestamps. Use them for approximate duration measurement only.
 *
 * OUTCOME MODEL
 * =============
 * chain_state  — the on-chain terminal state as mapped by @nosana/sdk mapJob():
 *                COMPLETED = node submitted a result (workload may still have failed)
 *                STOPPED   = job was cancelled/halted before the node submitted
 *
 * outcome_code — derived from chain_state AND the job result content (IPFS):
 *   ok          chain COMPLETED + container exit 0 (or no IPFS available to check)
 *   job_error   chain COMPLETED + container exited non-zero (application failure)
 *   host_error  chain COMPLETED + result indicates host/infra failure
 *   failed      chain STOPPED (node halted the job before submitting a result)
 *   timeout     observer poll window expired; chain state unknown at that point
 *   unknown     chain COMPLETED but result content could not be fetched/parsed
 *
 * cost_nos
 * ========
 * The NET NOS debit from the poster's wallet: deposit minus escrow refund.
 * This equals market_price_per_second × actual_seconds_billed (not the full
 * deposit, which is market_price × timeout_secs).
 * Note: job.price from @nosana/sdk is the PER-SECOND RATE, not the net cost.
 */

export type ChainState = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'STOPPED';

export type OutcomeCode =
  | 'ok'          // COMPLETED + exit 0
  | 'job_error'   // COMPLETED + container non-zero exit
  | 'host_error'  // COMPLETED + host/infra failure in result
  | 'failed'      // STOPPED on-chain
  | 'timeout'     // observer poll window expired
  | 'unknown';    // COMPLETED but result content not parseable

/** A receipt for a single compute job posted to a decentralised GPU market. */
export interface Receipt {
  /** Semver receipt schema version. */
  receipt_version: '0.1.0';
  /** Venue identifier, e.g. "nosana". */
  provider: string;
  /** Job public key on the venue's chain. */
  job_id: string;
  /** Market public key the job was posted to. */
  market: string;
  /** Node's on-chain public key. Null until the job is claimed. */
  host: string | null;
  /** GPU class reported by the venue, e.g. "RTX 4090". Null if unavailable. */
  gpu_class: string | null;
  /**
   * ISO-8601 observer-side wall-clock time when the job was posted.
   * Not an on-chain timestamp.
   */
  posted_at: string;
  /**
   * ISO-8601 observer-side wall-clock time when a node was first seen on the job.
   * Not an on-chain timestamp. Null if not yet claimed.
   */
  claimed_at: string | null;
  /**
   * ISO-8601 observer-side wall-clock time when state first reached RUNNING.
   * Not an on-chain timestamp. Null if not yet started.
   */
  started_at: string | null;
  /**
   * ISO-8601 observer-side wall-clock time when the job reached a terminal state.
   * Not an on-chain timestamp. Null if still running.
   */
  settled_at: string | null;
  /**
   * SHA-256 hex digest of the job result artifact retrieved from IPFS.
   * Null until the job settles with an outcome that has a result.
   */
  result_hash: string | null;
  /**
   * IPFS CID of the raw job result artifact (Nosana FlowState JSON).
   * Null if the job did not reach COMPLETED or the CID was unavailable.
   * Use this to re-fetch the full result without re-querying the (possibly closed) job account.
   */
  ipfs_cid: string | null;
  /**
   * Net NOS debit from the poster's wallet: deposit minus escrow refund.
   * Units: NOS base units (6 decimals). Null if unavailable.
   * This is NOT job.price from @nosana/sdk — that field is the per-second rate.
   */
  cost_nos: number | null;
  /** Final on-chain job state as returned by @nosana/sdk mapJob(). Null on observer timeout. */
  chain_state: ChainState | null;
  /** Terminal outcome derived from chain_state and job result content. */
  outcome_code: OutcomeCode;
}

/**
 * Correctness check using a tolerance comparison against reference float values.
 *
 * FP32 GPU results may differ by 1–2 ULPs across hardware families due to
 * FMA and tree-reduction ordering. Rounding the fingerprint to fixed decimal
 * places provides a natural tolerance band without requiring exact bit-identity.
 *
 * The reference values must be established from a canonical torch/GPU run;
 * they are NOT interchangeable with numpy/CPU values because torch.rand() and
 * np.random.rand() produce different sequences for the same integer seed.
 */
export interface CorrectnessCheck {
  /** Identifier for the benchmark, e.g. "gemm-fp32-1024-seed42-torch". */
  benchmark_id: string;
  /**
   * Pre-committed reference values from a canonical GPU run.
   * Null until the first successful GPU probe establishes the reference.
   */
  reference_sum:     number | null;
  reference_norm:    number | null;
  reference_corners: [number, number, number, number] | null;
  /**
   * Max relative error tolerance: |measured - reference| / |reference| ≤ epsilon_rel.
   * Chosen to absorb ULP differences across GPU generations while rejecting
   * wrong computations. Default: 1e-4 (0.01%).
   */
  epsilon_rel: number;
  /** Measured values from the job output. Null if job did not complete. */
  measured_sum:     number | null;
  measured_norm:    number | null;
  measured_corners: [number, number, number, number] | null;
  /** Max relative error observed across sum/norm/corners. Null if unmeasured. */
  max_rel_error: number | null;
  /**
   * True if all measured values are within epsilon_rel of their references.
   * Null if reference is not yet established or job did not complete.
   */
  pass: boolean | null;
}

/** Performance check: measured TFLOPS vs a gpu_class reference. */
export interface PerformanceCheck {
  /** GPU class the reference is keyed to, e.g. "RTX 4090". */
  gpu_class: string;
  /** Expected TFLOPS for this gpu_class (from the committed reference table). */
  reference_tflops: number | null;
  /** Measured TFLOPS from the job's output. Null if unmeasured. */
  measured_tflops: number | null;
  /**
   * measured_tflops / reference_tflops, clamped to [0, 1].
   * 1.0 = at or above reference; <0.8 suggests degraded GPU or slow node.
   * Null if either TFLOPS value is null.
   */
  conformance_score: number | null;
}

/** GPU device info recorded inside the probe container. */
export interface DeviceInfo {
  device_name: string;
  cuda_version: string;
  driver_version: string;
  compute_capability: string;
}

/**
 * A Receipt extended with the results of a conformance probe.
 * Both correctness and performance fields are optional so a receipt can
 * carry one, both, or neither probe result.
 */
export interface ProbeReceipt extends Receipt {
  device_info?: DeviceInfo;
  correctness?: CorrectnessCheck;
  performance?: PerformanceCheck;
}
