# @SCOPE/nosana-receipts

> **M1 public preview** — Receipt spec, conformance probe, and job wrapper for Nosana GPU compute.

A thin, vendor-agnostic layer that wraps a Nosana job run and returns a structured `Receipt` — with optional correctness and performance fields from the GEMM conformance probe.

---

## 60-second quickstart

```bash
npm install @SCOPE/nosana-receipts @nosana/sdk @solana/web3.js

# Dry run (no wallet needed):
npx tsx node_modules/@SCOPE/nosana-receipts/examples/submit-and-wrap.ts --dry-run

# Real run — wallet file (JSON array of 64 bytes):
WALLET_PATH=/path/to/keypair.json npx tsx node_modules/@SCOPE/nosana-receipts/examples/submit-and-wrap.ts

# Real run — wallet env var (base58 Phantom format or JSON array):
NOSANA_WALLET_PRIVATE_KEY=<base58> npx tsx node_modules/@SCOPE/nosana-receipts/examples/submit-and-wrap.ts
```

A funded wallet (NOS on Solana mainnet) is required for a real run. Never commit or print the keypair.

---

## Install

```bash
npm install @SCOPE/nosana-receipts
# peer deps:
npm install @nosana/sdk @solana/web3.js
```

---

## Usage

### Submit a GEMM probe job and get a receipt

```typescript
import {
  wrapNosanaJob,
  GEMM_PROBE_JOB_DEF,
  parseGemmOutput,
  buildCorrectnessCheck,
  buildPerformanceCheck,
} from '@SCOPE/nosana-receipts';

const RTX_4090_MARKET = '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf';

const receipt = await wrapNosanaJob(GEMM_PROBE_JOB_DEF, {
  market:         RTX_4090_MARKET,
  walletPath:     process.env.WALLET_PATH!,
  pollIntervalMs: 8_000,
  timeoutMs:      600_000,
});

console.log(receipt);
// {
//   receipt_version: '0.1.0',
//   provider: 'nosana',
//   job_id: 'JiD5ee…',
//   outcome_code: 'ok',
//   host: 'NodePubkey…',
//   gpu_class: 'RTX 4090',
//   result_hash: 'a3f1e2…',
//   cost_usd: 0.014,
//   …
// }
```

### Parse probe output from the job artifact store

```typescript
// After fetching stdout from the Nosana result store:
const gemmOut = parseGemmOutput(stdout);

receipt.correctness = buildCorrectnessCheck(gemmOut);
// { benchmark_id, expected_hash, measured_hash, pass: true|false|null }

receipt.performance = buildPerformanceCheck(gemmOut, receipt.gpu_class!);
// { gpu_class, reference_tflops, measured_tflops, conformance_score }
```

### Validate a receipt against the JSON Schema

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import receiptSchema from '@SCOPE/nosana-receipts/src/schema/receipt.schema.json' assert { type: 'json' };

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile(receiptSchema);
console.log(validate(receipt)); // true
```

---

## Receipt spec v0.1

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
| `cost_nos` | `number \| null` | NOS cost as reported by the protocol (`job.price` from SDK; units are venue-specific) |
| `outcome_code` | `"ok" \| "failed" \| "timeout" \| "cancelled"` | Job outcome |

**ProbeReceipt** extends Receipt with optional `correctness` and `performance` objects — see `src/schema/probe-receipt.schema.json`.

**Lifecycle timestamps** (`posted_at`, `claimed_at`, `started_at`, `settled_at`) are observer-side wall-clock times recorded by the polling process — NOT on-chain timestamps. Use them for approximate duration measurement only.

**On timeout** the job remains live on-chain. `wrapNosanaJob` attempts `jobs.delist()` but this may fail if the job has already been claimed by a node. Monitor the `job_id` address directly if precise on-chain cancellation is required.

---

## GEMM conformance probe

The probe runs a 1024×1024 fp32 GEMM (numpy seed 42) inside a container on the target node. It produces:

- **Correctness:** SHA-256 fingerprint of the result matrix (shape, sum, norm, corner values) compared against a committed known answer. `pass: null` while `GEMM_EXPECTED_HASH` is `PENDING_LIVE_RUN`.
- **Performance:** Measured TFLOPS vs a reference table keyed by `gpu_class`. `conformance_score = measured / reference`, clamped to [0, 1].

Timing values are **never** included in the correctness hash.

---

## License

Apache-2.0 © 2026 Eden Botanical
