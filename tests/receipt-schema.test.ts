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
  ipfs_cid:    null,
  cost_nos:    null,
  chain_state: null,
  outcome_code: 'timeout',
};

const SETTLED: Receipt = {
  ...BASE,
  host:        'NodePubkeyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
  gpu_class:   'RTX 4090',
  claimed_at:  '2026-11-03T10:00:05.000Z',
  started_at:  '2026-11-03T10:00:08.000Z',
  settled_at:  '2026-11-03T10:00:42.000Z',
  result_hash: 'a3f1e2d4b5c6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2',
  ipfs_cid:    'QmValidCidForThisSettledReceipt1234567890abcdef',
  cost_nos:    4818,
  chain_state: 'COMPLETED',
  outcome_code: 'ok',
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

  it('rejects an unrecognised outcome_code', () => {
    expect(validateReceipt({ ...BASE, outcome_code: 'cancelled' })).toBe(false);
  });

  it('rejects a result_hash that is not 64 hex chars', () => {
    expect(validateReceipt({ ...BASE, result_hash: 'short' })).toBe(false);
  });

  it('rejects negative cost_nos', () => {
    expect(validateReceipt({ ...BASE, cost_nos: -1 })).toBe(false);
  });

  it('allows all valid outcome_codes', () => {
    for (const code of ['ok', 'job_error', 'host_error', 'failed', 'timeout', 'unknown'] as const) {
      expect(validateReceipt({ ...BASE, outcome_code: code }), `code=${code}`).toBe(true);
    }
  });

  it('allows all valid chain_state values', () => {
    for (const st of ['QUEUED', 'RUNNING', 'COMPLETED', 'STOPPED', null] as const) {
      expect(validateReceipt({ ...BASE, chain_state: st }), `state=${st}`).toBe(true);
    }
  });
});

describe('probe-receipt.schema.json', () => {
  const PROBE: ProbeReceipt = {
    ...SETTLED,
    device_info: {
      device_name:        'NVIDIA GeForce RTX 4090',
      cuda_version:       '12.1',
      driver_version:     '530.30',
      compute_capability: '8.9',
    },
    correctness: {
      benchmark_id:       'gemm-fp32-1024-seed42-torch',
      reference_sum:      268435456.1234,
      reference_norm:     16777216.5678,
      reference_corners:  [256.123456, 255.987654, 254.111222, 253.333444],
      epsilon_rel:        1e-4,
      measured_sum:       268435456.1234,
      measured_norm:      16777216.5678,
      measured_corners:   [256.123456, 255.987654, 254.111222, 253.333444],
      max_rel_error:      0,
      pass:               true,
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

  it('rejects performance.conformance_score > 1', () => {
    const bad = { ...PROBE, performance: { ...PROBE.performance!, conformance_score: 1.5 } };
    expect(validateProbe(bad)).toBe(false);
  });

  it('allows correctness with null references (pending GPU run)', () => {
    const r: ProbeReceipt = {
      ...SETTLED,
      correctness: {
        benchmark_id:       'gemm-fp32-1024-seed42-torch',
        reference_sum:      null,
        reference_norm:     null,
        reference_corners:  null,
        epsilon_rel:        1e-4,
        measured_sum:       268435456.1234,
        measured_norm:      16777216.5678,
        measured_corners:   [256.123456, 255.987654, 254.111222, 253.333444],
        max_rel_error:      null,
        pass:               null,
      },
    };
    expect(validateProbe(r)).toBe(true);
  });

  it('allows correctness.pass = null when job did not complete', () => {
    const r: ProbeReceipt = {
      ...BASE,
      outcome_code: 'timeout',
      correctness: {
        benchmark_id:      'gemm-fp32-1024-seed42-torch',
        reference_sum:     null,
        reference_norm:    null,
        reference_corners: null,
        epsilon_rel:       1e-4,
        measured_sum:      null,
        measured_norm:     null,
        measured_corners:  null,
        max_rel_error:     null,
        pass:              null,
      },
    };
    expect(validateProbe(r)).toBe(true);
  });
});
