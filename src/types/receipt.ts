/**
 * Core receipt types for nosana-receipts v0.1.0
 *
 * Venue-agnostic: `provider` identifies the compute venue ("nosana"),
 * not a specific node. `host` is the node's on-chain public key once claimed.
 */

export type OutcomeCode = 'ok' | 'failed' | 'timeout' | 'cancelled';

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
  /** GPU class reported by the venue, e.g. "RTX 4090". Null until known. */
  gpu_class: string | null;
  /** ISO-8601 — when the job was posted to the market. */
  posted_at: string;
  /** ISO-8601 — when a node claimed the job. Null if not yet claimed. */
  claimed_at: string | null;
  /** ISO-8601 — when execution started. Null if not yet started. */
  started_at: string | null;
  /** ISO-8601 — when the job reached a terminal state. Null if still running. */
  settled_at: string | null;
  /**
   * SHA-256 hex digest of the job's output artifact.
   * Null until the job settles with outcome_code "ok".
   */
  result_hash: string | null;
  /** USD cost as reported by the venue. Null if unavailable. */
  cost_usd: number | null;
  /** Terminal outcome. */
  outcome_code: OutcomeCode;
}

/** Correctness check: SHA-256 of a deterministic computation fingerprint. */
export interface CorrectnessCheck {
  /** Identifier for the known-answer problem, e.g. "gemm-fp32-1024-seed42". */
  benchmark_id: string;
  /** Pre-committed expected hash of the computation fingerprint. */
  expected_hash: string;
  /** Measured hash from the job's output. Null if the job did not complete. */
  measured_hash: string | null;
  /** True iff measured_hash === expected_hash. Null if unmeasured. */
  pass: boolean | null;
}

/** Performance check: measured TFLOPS vs a gpu_class reference. */
export interface PerformanceCheck {
  /** GPU class the reference is keyed to. */
  gpu_class: string;
  /** Expected TFLOPS for this gpu_class (from the committed reference table). */
  reference_tflops: number | null;
  /** Measured TFLOPS from the job's output. Null if unmeasured. */
  measured_tflops: number | null;
  /**
   * measured_tflops / reference_tflops, clamped to [0, 1].
   * 1.0 = at or above reference; <0.8 suggests degraded GPU or slow node.
   * Null if either TFLOPS value is null.
   * NOTE: derived from compute throughput only — timing is never hashed.
   */
  conformance_score: number | null;
}

/**
 * A Receipt extended with the results of a conformance probe.
 * Both correctness and performance fields are optional so a receipt can
 * carry one, both, or neither probe result.
 */
export interface ProbeReceipt extends Receipt {
  correctness?: CorrectnessCheck;
  performance?: PerformanceCheck;
}
