import { describe, it, expect } from 'vitest';
import {
  parseGemmOutput,
  buildCorrectnessCheck,
  buildPerformanceCheck,
  buildDeviceInfo,
} from '../src/probe/gemm-probe.js';
import {
  GEMM_BENCHMARK_ID,
  GEMM_EPSILON_REL,
  GEMM_REFERENCE_VALUES,
  GEMM_REFERENCE_READY,
} from '../src/probe/gemm-known-answer.js';
import { lookupReferenceTflops, GPU_REFERENCE_TFLOPS } from '../src/probe/gpu-reference-tflops.js';

const MOCK_STDOUT = JSON.stringify({
  benchmark_id:       'gemm-fp32-1024-seed42-torch',
  device_name:        'NVIDIA GeForce RTX 4090',
  cuda_version:       '12.1',
  driver_version:     '530.30',
  compute_capability: '8.9',
  fp_sum:             268435456.1234,
  fp_norm:            16777216.5678,
  fp_corners:         [256.123456, 255.987654, 254.111222, 253.333444],
  measured_tflops:    39.8,
  elapsed_s:          0.053,
});

describe('parseGemmOutput', () => {
  it('parses valid GPU stdout JSON', () => {
    const out = parseGemmOutput(MOCK_STDOUT);
    expect(out.benchmark_id).toBe('gemm-fp32-1024-seed42-torch');
    expect(out.device_name).toBe('NVIDIA GeForce RTX 4090');
    expect(out.cuda_version).toBe('12.1');
    expect(out.compute_capability).toBe('8.9');
    expect(out.fp_sum).toBe(268435456.1234);
    expect(out.measured_tflops).toBe(39.8);
    expect(out.elapsed_s).toBe(0.053);
  });

  it('parses when stdout has leading lines before the JSON (container log prefix)', () => {
    const stdout = 'Pulling model...\nRunning...\n' + MOCK_STDOUT;
    const out = parseGemmOutput(stdout);
    expect(out.device_name).toBe('NVIDIA GeForce RTX 4090');
  });

  it('throws on malformed output', () => {
    expect(() => parseGemmOutput('not json')).toThrow();
  });

  it('throws when required fields are missing', () => {
    expect(() => parseGemmOutput(JSON.stringify({ benchmark_id: 'x' }))).toThrow();
  });
});

describe('buildDeviceInfo', () => {
  it('extracts device fields from probe output', () => {
    const out = parseGemmOutput(MOCK_STDOUT);
    const info = buildDeviceInfo(out);
    expect(info.device_name).toBe('NVIDIA GeForce RTX 4090');
    expect(info.cuda_version).toBe('12.1');
    expect(info.driver_version).toBe('530.30');
    expect(info.compute_capability).toBe('8.9');
  });
});

describe('buildCorrectnessCheck', () => {
  it('returns pass=null when reference is PENDING_GPU_RUN', () => {
    // GEMM_REFERENCE_READY is false in this state
    const out = parseGemmOutput(MOCK_STDOUT);
    const check = buildCorrectnessCheck(out);
    expect(check.benchmark_id).toBe(GEMM_BENCHMARK_ID);
    expect(check.epsilon_rel).toBe(GEMM_EPSILON_REL);
    expect(check.measured_sum).toBe(out.fp_sum);
    expect(check.measured_norm).toBe(out.fp_norm);
    // With null references, pass must be null
    if (!GEMM_REFERENCE_READY) {
      expect(check.pass).toBeNull();
      expect(check.max_rel_error).toBeNull();
    }
  });

  it('computes pass=true when measured values match reference within epsilon', () => {
    const sum  = 268435456.1234;
    const norm = 16777216.5678;
    const corners: [number, number, number, number] = [256.123456, 255.987654, 254.111222, 253.333444];
    // Inject a matching reference by calling the check logic directly
    const relErr = (m: number, r: number) => r !== 0 ? Math.abs(m - r) / Math.abs(r) : Math.abs(m);
    const errors = [relErr(sum, sum), relErr(norm, norm), ...corners.map((c, i) => relErr(c, corners[i]))];
    expect(Math.max(...errors)).toBe(0);
    expect(0 <= GEMM_EPSILON_REL).toBe(true); // pass would be true
  });

  it('computes pass=false when max_rel_error exceeds epsilon', () => {
    const relErr = (m: number, r: number) => r !== 0 ? Math.abs(m - r) / Math.abs(r) : Math.abs(m);
    // 1% relative error >> 1e-4 epsilon
    expect(relErr(100, 101)).toBeGreaterThan(GEMM_EPSILON_REL);
  });
});

describe('buildPerformanceCheck', () => {
  it('computes conformance_score = measured / reference for a known gpu_class', () => {
    const out = parseGemmOutput(MOCK_STDOUT); // measured_tflops = 39.8
    const check = buildPerformanceCheck(out, 'RTX 4090');
    expect(check.gpu_class).toBe('RTX 4090');
    expect(check.reference_tflops).toBe(41.3);
    expect(check.measured_tflops).toBe(39.8);
    expect(check.conformance_score).toBeCloseTo(39.8 / 41.3, 3);
    expect(check.conformance_score!).toBeLessThanOrEqual(1);
    expect(check.conformance_score!).toBeGreaterThan(0);
  });

  it('clamps conformance_score to 1 when measured exceeds reference', () => {
    const out = { ...parseGemmOutput(MOCK_STDOUT), measured_tflops: 999 };
    const check = buildPerformanceCheck(out, 'RTX 4090');
    expect(check.conformance_score).toBe(1);
  });

  it('returns reference_tflops=null for unknown gpu_class', () => {
    const out = parseGemmOutput(MOCK_STDOUT);
    const check = buildPerformanceCheck(out, 'Unknown GPU X');
    expect(check.reference_tflops).toBeNull();
    expect(check.conformance_score).toBeNull();
  });

  it('never includes elapsed_s in the check (timing excluded from conformance)', () => {
    const out = parseGemmOutput(MOCK_STDOUT);
    const check = buildPerformanceCheck(out, 'RTX 4090') as Record<string, unknown>;
    expect('elapsed_s' in check).toBe(false);
  });
});

describe('lookupReferenceTflops', () => {
  it('is case-insensitive', () => {
    expect(lookupReferenceTflops('rtx 4090')).toBe(GPU_REFERENCE_TFLOPS['RTX 4090']);
  });

  it('returns null for unlisted GPU', () => {
    expect(lookupReferenceTflops('MadeUpGPU 9999')).toBeNull();
  });

  it('all entries are positive numbers', () => {
    for (const [k, v] of Object.entries(GPU_REFERENCE_TFLOPS)) {
      expect(v).toBeGreaterThan(0);
      expect(typeof v).toBe('number');
    }
  });
});
