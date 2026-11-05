# 10k-fleet

> **Independent project, not affiliated with or endorsed by Nosana.**

The open parts of 10k: the fleet delivery-record spec and the collector that
writes a record for every compute job. The fleet coordinator itself is private.

10k is the point where a fleet can't be run by hand: below it you can watch agents
yourself; above it you need governance before they act and evidence after they run.

**Status:** real records from live Nosana jobs are in `examples/`. The GPU probe
format is defined and its first reference run is in progress. No GPU evidence
is claimed yet.

---

## What's in this repo

| Path | Purpose |
|------|---------|
| `src/schema/receipt.schema.json` | Delivery-record spec (v0.1) |
| `src/schema/probe-receipt.schema.json` | Extended spec with GPU probe fields |
| `src/wrap/wrap-nosana-job.ts` | Collector: submits a job, polls, writes a record |
| `src/probe/gemm-probe.ts` | GPU GEMM probe job definition and output parser |
| `src/probe/gemm-known-answer.ts` | Float64 reference values (locally computed) |
| `examples/` | Real delivery records from live jobs |

---

## Delivery-record spec v0.1

A delivery record is a structured JSON object written after every compute job. It answers: did the job run, on what host, at what cost, and did the workload succeed?

| Field | Type | Description |
|-------|------|-------------|
| `receipt_version` | `"0.1.0"` | Spec version |
| `provider` | `string` | Venue identifier (`"nosana"`) |
| `job_id` | `string` | On-chain job public key |
| `market` | `string` | Market public key |
| `host` | `string \| null` | Node on-chain pubkey (null until claimed) |
| `gpu_class` | `string \| null` | GPU class reported by the node |
| `posted_at` | ISO 8601 | Job posted timestamp |
| `claimed_at` | ISO 8601 \| null | Job claimed by a node |
| `started_at` | ISO 8601 \| null | Container started |
| `settled_at` | ISO 8601 \| null | Job settled on-chain |
| `result_hash` | 64-char hex \| null | SHA-256 of IPFS result artifact JSON |
| `cost_nos` | `number \| null` | Net NOS debit from poster wallet (deposit minus escrow refund) |
| `chain_state` | `"QUEUED" \| "RUNNING" \| "COMPLETED" \| "STOPPED" \| null` | On-chain terminal state |
| `outcome_code` | `"ok" \| "job_error" \| "host_error" \| "failed" \| "timeout" \| "unknown"` | Derived from chain state + workload result |

`chain_state` and `outcome_code` are separate: a job can settle `COMPLETED` on-chain while the container exited non-zero (`job_error`). See `examples/real-receipt-late-detection.json` for a real instance of that case.

**Lifecycle timestamps** are observer-side wall-clock times from the polling process — not on-chain timestamps. Use them for approximate duration measurement only.

**ProbeReceipt** extends this with optional `device_info`, `correctness`, and `performance` objects — see `src/schema/probe-receipt.schema.json`.

---

## GPU probe

The probe runs a 1024×1024 FP32 GEMM (PyTorch, seed 42) inside a container on the target node and records device information alongside correctness and performance evidence.

**Correctness approach:** Reference values are computed locally in float64 (`scripts/compute-gemm-reference.py` — reproducible, no GPU required, no host trusted to define the right answer). The probe checks the host's float32 result against the float64 reference using max relative error ≤ 1e-4. TF32 is explicitly disabled before the matmul and recorded in the output.

**Performance:** Measured TFLOPS vs a reference table keyed by `gpu_class`. `conformance_score = measured / reference`, clamped to [0, 1].

The first GPU reference run is in progress. No conformance results are claimed yet.

---

## Usage

### Collect a delivery record for any Nosana job

```typescript
import { wrapNosanaJob } from '@SCOPE/nosana-receipts';

const record = await wrapNosanaJob(myJobDef, {
  market:         '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf',
  walletPath:     process.env.WALLET_PATH!,
  pollIntervalMs: 8_000,
  timeoutMs:      600_000,
});

// record.outcome_code  → 'ok' | 'job_error' | 'host_error' | 'failed' | 'timeout' | 'unknown'
// record.chain_state   → 'COMPLETED' | 'STOPPED' | null
// record.cost_nos      → net NOS debit from ATA balance delta
```

### Run the GEMM probe and parse evidence

```typescript
import {
  wrapNosanaJob,
  GEMM_PROBE_JOB_DEF,
  parseGemmOutput,
  buildCorrectnessCheck,
  buildPerformanceCheck,
  buildDeviceInfo,
} from '@SCOPE/nosana-receipts';

const record = await wrapNosanaJob(GEMM_PROBE_JOB_DEF, opts);

// After fetching stdout from the IPFS result:
const gemmOut = parseGemmOutput(stdout);

const device      = buildDeviceInfo(gemmOut);
// { device_name, cuda_version, driver_version, compute_capability }

const correctness = buildCorrectnessCheck(gemmOut);
// { benchmark_id, reference_sum, measured_sum, max_rel_error, pass: true|false|null }

const performance = buildPerformanceCheck(gemmOut, 'RTX 4090');
// { gpu_class, reference_tflops, measured_tflops, conformance_score }
```

### Validate a record against the JSON Schema

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import receiptSchema from '@SCOPE/nosana-receipts/src/schema/receipt.schema.json' assert { type: 'json' };

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile(receiptSchema);
console.log(validate(record)); // true
```

---

## Install

```bash
npm install @SCOPE/nosana-receipts
# peer deps:
npm install @nosana/sdk @solana/web3.js
```

A funded wallet (NOS on Solana mainnet) is required for live job submission.

---

## Examples

| File | Description |
|------|-------------|
| `examples/real-receipt.json` | Attempt 3: chain COMPLETED, outcome ok, CPU-only run (numpy, no CUDA) |
| `examples/real-receipt-late-detection.json` | Attempt 1: chain COMPLETED, outcome job_error (numpy missing); state-enum bug hid the transition |

---

## License

Apache-2.0 © 2026 Eden Botanical
