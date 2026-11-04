/**
 * Known-answer reference values for the gemm-fp32-1024-seed42-torch probe.
 *
 * IMPORTANT: these reference values MUST come from a torch/GPU run, NOT numpy/CPU.
 * torch.rand(seed=42) and np.random.rand(seed=42) produce different sequences —
 * the matrices A and B are different, so C = A @ B is completely different.
 * The CPU-numpy hash committed in 5825e3c is not valid for GPU conformance.
 *
 * TOLERANCE DESIGN
 * ================
 * FP32 GPU results may differ by 1–2 ULPs across hardware families due to
 * different FMA and tree-reduction ordering. We use a relative error tolerance
 * rather than exact bit-identity:
 *   pass iff |measured - reference| / |reference| ≤ GEMM_EPSILON_REL
 *
 * The fingerprint values are rounded inside the probe container (sum/norm to 4dp,
 * corners to 6dp), which provides a natural coarse tolerance band. GEMM_EPSILON_REL
 * is an additional guard for cross-GPU-generation variance before rounding.
 *
 * To establish reference values after the first successful GPU run:
 *   1. Run the GPU probe against a known-good RTX 4090 node
 *   2. Record measured_sum, measured_norm, measured_corners from the IPFS result
 *   3. Set GEMM_REFERENCE_VALUES below and mark GEMM_REFERENCE_READY = true
 *   4. Commit with the job_id as evidence
 *
 * STATUS: PENDING_GPU_RUN
 */

export const GEMM_BENCHMARK_ID = 'gemm-fp32-1024-seed42-torch';

/** Relative error tolerance across all fingerprint values. */
export const GEMM_EPSILON_REL = 1e-4;

/**
 * Reference values from canonical torch/GPU run.
 * null = pending first GPU run; pass will be null until set.
 */
export const GEMM_REFERENCE_VALUES: {
  sum:     number | null;
  norm:    number | null;
  corners: [number, number, number, number] | null;
} = {
  sum:     null,  // PENDING_GPU_RUN
  norm:    null,
  corners: null,
};

export const GEMM_REFERENCE_READY =
  GEMM_REFERENCE_VALUES.sum !== null &&
  GEMM_REFERENCE_VALUES.norm !== null &&
  GEMM_REFERENCE_VALUES.corners !== null;
