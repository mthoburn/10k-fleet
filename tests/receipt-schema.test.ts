import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import receiptSchema from '../src/schema/receipt.schema.json';
import probeSchema from '../src/schema/probe-receipt.schema.json';
import type { Receipt, ProbeReceipt } from '../src/types/receipt.js';

const ajv = new Ajv({ strict: false });
addFormats(ajv);
ajv.addSchema(receiptSchema);
const validateReceipt = ajv.compile(receiptSchema);
const validateProbe = ajv.compile(probeSchema);

const BASE: Receipt = {
  receipt_version: '0.1.0',
  provider: 'nosana',
  job_id: 'JiD5eeWiPzXQpXKLhYqxNMVWkZb2BsHQzxnmWAtMmPX',
  market:  'RTXdWh7WC3B8YCFSENoX9QAb8nxUXvKLsMD7rfTe4a3',
  host:    null,
  gpu_class: null,
  posted_at:  '2026-11-03T10:00:00.000Z',
  claimed_at: null,
  started_at: null,
  settled_at: null,
  result_hash: null,
  cost_nos:    null,
  outcome_code: 'ok',
};

const SETTLED: Receipt = {
  ...BASE,
  host:        'NodePubkeyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
  gpu_class:   'RTX 4090',
  claimed_at:  '2026-11-03T10:00:05.000Z',
  started_at:  '2026-11-03T10:00:08.000Z',
  settled_at:  '2026-11-03T10:00:42.000Z',
  result_hash: 'a3f1e2d4b5c6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2',
  cost_nos:    0.014,
};

describe('receipt.schema.json', () => {
  it('validates a minimal in-flight receipt (all nullables null)', () => {
    expect(validateReceipt(BASE)).toBe(true);
  });

  it('validates a fully-settled receipt', () => {
    expect(validateReceipt(SETTLED)).toBe(true);
  });

  it('requires receipt_version', () => {
    const bad = { ...BASE } as Partial<Receipt>;
    delete bad.receipt_version;
    expect(validateReceipt(bad)).toBe(false);
  });

  it('rejects an unknown outcome_code', () => {
    expect(validateReceipt({ ...BASE, outcome_code: 'unknown' })).toBe(false);
  });

  it('rejects a result_hash that is not 64 hex chars', () => {
    expect(validateReceipt({ ...BASE, result_hash: 'short' })).toBe(false);
  });

  it('rejects negative cost_nos', () => {
    expect(validateReceipt({ ...BASE, cost_nos: -1 })).toBe(false);
  });

  it('allows all four outcome_codes', () => {
    for (const code of ['ok', 'failed', 'timeout', 'cancelled'] as const) {
      expect(validateReceipt({ ...BASE, outcome_code: code })).toBe(true);
    }
  });
});

describe('probe-receipt.schema.json', () => {
  const PROBE: ProbeReceipt = {
    ...SETTLED,
    correctness: {
      benchmark_id:   'gemm-fp32-1024-seed42',
      expected_hash:  'a3f1e2d4b5c6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2',
      measured_hash:  'a3f1e2d4b5c6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2',
      pass:           true,
    },
    performance: {
      gpu_class:         'RTX 4090',
      reference_tflops:  41.3,
      measured_tflops:   39.8,
      conformance_score: 0.96,
    },
  };

  it('validates a full probe receipt', () => {
    expect(validateProbe(PROBE)).toBe(true);
  });

  it('validates a probe receipt with only correctness', () => {
    const r: ProbeReceipt = { ...SETTLED, correctness: PROBE.correctness };
    expect(validateProbe(r)).toBe(true);
  });

  it('validates a probe receipt with only performance', () => {
    const r: ProbeReceipt = { ...SETTLED, performance: PROBE.performance };
    expect(validateProbe(r)).toBe(true);
  });

  it('rejects correctness.conformance_score > 1', () => {
    const bad = { ...PROBE, performance: { ...PROBE.performance!, conformance_score: 1.5 } };
    expect(validateProbe(bad)).toBe(false);
  });

  it('rejects correctness.expected_hash that is not 64 hex chars', () => {
    const bad = { ...PROBE, correctness: { ...PROBE.correctness!, expected_hash: 'nothex' } };
    expect(validateProbe(bad)).toBe(false);
  });

  it('allows correctness.pass = null (job incomplete)', () => {
    const r: ProbeReceipt = {
      ...BASE,
      outcome_code: 'timeout',
      correctness: {
        benchmark_id:  'gemm-fp32-1024-seed42',
        expected_hash: 'a3f1e2d4b5c6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2',
        measured_hash: null,
        pass:          null,
      },
    };
    expect(validateProbe(r)).toBe(true);
  });
});
