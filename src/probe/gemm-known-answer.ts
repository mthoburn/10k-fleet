/**
 * Known-answer reference values for the gemm-fp32-1024-seed42-torch probe.
 *
 * REFERENCE DESIGN
 * ================
 * torch.manual_seed(42) produces the same A and B matrices on every machine.
 * The reference is computed locally in float64 (scripts/compute-gemm-reference.py)
 * and committed here — no GPU run required and no host is trusted to define
 * the right answer. Any host's float32 result is checked against this reference.
 *
 * Run `python3 scripts/compute-gemm-reference.py` to reproduce these values.
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
 * Float64 reference values computed locally via scripts/compute-gemm-reference.py.
 * torch.manual_seed(42), 1024×1024 float64, CPU matmul.
 * Reproducible: run the script to verify.
 */
export const GEMM_REFERENCE_VALUES: {
  sum:     number | null;
  norm:    number | null;
  corners: [number, number, number, number] | null;
} = {
  sum:     268276162.1166,
  norm:    262087.9155,
  corners: [245.501395, 251.00388, 243.896873, 251.008267],
};

export const GEMM_REFERENCE_READY =
  GEMM_REFERENCE_VALUES.sum !== null &&
  GEMM_REFERENCE_VALUES.norm !== null &&
  GEMM_REFERENCE_VALUES.corners !== null;
