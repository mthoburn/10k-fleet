/**
 * Known-answer reference values for the gemm-fp32-1024-seed42-torch probe.
 *
 * REFERENCE DESIGN
 * ================
 * torch.rand draws from DIFFERENT RNG streams per dtype — same seed with
 * dtype=float32 and dtype=float64 produces completely different matrices.
 * The reference is therefore generated in float32 (probe-identical inputs)
 * and upcasted to float64 before the matmul:
 *
 *   torch.manual_seed(42)
 *   A = torch.rand(1024, 1024, dtype=torch.float32).double()
 *   B = torch.rand(1024, 1024, dtype=torch.float32).double()
 *   C = A @ B   -- float64 accumulation against float32 inputs
 *
 * This ensures the probe's GPU float32 C and the reference float64 C are
 * both C = A×B for the SAME input matrices.
 *
 * Run `python3 scripts/compute-gemm-reference.py` to reproduce all values.
 *
 * TOLERANCE DESIGN
 * ================
 * FP32 GPU results may differ by 1–2 ULPs across hardware families due to
 * different FMA and tree-reduction ordering. We use a relative error tolerance:
 *   pass iff max(|measured - reference| / |reference|) ≤ GEMM_EPSILON_REL
 *
 * TF32 GUARD
 * ==========
 * The probe explicitly sets torch.backends.cuda.matmul.allow_tf32 = False and
 * torch.backends.cudnn.allow_tf32 = False before the matmul. TF32 reduces
 * mantissa precision and would blow through the 1e-4 tolerance on otherwise-honest
 * hardware. Both flags are recorded in the receipt.
 */

export const GEMM_BENCHMARK_ID = 'gemm-fp32-1024-seed42-torch';

/** Relative error tolerance across all fingerprint values. */
export const GEMM_EPSILON_REL = 1e-4;

/**
 * Reference values: torch.manual_seed(42), A/B generated as float32
 * (probe-identical), upcasted to float64, matmul in float64.
 * Reproducible: `python3 scripts/compute-gemm-reference.py`
 */
export const GEMM_REFERENCE_VALUES: {
  sum:     number | null;
  norm:    number | null;
  corners: [number, number, number, number] | null;
} = {
  sum:     268155386.8045,
  norm:    261969.9119,
  corners: [251.338413, 250.378111, 257.686787, 255.375658],
};

/**
 * Pinned first two float32 values of A[0] from torch.manual_seed(42).
 * Used in the generation-identity test to assert the probe and reference
 * scripts produce the same input matrix construction.
 */
export const GEMM_REFERENCE_A_PINS = {
  a_0_0: 0.8822692632675171,
  a_0_1: 0.9150039553642273,
};

export const GEMM_REFERENCE_READY =
  GEMM_REFERENCE_VALUES.sum !== null &&
  GEMM_REFERENCE_VALUES.norm !== null &&
  GEMM_REFERENCE_VALUES.corners !== null;
