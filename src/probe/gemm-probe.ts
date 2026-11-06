/**
 * GEMM-FP32 GPU conformance probe for the Nosana network.
 *
 * Runs a 1024×1024 single-precision matrix multiply (torch seed 42) on a CUDA
 * GPU inside the container. The probe HARD-FAILS if no CUDA device is visible —
 * running on CPU gives meaningless TFLOPS and must not be accepted as a GPU result.
 *
 * Container output includes:
 *   - device_name, cuda_version, driver_version, compute_capability
 *   - correctness fingerprint values (sum, norm, corners) for tolerance check
 *   - measured_tflops from GPU-timed execution
 *
 * TIMING VALUES ARE NEVER IN THE CORRECTNESS CHECK.
 * The correctness pass/fail is tolerance-based (not hash-based), because FP32
 * GPU results may differ by 1–2 ULPs across GPU families due to FMA ordering.
 *
 * IMAGE: pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime
 *   - PyTorch pre-installed; no pip install needed
 *   - CUDA 12.1 runtime; cuda.is_available() must return True
 *   - numpy also available in this image
 *
 * RNG NOTE: torch.manual_seed(42) ≠ np.random.seed(42).
 * The reference values in gemm-known-answer.ts must come from a torch/GPU run,
 * not from numpy/CPU. The CPU-numpy hash in commit 5825e3c is NOT valid here.
 */

import type { CorrectnessCheck, PerformanceCheck, DeviceInfo } from '../types/receipt.js';
import {
  GEMM_BENCHMARK_ID,
  GEMM_EPSILON_REL,
  GEMM_REFERENCE_VALUES,
  GEMM_REFERENCE_READY,
} from './gemm-known-answer.js';
import { lookupReferenceTflops } from './gpu-reference-tflops.js';

// Python probe script using torch on GPU.
// All strings use double quotes — safe to wrap in single quotes for /bin/sh -c.
const GEMM_PYTHON = [
  'import torch, json, time, sys',
  // Hard-fail if no CUDA device — running on CPU is not a valid GPU probe result
  'if not torch.cuda.is_available():',
  '    sys.exit("FATAL: no CUDA device visible — aborting GPU conformance probe")',
  // Disable TF32 before any matmul. TF32 reduces mantissa precision and would
  // push honest hardware outside the 1e-4 tolerance relative to float64 reference.
  'torch.backends.cuda.matmul.allow_tf32 = False',
  'torch.backends.cudnn.allow_tf32 = False',
  'tf32_matmul = torch.backends.cuda.matmul.allow_tf32',
  'tf32_cudnn  = torch.backends.cudnn.allow_tf32',
  'device = torch.device("cuda:0")',
  'props = torch.cuda.get_device_properties(device)',
  'device_name = torch.cuda.get_device_name(0)',
  'cuda_version = str(torch.version.cuda)',
  // cuda_driver_version: highest CUDA version the installed driver supports (cuDriverGetVersion)
  'try:',
  '    import ctypes',
  '    libcuda = ctypes.cdll.LoadLibrary("libcuda.so.1")',
  '    ver = ctypes.c_int(0)',
  '    libcuda.cuDriverGetVersion(ctypes.byref(ver))',
  '    dv = ver.value',
  '    cuda_driver_version = f"{dv // 1000}.{(dv % 1000) // 10}"',
  'except Exception:',
  '    cuda_driver_version = "unknown"',
  // nvidia_driver_version: NVIDIA display driver version from nvidia-smi
  'try:',
  '    import subprocess',
  '    nv = subprocess.check_output(',
  '        ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader,nounits"],',
  '        text=True, timeout=5)',
  '    nvidia_driver_version = nv.strip().split("\\n")[0].strip()',
  'except Exception:',
  '    nvidia_driver_version = "unknown"',
  // Generate A and B on CPU (same seed = same matrices as the float64 reference),
  // then move to CUDA for the timed float32 matmul.
  'torch.manual_seed(42)',
  'A = torch.rand(1024, 1024, dtype=torch.float32).to(device)',
  'B = torch.rand(1024, 1024, dtype=torch.float32).to(device)',
  // Warm-up pass to avoid cold-start JIT latency in TFLOPS measurement
  '_ = A @ B',
  'torch.cuda.synchronize()',
  // Timed run
  't0 = time.perf_counter()',
  'C = A @ B',
  'torch.cuda.synchronize()',
  't1 = time.perf_counter()',
  'elapsed = t1 - t0',
  'ops = 2 * (1024 ** 3)',
  'tflops = ops / elapsed / 1e12',
  // Correctness fingerprint — move to CPU for stable float values, then round
  'import numpy as np',
  'Ccpu = C.cpu().numpy()',
  'fp_sum     = round(float(Ccpu.sum()), 4)',
  'fp_norm    = round(float(np.linalg.norm(Ccpu)), 4)',
  'fp_corners = [round(float(Ccpu[0,0]),6), round(float(Ccpu[0,-1]),6),',
  '              round(float(Ccpu[-1,0]),6), round(float(Ccpu[-1,-1]),6)]',
  // Output JSON — timing only in measured_tflops/elapsed_s, never in correctness
  'print(json.dumps({',
  '    "benchmark_id":       "gemm-fp32-1024-seed42-torch",',
  '    "device_name":           device_name,',
  '    "cuda_version":          cuda_version,',
  '    "cuda_driver_version":   cuda_driver_version,',
  '    "nvidia_driver_version": nvidia_driver_version,',
  '    "compute_capability": f"{props.major}.{props.minor}",',
  '    "tf32_matmul":        tf32_matmul,',
  '    "tf32_cudnn":         tf32_cudnn,',
  '    "fp_sum":             fp_sum,',
  '    "fp_norm":            fp_norm,',
  '    "fp_corners":         fp_corners,',
  '    "measured_tflops":    round(tflops, 4),',
  '    "elapsed_s":          round(elapsed, 6)',
  '}))',
].join('\n');

/** Nosana job definition for the GPU GEMM probe. */
export const GEMM_PROBE_JOB_DEF = {
  version: '0.1',
  type: 'container',
  meta: { trigger: 'api' },
  ops: [
    {
      type: 'container/run',
      id: 'gemm-probe',
      args: {
        // PyTorch with CUDA 12.1 pre-installed; no pip needed.
        // GPU resource is provided by the Nosana RTX 4090 market.
        image: 'pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime',
        cmd: ['/bin/sh', '-c', `python3 -c '${GEMM_PYTHON}'`],
        gpu: true,
      },
    },
  ],
};

export interface GemmProbeOutput {
  benchmark_id:           string;
  device_name:            string;
  cuda_version:           string;
  cuda_driver_version:    string;
  nvidia_driver_version:  string;
  compute_capability:     string;
  tf32_matmul:        boolean;
  tf32_cudnn:         boolean;
  fp_sum:             number;
  fp_norm:            number;
  fp_corners:         [number, number, number, number];
  measured_tflops:    number;
  elapsed_s:          number;
}

/** Parse the JSON stdout from a completed GEMM probe job. */
export function parseGemmOutput(stdout: string): GemmProbeOutput {
  const lines = stdout.trim().split('\n');
  const last = lines[lines.length - 1];
  const parsed = JSON.parse(last) as GemmProbeOutput;
  if (!parsed.device_name || !parsed.fp_sum || !parsed.measured_tflops) {
    throw new Error(`Unexpected GEMM probe output: ${last}`);
  }
  return parsed;
}

/** Extract DeviceInfo from parsed probe output. */
export function buildDeviceInfo(output: GemmProbeOutput): DeviceInfo {
  return {
    device_name:          output.device_name,
    cuda_version:         output.cuda_version,
    cuda_driver_version:  output.cuda_driver_version,
    nvidia_driver_version: output.nvidia_driver_version,
    compute_capability:   output.compute_capability,
  };
}

/**
 * Build a CorrectnessCheck using tolerance comparison against GEMM_REFERENCE_VALUES.
 *
 * pass = null when GEMM_REFERENCE_READY is false (pending first GPU run).
 * pass = true/false once reference is established.
 */
export function buildCorrectnessCheck(output: GemmProbeOutput): CorrectnessCheck {
  const measured: CorrectnessCheck = {
    benchmark_id:       GEMM_BENCHMARK_ID,
    reference_sum:      GEMM_REFERENCE_VALUES.sum,
    reference_norm:     GEMM_REFERENCE_VALUES.norm,
    reference_corners:  GEMM_REFERENCE_VALUES.corners,
    epsilon_rel:        GEMM_EPSILON_REL,
    measured_sum:       output.fp_sum,
    measured_norm:      output.fp_norm,
    measured_corners:   output.fp_corners,
    max_rel_error:      null,
    pass:               null,
  };

  if (!GEMM_REFERENCE_READY) return measured;

  // Compute max relative error across sum, norm, and all 4 corners
  const ref = GEMM_REFERENCE_VALUES;
  const relErr = (m: number, r: number): number =>
    r !== 0 ? Math.abs(m - r) / Math.abs(r) : Math.abs(m);

  const errors = [
    relErr(output.fp_sum,         ref.sum!),
    relErr(output.fp_norm,        ref.norm!),
    ...output.fp_corners.map((c, i) => relErr(c, ref.corners![i])),
  ];
  const max_rel_error = Math.max(...errors);

  return {
    ...measured,
    max_rel_error,
    pass: max_rel_error <= GEMM_EPSILON_REL,
  };
}

/**
 * Build a PerformanceCheck from parsed probe output and gpu class.
 *
 * calibrated is always false until the reference is measured at the same
 * benchmark size and method as the probe:
 *   - N ≥ 8192 (1024 is too small to saturate memory bandwidth)
 *   - at least one warm-up run before timing
 *   - several timed repeats with the median taken
 *   - reference_tflops measured the same way on a known-good unit of that class
 * Until then conformance_score is null and must not be presented as a verdict.
 */
export function buildPerformanceCheck(
  output: GemmProbeOutput,
  gpuClass: string,
): PerformanceCheck {
  return {
    gpu_class:         gpuClass,
    reference_tflops:  lookupReferenceTflops(gpuClass),
    measured_tflops:   output.measured_tflops,
    conformance_score: null,   // null until calibrated
    calibrated:        false,
  };
}
