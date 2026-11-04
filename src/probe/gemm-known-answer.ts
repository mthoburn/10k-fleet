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
 * Status: PENDING_LIVE_RUN — will be updated after the first real probe run.
 */
export const GEMM_BENCHMARK_ID = 'gemm-fp32-1024-seed42';

/**
 * Pre-committed expected hash.
 * Replace "PENDING_LIVE_RUN" with the actual 64-hex-char hash after the first
 * successful probe run. Commit the update with the probe receipt as evidence.
 */
export const GEMM_EXPECTED_HASH = 'PENDING_LIVE_RUN' as const;

/** True iff GEMM_EXPECTED_HASH has been populated with a real hash. */
export const GEMM_KNOWN_ANSWER_READY = GEMM_EXPECTED_HASH !== 'PENDING_LIVE_RUN';
