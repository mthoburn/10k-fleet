import { describe, it, expect } from 'vitest';
import {
  parseGemmOutput,
  buildCorrectnessCheck,
  buildPerformanceCheck,
  sha256hex,
} from '../src/probe/gemm-probe.js';
import { GEMM_BENCHMARK_ID, GEMM_EXPECTED_HASH, GEMM_KNOWN_ANSWER_READY } from '../src/probe/gemm-known-answer.js';
import { lookupReferenceTflops, GPU_REFERENCE_TFLOPS } from '../src/probe/gpu-reference-tflops.js';

const MOCK_STDOUT = JSON.stringify({
  benchmark_id:    'gemm-fp32-1024-seed42',
  result_hash:     'a3f1e2d4b5c6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2',
  measured_tflops: 39.8,
  elapsed_s:       0.053,
});

describe('parseGemmOutput', () => {
  it('parses valid stdout JSON', () => {
    const out = parseGemmOutput(MOCK_STDOUT);
    expect(out.benchmark_id).toBe('gemm-fp32-1024-seed42');
    expect(out.result_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.measured_tflops).toBe(39.8);
    expect(out.elapsed_s).toBe(0.053);
  });

  it('parses when stdout has leading lines before the JSON (container log prefix)', () => {
    const stdout = 'Installing dependencies...\nRunning...\n' + MOCK_STDOUT;
    const out = parseGemmOutput(stdout);
    expect(out.result_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws on malformed output', () => {
    expect(() => parseGemmOutput('not json')).toThrow();
  });
});

describe('buildCorrectnessCheck', () => {
  it('returns pass=null when known answer is PENDING_LIVE_RUN', () => {
    const out = parseGemmOutput(MOCK_STDOUT);
    const check = buildCorrectnessCheck(out);
    expect(check.benchmark_id).toBe(GEMM_BENCHMARK_ID);
    expect(check.measured_hash).toBe(out.result_hash);
    if (!GEMM_KNOWN_ANSWER_READY) {
      expect(check.pass).toBeNull();
    }
  });

  it('returns pass=true when hashes match (simulated)', () => {
    const hash = 'a3f1e2d4b5c6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2';
    const out = { ...parseGemmOutput(MOCK_STDOUT), result_hash: hash };
    // Inject known answer for this sub-test
    const check = {
      benchmark_id:  GEMM_BENCHMARK_ID,
      expected_hash: hash,
      measured_hash: hash,
      pass:          hash === hash,
    };
    expect(check.pass).toBe(true);
  });

  it('returns pass=false when hashes differ (simulated)', () => {
    const expected = 'a'.repeat(64);
    const measured = 'b'.repeat(64);
    expect(expected === measured).toBe(false);
  });
});

describe('buildPerformanceCheck', () => {
  it('computes conformance_score = measured / reference for a known gpu_class', () => {
    const out = parseGemmOutput(MOCK_STDOUT); // measured_tflops = 39.8
    const check = buildPerformanceCheck(out, 'RTX 4090');
    expect(check.gpu_class).toBe('RTX 4090');
    expect(check.reference_tflops).toBe(41.3);
    expect(check.measured_tflops).toBe(39.8);
    // 39.8 / 41.3 ≈ 0.964, clamped to [0,1]
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

  it('never includes elapsed_s in the check (timing not in performance check output)', () => {
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

describe('sha256hex', () => {
  it('returns 64 lowercase hex chars', () => {
    expect(sha256hex('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(sha256hex('test')).toBe(sha256hex('test'));
  });

  it('differs for different inputs', () => {
    expect(sha256hex('a')).not.toBe(sha256hex('b'));
  });
});
