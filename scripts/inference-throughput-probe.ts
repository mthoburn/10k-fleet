/**
 * Inference throughput probe — llama.cpp on Nosana RTX 4090 market.
 *
 * Measures Readings/sec for the Eden 10k-fleet Nosana grant demand estimate.
 * One job: download Meta-Llama-3.1-8B-Instruct Q4_K_M, start llama-server
 * (CUDA, -ngl 99 -np 32 -c 40960), run 200 synthetic Readings (950 prompt +
 * 180 completion tokens each), report steady-state throughput.
 *
 * Usage:
 *   NOSANA_WALLET_PRIVATE_KEY=<key> npx tsx scripts/inference-throughput-probe.ts
 *
 * Writes on completion:
 *   evidence/inference-throughput-receipt.json  — schema-valid receipt
 *   evidence/nosana-priced-demand.md            — ESTIMATE, demand figures
 */

import { wrapNosanaJob } from '../src/index.js';
import type { Receipt } from '../src/index.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

const RTX_4090_MARKET = '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf';

// Synthetic prompt: ~950 tokens estimated via 4-char/token heuristic for
// Llama-3.1 English prose (3,860 chars ÷ 4.06 chars/token ≈ 950 tokens).
// SYNTHETIC-APPROX: noted in evidence file.
const PROMPT =
  'You are an expert ecological intelligence system tasked with interpreting environmental sensor data and generating comprehensive assessments of natural phenomena for conservation management authorities. ' +
  'Sensor Report ID: ECO-2026-11-10-047. Location: Pacific Northwest Temperate Rainforest Zone. Coordinates: 47.6062 N, 122.3321 W. Elevation: 847 meters above sea level. Timestamp: 2026-11-10T14:32:17Z. ' +
  'Ambient Conditions recorded by distributed sensor array: Air Temperature measured at 8.4 degrees Celsius. Relative Humidity at 94.2 percent. Atmospheric Pressure reading of 1012.3 hectopascals. ' +
  'Wind Speed at 2.1 meters per second from north-northwest. Precipitation accumulated over the past six hours totaling 3.2 millimeters. UV Index recorded at 0.4 indicating minimal solar radiation penetration through overcast conditions. Cloud cover at 100 percent altostratus with embedded nimbostratus layers. ' +
  'Soil Conditions from embedded sensor network: Surface Temperature measured at 6.8 degrees Celsius at 5 centimeter depth. Volumetric Moisture Content at 73.4 percent. Soil pH reading of 5.8 indicating moderately acidic conditions typical of coniferous forest soils in this region. ' +
  'Electrical Conductivity at 0.42 millisiemens per centimeter. Organic matter content estimated at 18.3 percent by mass. Soil respiration rate elevated at baseline plus 18 percent compared to seasonal average. ' +
  'Acoustic Signatures from hydrophone and geophone array: Low frequency ground vibration detected at 0.003 millimeters per second peak amplitude in the 1 to 10 hertz frequency range. Canopy movement index calculated at 1.4 indicating moderate wind interaction with upper forest structure. Wildlife acoustic activity recorded at 23 detected calls per hour across all monitored frequency bands. ' +
  'Species positively identified from acoustic signatures include Varied Thrush (Ixoreus naevius), Pacific Wren (Troglodytes pacificus), and Red-breasted Nuthatch (Sitta canadensis). ' +
  'Botanical Survey Data collected by field observers on 2026-11-09: Dominant overstory species include Douglas Fir (Pseudotsuga menziesii) with estimated ages between 180 and 340 years and Western Red Cedar (Thuja plicata). Understory composition includes Vine Maple (Acer circinatum), Salal (Gaultheria shallon), and Sword Fern (Polystichum munitum) at high density. ' +
  'Epiphyte coverage measured at 68 percent of available substrate area including Selaginella oregana, Lobaria pulmonaria lichen colonies, and Polypodium glycyrrhiza. Mycorrhizal network activity index currently at 7.2 on a scale of 10 based on soil carbon dioxide efflux mapping and stable isotope tracer measurements. Phenological stage classified as late autumn senescence entering pre-dormancy transition. ' +
  'Anomaly Flags requiring immediate professional assessment: Elevated soil carbon dioxide efflux detected at 18 percent above established seasonal baseline. Partial structural collapse of aerial root mass identified in northwest monitoring sector grid squares G7 through G9. Unusual bioluminescence phenomena reported by field observer at 02:17 local time. Accelerometer array shows asymmetric mechanical stress patterns in root zone suggesting subsurface hydrological change. ' +
  'Historical Context: This site was established as a permanent long-term ecological research station in 1987. Previous events with similar multi-sensor signatures were recorded on 1991-03-15, 2003-07-22, and 2019-11-04. Carbon sequestration rate estimated at 4.2 tonnes of carbon dioxide equivalent per hectare per year. ' +
  'Task: Provide a comprehensive ecological assessment including primary phenomena identification, contributing environmental factors, expected ecological cascade effects, recommended monitoring protocols for the next 30 and 90 day periods, and specific conservation management actions suitable for immediate implementation.';

// JSON payload written to /tmp/payload.json inside the container.
// Payload is embedded as a here-doc to avoid shell quoting problems.
const PAYLOAD_JSON = JSON.stringify({
  prompt: PROMPT,
  n_predict: 180,
  ignore_eos: true,
  temperature: 0.0,
  cache_prompt: false,
});

// Escape single quotes for the shell here-doc PAYLOAD_END delimiter region.
// The JSON value itself does not contain PAYLOAD_END on its own line.
const BASH_CMD = `set -euo pipefail

T_JOB_START=\$(date +%s%3N)
>&2 echo "[probe] job started ms=\$T_JOB_START"

# ── 1. Download model ───────────────────────────────────────────────────────
MODEL_URL="https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
>&2 echo "[probe] downloading model (~4.9 GB)..."
curl -fL -o /tmp/model.gguf "\$MODEL_URL" >&2
T_DOWNLOAD_DONE=\$(date +%s%3N)
>&2 echo "[probe] download done in \$(( (T_DOWNLOAD_DONE - T_JOB_START) / 1000 ))s"

# ── 2. Start llama-server ───────────────────────────────────────────────────
# Redirect server output to log file; keep stderr free for probe progress.
# -ngl 99: offload all layers to GPU
# -np 32:  32 parallel decode slots (matches batch size)
# -c 40960: context = 32 * 1280 (> 32 * 1130 tokens per request)
>&2 echo "[probe] starting llama-server -ngl 99 -np 32 -c 40960..."
/llama-server \\
  -m /tmp/model.gguf \\
  -ngl 99 \\
  -np 32 \\
  -c 40960 \\
  --port 8080 \\
  > /tmp/server.log 2>&1 &
SRV_PID=\$!
T_SERVER_START=\$(date +%s%3N)

# ── 3. Wait for server ready (max 180 s) ────────────────────────────────────
SERVER_READY=0
for i in \$(seq 1 90); do
  sleep 2
  if curl -sf http://127.0.0.1:8080/health 2>/dev/null | grep -q '"ok"'; then
    SERVER_READY=1
    break
  fi
done

if [ "\$SERVER_READY" -eq 0 ]; then
  >&2 echo "[probe] FATAL: server not ready after 180s"
  >&2 cat /tmp/server.log
  exit 1
fi
T_SERVER_READY=\$(date +%s%3N)
>&2 echo "[probe] server ready in \$(( (T_SERVER_READY - T_SERVER_START) / 1000 ))s"

# ── 4. Verify CUDA offload from server log ──────────────────────────────────
# llama-server logs CUDA initialisation and layer offload counts to stdout.
CUDA_LOG_MATCHES=\$(grep -ci "cuda\\|n_gpu_layers\\|offload\\|ggml_cuda" /tmp/server.log 2>/dev/null || echo "0")
OFFLOAD_EVIDENCE=\$(grep -i "offload\\|n_gpu_layers\\|ggml_cuda_init" /tmp/server.log 2>/dev/null | head -3 | tr '\\n' '|' || echo "none")
>&2 echo "[probe] cuda_log_matches=\$CUDA_LOG_MATCHES"
>&2 echo "[probe] offload_evidence=\$OFFLOAD_EVIDENCE"

if [ "\$CUDA_LOG_MATCHES" -eq 0 ]; then
  >&2 echo "[probe] WARNING: no CUDA lines in server log — this run may be CPU-only and invalid"
fi

# ── 5. Write JSON payload ───────────────────────────────────────────────────
# Synthetic prompt ~950 tokens (4-char/token heuristic); SYNTHETIC-APPROX.
cat > /tmp/payload.json << 'PAYLOAD_END'
${PAYLOAD_JSON}
PAYLOAD_END

# ── 6. Run 200 Readings in batches of 32 ────────────────────────────────────
T_BENCH_START=\$(date +%s%3N)
>&2 echo "[probe] benchmark start ms=\$T_BENCH_START"

run_batch() {
  local batch_id=\$1 count=\$2
  for i in \$(seq 1 \$count); do
    curl -sf -X POST http://127.0.0.1:8080/completion \\
      -H "Content-Type: application/json" \\
      -d @/tmp/payload.json \\
      -o "/tmp/out_\${batch_id}_\${i}.json" &
  done
  wait
  >&2 echo "[probe] batch \$batch_id done (\$count reqs)"
}

run_batch 1 32
run_batch 2 32
run_batch 3 32
run_batch 4 32
run_batch 5 32
run_batch 6 32
run_batch 7 8

T_BENCH_END=\$(date +%s%3N)
>&2 echo "[probe] benchmark done in \$(( (T_BENCH_END - T_BENCH_START) / 1000 ))s"

# ── 7. Extract 3 sample completions ─────────────────────────────────────────
# awk splits on the JSON key; takes text up to the next bare double-quote.
# Works for LLM prose output without embedded quotes; noted as APPROX in evidence.
get_sample() {
  awk -F'"content":"' 'NF>1{split(\$2,a,"\\""); print a[1]; exit}' "\$1" 2>/dev/null \\
    | head -c 250 | tr -d '\\r\\n' || echo ""
}
S1=\$(get_sample /tmp/out_1_1.json)
S2=\$(get_sample /tmp/out_1_2.json)
S3=\$(get_sample /tmp/out_1_3.json)

kill "\$SRV_PID" 2>/dev/null || true

# ── 8. JSON escape helper ───────────────────────────────────────────────────
json_esc() {
  printf '%s' "\$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g' | tr -d '\\r\\n'
}

# ── 9. Emit single JSON line to stdout (parsed by wrapper) ──────────────────
printf '{"probe":"inference-throughput","t_job_start_ms":%s,"t_download_done_ms":%s,"t_server_start_ms":%s,"t_server_ready_ms":%s,"t_bench_start_ms":%s,"t_bench_end_ms":%s,"total_wall_ms":%s,"steady_state_ms":%s,"completed_readings":200,"cuda_log_matches":%s,"offload_evidence":"%s","model":"Meta-Llama-3.1-8B-Instruct","engine":"llama.cpp","quantisation":"Q4_K_M","server_flags":"-ngl 99 -np 32 -c 40960","prompt_tokens_approx":950,"prompt_note":"synthetic-prose-4-char-heuristic","n_predict":180,"ignore_eos":true,"sample_1":"%s","sample_2":"%s","sample_3":"%s"}\\n' \\
  "\$T_JOB_START" "\$T_DOWNLOAD_DONE" "\$T_SERVER_START" "\$T_SERVER_READY" \\
  "\$T_BENCH_START" "\$T_BENCH_END" \\
  "\$((T_BENCH_END - T_JOB_START))" "\$((T_BENCH_END - T_BENCH_START))" \\
  "\$CUDA_LOG_MATCHES" \\
  "\$(json_esc "\$OFFLOAD_EVIDENCE")" \\
  "\$(json_esc "\$S1")" \\
  "\$(json_esc "\$S2")" \\
  "\$(json_esc "\$S3")"
`;

export const INFERENCE_THROUGHPUT_JOB_DEF = {
  version: '0.1',
  type: 'container',
  meta: { trigger: 'api' },
  ops: [
    {
      type: 'container/run',
      id: 'inference-throughput',
      args: {
        // CUDA build: GPU layers offloaded via -ngl 99; plain :server tag is CPU-only.
        image: 'ghcr.io/ggml-org/llama.cpp:server-cuda',
        cmd: ['/bin/bash', '-c', BASH_CMD],
        gpu: true,
      },
    },
  ],
};

// ── Constants for demand computation ─────────────────────────────────────────
const RUNG4_WAKES_DAY1 = 178_757;      // measured first-day wakes (rung 4)
const TOKENS_PER_READING = 1_130;       // 950 prompt + 180 completion (rung 1)
const NOS_RAW_PER_SEC = 240;            // RTX 4090 market rate (from real-receipt.json)
const NOS_RAW_PER_NOS = 1_000_000;     // 1 NOS = 1,000,000 raw
const NOS_USD_PRICE = 0.4026;          // CoinGecko 2026-11-11
const NOS_USD_DATE  = '2026-11-11';    // snapshot date for price

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const walletPath = process.env['WALLET_PATH'];
  if (!walletPath && !process.env['NOSANA_WALLET_PRIVATE_KEY']) {
    console.error('Set WALLET_PATH or NOSANA_WALLET_PRIVATE_KEY');
    process.exit(1);
  }

  console.log('Submitting inference throughput probe to RTX 4090 market...');
  console.log('Job def: llama.cpp server-cuda, Meta-Llama-3.1-8B Q4_K_M, 200 Readings');

  const receipt = await wrapNosanaJob(INFERENCE_THROUGHPUT_JOB_DEF, {
    market:         RTX_4090_MARKET,
    walletPath,
    walletEnvVar:   'NOSANA_WALLET_PRIVATE_KEY',
    pollIntervalMs: 10_000,
    timeoutMs:      900_000,   // 15 min — model download + load + 200 inference requests
    jobTimeoutSecs: 900,
  });

  console.log('\nJob', receipt.job_id, '→', receipt.outcome_code);

  if (receipt.outcome_code !== 'ok') {
    console.error('Job did not succeed:', receipt.outcome_code);
    writeFileSync(
      join(ROOT, 'evidence', 'inference-throughput-receipt.json'),
      JSON.stringify(receipt, null, 2),
    );
    process.exit(1);
  }

  // ── Fetch IPFS result to extract stdout ──────────────────────────────────
  const { Client } = await import('@nosana/sdk') as { Client: any };
  const walletRaw = walletPath
    ? (await import('fs')).readFileSync(walletPath, 'utf-8').trim()
    : (process.env['NOSANA_WALLET_PRIVATE_KEY'] ?? '');
  const client = new Client('mainnet', walletRaw as never);

  let probeOutput: ProbeOutput | null = null;

  if (receipt.ipfs_cid) {
    try {
      const flowState = await client.ipfs.retrieve(receipt.ipfs_cid) as any;
      const opState = flowState?.opStates?.[0];
      const stdoutLines: string[] = (opState?.logs ?? [])
        .filter((l: any) => l.type === 'stdout' && l.log)
        .map((l: any) => l.log as string);
      const stdout = stdoutLines.join('');
      if (stdout.trim()) {
        probeOutput = JSON.parse(stdout.trim()) as ProbeOutput;
        console.log('\nProbe output parsed successfully');
      }
    } catch (err) {
      console.warn('Could not parse IPFS stdout:', String(err));
    }
  }

  // ── Build full receipt ────────────────────────────────────────────────────
  const fullReceipt: InferenceReceipt = {
    ...receipt,
    inference_probe: probeOutput ?? null,
  };

  writeFileSync(
    join(ROOT, 'evidence', 'inference-throughput-receipt.json'),
    JSON.stringify(fullReceipt, null, 2),
  );
  console.log('Wrote evidence/inference-throughput-receipt.json');

  if (!probeOutput) {
    console.error('No probe output — cannot write demand estimate');
    process.exit(1);
  }

  // ── Compute demand figures ────────────────────────────────────────────────
  const steadyMs   = probeOutput.steady_state_ms;
  const totalMs    = probeOutput.total_wall_ms;
  const readings   = probeOutput.completed_readings;        // 200
  const readingsPerSec = (readings / steadyMs) * 1000;      // steady-state only
  const tokensPerSec   = readingsPerSec * TOKENS_PER_READING;

  // Daily demand from rung-4 measured first-day figure
  const gpuHoursPerDay = RUNG4_WAKES_DAY1 / readingsPerSec / 3600;
  const nosRawPerDay   = gpuHoursPerDay * 3600 * NOS_RAW_PER_SEC;
  const nosPerDay      = nosRawPerDay / NOS_RAW_PER_NOS;
  const usdPerDay      = nosPerDay * NOS_USD_PRICE;

  // Cost for the probe job itself
  const jobDurationSec = (receipt.settled_at && receipt.claimed_at)
    ? (new Date(receipt.settled_at).getTime() - new Date(receipt.claimed_at).getTime()) / 1000
    : null;
  const depositNosRaw  = NOS_RAW_PER_SEC * 900;   // market rate × jobTimeoutSecs
  const netCostNosRaw  = receipt.cost_nos ?? 0;
  const refundNosRaw   = depositNosRaw - netCostNosRaw;

  const toNos  = (raw: number) => (raw / NOS_RAW_PER_NOS).toFixed(6);
  const toUsd  = (nos: number) => (nos * NOS_USD_PRICE).toFixed(4);

  // ── Write evidence/nosana-priced-demand.md ────────────────────────────────
  const md = `# Nosana-Priced Demand Estimate

> **ESTIMATE** where extrapolated (marked inline). Measured throughput from a single RTX 4090 job on the Nosana mainnet (2026-11-11).

---

## Probe parameters

| Parameter | Value |
|-----------|-------|
| Model | Meta-Llama-3.1-8B-Instruct |
| Quantisation | Q4_K_M (llama.cpp) |
| Engine | llama.cpp server-cuda (ghcr.io/ggml-org/llama.cpp:server-cuda) |
| Server flags | \`-ngl 99 -np 32 -c 40960\` |
| Readings | ${readings} (synthetic prompt, \`n_predict 180\`, \`ignore_eos true\`) |
| Prompt tokens | ~${probeOutput.prompt_tokens_approx} (${probeOutput.prompt_note}) |
| Completion tokens | 180 (exact, \`ignore_eos\`) |
| Tokens per Reading | ${TOKENS_PER_READING} |
| GPU class | RTX 4090 |
| Market | \`${RTX_4090_MARKET}\` |

---

## Measured throughput

| Metric | Value |
|--------|-------|
| Total job wall time | ${(totalMs / 1000).toFixed(1)} s (image pull + model download + load + inference) |
| Steady-state inference time | ${(steadyMs / 1000).toFixed(1)} s (first request → last completion) |
| Readings completed | ${readings} |
| **Readings/sec (steady-state)** | **${readingsPerSec.toFixed(3)}** |
| Tokens/sec (steady-state) | ${tokensPerSec.toFixed(1)} |
| CUDA layer offload | ${probeOutput.offload_evidence || '(see receipt)'} |
| CUDA log line count | ${probeOutput.cuda_log_matches} |

---

## Daily demand projection — ESTIMATE

Rung-4 baseline: **${RUNG4_WAKES_DAY1.toLocaleString()} wakes** (first day after full-fleet registration, 2026-11-10).

> **ESTIMATE**: Assumes steady-state throughput measured above scales linearly. A production deployment would use multiple nodes, reducing latency but not changing total GPU-hours. Throughput on a faster engine (e.g. vLLM) or larger quantisation would lower GPU-hours; Q4_K_M llama.cpp is a conservative baseline.

| Metric | Calculation | Value |
|--------|-------------|-------|
| Wakes per day | measured, rung 4 | ${RUNG4_WAKES_DAY1.toLocaleString()} |
| Readings/sec (this probe) | measured | ${readingsPerSec.toFixed(3)} |
| **GPU-hours/day** | ${RUNG4_WAKES_DAY1.toLocaleString()} ÷ ${readingsPerSec.toFixed(3)} ÷ 3600 | **${gpuHoursPerDay.toFixed(2)} GPU-h** |
| NOS raw/day | ${gpuHoursPerDay.toFixed(2)} × 3600 × ${NOS_RAW_PER_SEC} raw/s | ${nosRawPerDay.toFixed(0)} |
| **NOS/day** | ÷ ${NOS_RAW_PER_NOS.toLocaleString()} | **${nosPerDay.toFixed(4)} NOS** |
| **USD/day** | ${nosPerDay.toFixed(4)} NOS × $${NOS_USD_PRICE} (NOS, ${NOS_USD_DATE}, CoinGecko) | **$${usdPerDay.toFixed(4)}** |

> Note on NOS price: $${NOS_USD_PRICE} is a point-in-time snapshot (${NOS_USD_DATE}, CoinGecko). Grant amounts should be denominated in NOS, not USD.

---

## Probe job cost — deposit / refund / net

| | NOS raw | NOS | USD (@ $${NOS_USD_PRICE}, ${NOS_USD_DATE}) |
|-|---------|-----|------|
| **Deposit** (escrow locked at submit) | ${depositNosRaw.toLocaleString()} | ${toNos(depositNosRaw)} NOS | $${toUsd(depositNosRaw / NOS_RAW_PER_NOS)} |
| **Net cost** (ATA debit, from receipt) | ${netCostNosRaw.toLocaleString()} | ${toNos(netCostNosRaw)} NOS | $${toUsd(netCostNosRaw / NOS_RAW_PER_NOS)} |
| **Refund** (deposit minus net) | ${refundNosRaw.toLocaleString()} | ${toNos(refundNosRaw)} NOS | $${toUsd(refundNosRaw / NOS_RAW_PER_NOS)} |

Job ID: \`${receipt.job_id}\`
Market rate: ${NOS_RAW_PER_SEC} raw/s = ${(NOS_RAW_PER_SEC / NOS_RAW_PER_NOS * 3600).toFixed(4)} NOS/GPU-hour
${jobDurationSec !== null ? `Actual job duration (claimed → settled): ${jobDurationSec.toFixed(0)} s` : ''}

---

## Sample completions (3 of 200)

> APPROX: extracted via awk split on JSON key; truncated at 250 chars. Full completions in \`inference-throughput-receipt.json\`.

**Sample 1:**
> ${probeOutput.sample_1 || '(empty)'}

**Sample 2:**
> ${probeOutput.sample_2 || '(empty)'}

**Sample 3:**
> ${probeOutput.sample_3 || '(empty)'}

---

## Methodology notes

- Engine: llama.cpp Q4_K_M. A faster engine (vLLM, TensorRT-LLM) or FP16 quantisation would yield higher Readings/sec and lower GPU-hours/day.
- Prompt: synthetic English prose, \`prompt_tokens_approx=${probeOutput.prompt_tokens_approx}\` by 4-char/token heuristic. Actual production prompts (rung 1: 950 tokens measured) may differ slightly.
- Throughput: steady-state only (excludes model download/load). Daily projection uses steady-state.
- Fleet: 580,551 twins, 594 ecoregions (rung 4). First-day wakes (178,757) are a measured baseline; daily wakes will vary with event cadence.
`;

  writeFileSync(join(ROOT, 'evidence', 'nosana-priced-demand.md'), md);
  console.log('Wrote evidence/nosana-priced-demand.md');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`
=== Throughput probe complete ===
  Readings/sec (steady-state): ${readingsPerSec.toFixed(3)}
  Tokens/sec:                  ${tokensPerSec.toFixed(1)}
  GPU-hours/day (ESTIMATE):    ${gpuHoursPerDay.toFixed(2)}
  NOS/day (ESTIMATE):          ${nosPerDay.toFixed(4)}
  USD/day (ESTIMATE):          $${usdPerDay.toFixed(4)}
  Job net cost:                ${toNos(netCostNosRaw)} NOS ($${toUsd(netCostNosRaw / NOS_RAW_PER_NOS)})
`);
}

interface ProbeOutput {
  probe: string;
  t_job_start_ms: number;
  t_download_done_ms: number;
  t_server_start_ms: number;
  t_server_ready_ms: number;
  t_bench_start_ms: number;
  t_bench_end_ms: number;
  total_wall_ms: number;
  steady_state_ms: number;
  completed_readings: number;
  cuda_log_matches: number;
  offload_evidence: string;
  model: string;
  engine: string;
  quantisation: string;
  server_flags: string;
  prompt_tokens_approx: number;
  prompt_note: string;
  n_predict: number;
  ignore_eos: boolean;
  sample_1: string;
  sample_2: string;
  sample_3: string;
}

interface InferenceReceipt extends Receipt {
  inference_probe: ProbeOutput | null;
}

main().catch(err => { console.error(err); process.exit(1); });
