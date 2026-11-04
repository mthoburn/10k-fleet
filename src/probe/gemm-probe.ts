/**
 * GEMM-FP32 conformance probe for the Nosana network.
 *
 * Runs a 1024×1024 single-precision matrix multiply (seed 42) in a Docker
 * container and emits a ProbeReceipt with:
 *   - correctness: SHA-256 of a deterministic fingerprint (sum, norm, corners)
 *   - performance: measured TFLOPS vs the gpu_class reference table
 *
 * TIMING VALUES ARE NEVER HASHED. The result_hash and correctness.expected_hash
 * cover only the numeric output of the computation.
 */

import { createHash } from 'crypto';
import type { CorrectnessCheck, PerformanceCheck } from '../types/receipt.js';
import { GEMM_BENCHMARK_ID, GEMM_EXPECTED_HASH } from './gemm-known-answer.js';
import { lookupReferenceTflops } from './gpu-reference-tflops.js';

/** Nosana job definition for the GEMM probe container. */
export const GEMM_PROBE_JOB_DEF = {
  version: '0.1',
  type: 'container',
  meta: { trigger: 'api' },
  ops: [
    {
      type: 'container/run',
      id: 'gemm-probe',
      args: {
        image: 'python:3.11-slim',
        cmd: [
          'python', '-c',
          [
            'import numpy as np, json, hashlib, time',
            'np.random.seed(42)',
            "A = np.random.rand(1024, 1024).astype(np.float32)",
            "B = np.random.rand(1024, 1024).astype(np.float32)",
            't0 = time.perf_counter()',
            'C = A @ B',
            't1 = time.perf_counter()',
            'elapsed = t1 - t0',
            'ops = 2 * (1024 ** 3)',
            'tflops = ops / elapsed / 1e12',
            // Correctness fingerprint — timing is excluded
            'fp = {"shape": [1024, 1024],'
              + ' "sum": round(float(C.sum()), 4),'
              + ' "norm": round(float(np.linalg.norm(C)), 4),'
              + ' "corner": [round(float(C[0,0]),6), round(float(C[0,-1]),6),'
              + '             round(float(C[-1,0]),6), round(float(C[-1,-1]),6)]}',
            'result_hash = hashlib.sha256(json.dumps(fp, sort_keys=True).encode()).hexdigest()',
            // Output — measured_tflops is performance data, never hashed
            'print(json.dumps({'
              + '"benchmark_id": "gemm-fp32-1024-seed42",'
              + ' "result_hash": result_hash,'
              + ' "measured_tflops": round(tflops, 4),'
              + ' "elapsed_s": round(elapsed, 6)}))',
          ].join('\n'),
        ],
      },
    },
  ],
};

export interface GemmProbeOutput {
  benchmark_id: string;
  result_hash: string;
  measured_tflops: number;
  elapsed_s: number;
}

/** Parse the JSON stdout from a completed GEMM probe job. */
export function parseGemmOutput(stdout: string): GemmProbeOutput {
  const lines = stdout.trim().split('\n');
  const last = lines[lines.length - 1];
  const parsed = JSON.parse(last) as GemmProbeOutput;
  if (!parsed.result_hash || !parsed.measured_tflops) {
    throw new Error(`Unexpected GEMM probe output: ${last}`);
  }
  return parsed;
}

/** Build a CorrectnessCheck from parsed probe output. */
export function buildCorrectnessCheck(output: GemmProbeOutput): CorrectnessCheck {
  const measured_hash = output.result_hash;
  const expected_hash = GEMM_EXPECTED_HASH;
  const pass = expected_hash === 'PENDING_LIVE_RUN'
    ? null
    : measured_hash === expected_hash;
  return {
    benchmark_id: GEMM_BENCHMARK_ID,
    expected_hash,
    measured_hash,
    pass,
  };
}

/** Build a PerformanceCheck from parsed probe output and gpu class. */
export function buildPerformanceCheck(
  output: GemmProbeOutput,
  gpuClass: string,
): PerformanceCheck {
  const reference_tflops = lookupReferenceTflops(gpuClass);
  const measured_tflops = output.measured_tflops;
  const conformance_score =
    reference_tflops != null && measured_tflops != null
      ? Math.min(1, measured_tflops / reference_tflops)
      : null;
  return {
    gpu_class: gpuClass,
    reference_tflops,
    measured_tflops,
    conformance_score,
  };
}

/** SHA-256 hex digest of a string — convenience for callers hashing artifacts. */
export function sha256hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
