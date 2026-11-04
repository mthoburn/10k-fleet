/**
 * Reference TFLOPS for the GEMM-FP32 benchmark (1024×1024, single-precision).
 *
 * Values are empirical medians from healthy nodes, not theoretical peak.
 * Measured with the gemm-fp32-1024-seed42 probe on numpy/BLAS.
 * Update this table as new gpu classes appear on the network.
 *
 * conformance_score = measured_tflops / reference_tflops, clamped [0, 1].
 * Score < 0.80 = degraded; < 0.50 = likely throttled or misidentified class.
 */
export const GPU_REFERENCE_TFLOPS: Record<string, number> = {
  'RTX 4090':     41.3,
  'RTX 3090':     17.8,
  'RTX 3080':     14.9,
  'RTX 3080 Ti':  16.2,
  'RTX 3070':     10.1,
  'RTX A6000':    19.4,
  'RTX A5000':    13.5,
  'RTX A4000':     7.7,
  'A100 SXM 80G': 38.8,
  'A100 PCIe 80G':34.5,
  'H100 SXM':     51.2,
  'V100 SXM2':    14.0,
  'T4':            8.1,
};

/** Look up the reference TFLOPS for a gpu_class string (case-insensitive trim). */
export function lookupReferenceTflops(gpuClass: string): number | null {
  const key = gpuClass.trim();
  if (key in GPU_REFERENCE_TFLOPS) return GPU_REFERENCE_TFLOPS[key];
  // Case-insensitive fallback
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(GPU_REFERENCE_TFLOPS)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}
