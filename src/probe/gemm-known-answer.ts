/**
 * Known-answer constants for the gemm-fp32-1024-seed42 conformance probe.
 *
 * GEMM_EXPECTED_HASH is the SHA-256 hex digest of the JSON fingerprint
 * produced by the probe container:
 *
 *   import numpy as np, json, hashlib
 *   np.random.seed(42)
 *   A = np.random.rand(1024, 1024).astype(np.float32)
 *   B = np.random.rand(1024, 1024).astype(np.float32)
 *   C = A @ B
 *   fp = {"shape": [1024, 1024],
 *          "sum":   round(float(C.sum()), 4),
 *          "norm":  round(float(np.linalg.norm(C)), 4),
 *          "corner":[round(float(C[0,0]),6), round(float(C[0,-1]),6),
 *                    round(float(C[-1,0]),6), round(float(C[-1,-1]),6)]}
 *   print(hashlib.sha256(json.dumps(fp, sort_keys=True).encode()).hexdigest())
 *
 * TIMING VALUES ARE NEVER INCLUDED IN THE HASH.
 *
 * To regenerate after a numpy or platform change:
 *   docker run --rm python:3.11-slim python -c "<script above>"
 * Then commit the new hash here with a comment noting the platform.
 *
 * First live run: 2026-11-04, job AF6cCmvjg5dYi3vczvJYLp35bEoj6A2xdTxNzkLZSyHo
 * Platform: python:3.11-slim + numpy (CPU; RTX 4090 market, CPU-side numpy)
 */
export const GEMM_BENCHMARK_ID = 'gemm-fp32-1024-seed42';

/**
 * SHA-256 of the JSON fingerprint {shape, sum, norm, corner} from the first
 * successful live run (2026-11-04). This is deterministic for float32 matmul
 * with seed 42 regardless of execution hardware (pure numpy CPU math).
 */
export const GEMM_EXPECTED_HASH = 'd061ef85559cc15c1b56f97bab2514eb83542107bd856a309666c33ae8e0d8df' as const;

/** True iff GEMM_EXPECTED_HASH has been populated with a real hash. */
export const GEMM_KNOWN_ANSWER_READY = true;
