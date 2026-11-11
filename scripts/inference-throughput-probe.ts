/**
 * Inference throughput probe — llama.cpp on Nosana RTX 4090 market.
 *
 * Measures Readings/sec for the Eden 10k-fleet Nosana grant demand estimate.
 * One job: download Meta-Llama-3.1-8B-Instruct Q4_K_M, start llama-server
 * (server-cuda, -ngl 99 -np 32 -c 40960), run 200 synthetic Readings (950
 * prompt + 180 completion tokens), report steady-state throughput.
 *
 * Usage:
 *   WALLET_PATH=/path/to/keypair.json npx tsx scripts/inference-throughput-probe.ts
 *
 * Image verification (ghcr.io/ggml-org/llama.cpp:server-cuda, 2026-11-11):
 *   - ENTRYPOINT: ["/app/llama-server"]  → overridden via entrypoint field
 *   - Binary: /app/llama-server
 *   - curl: yes (installed in build stage)
 *   - python3: no (server stage only; all parsing uses awk/grep/sed)
 *   - bash: yes (Ubuntu 24.04 base)
 *   - Base: nvidia/cuda:12.8.1-runtime-ubuntu24.04
 *
 * Writes on completion:
 *   evidence/inference-throughput-receipt.json  — schema-valid receipt
 *   evidence/nosana-priced-demand.md            — ESTIMATE-labelled demand figures
 */

import { wrapNosanaJob } from '../src/index.js';
import type { Receipt } from '../src/index.js';
import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

// RTX 4090 markets (Nosana public API, 2026-11-11):
//   97G9…odAf — "NVIDIA 4090" (PREMIUM, 24 GB VRAM)        ← default
//   Dcwz62…zXy8 — "NVIDIA 4090 Community" (COMMUNITY, 24 GB VRAM)
// Override with env var NOSANA_MARKET or --market <address> CLI arg.
const RTX_4090_PREMIUM   = '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf';
const RTX_4090_COMMUNITY = 'Dcwz62TisNbWuto6KJM2EGYGVKnHbdZGVGmgLASzsXy8';
const marketArg = process.argv.find(a => a.startsWith('--market='))?.split('=')[1]
               ?? process.argv[process.argv.indexOf('--market') + 1];
const MARKET = (marketArg && marketArg !== 'undefined')
  ? marketArg
  : (process.env['NOSANA_MARKET'] ?? RTX_4090_PREMIUM);

const NOS_MINT_STR    = 'nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7';
const RPC_URL         = 'https://api.mainnet-beta.solana.com';

// Synthetic prompt. Actual token count reported by llama.cpp (tokens_evaluated)
// replaces the heuristic estimate in the evidence file.
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

const PAYLOAD_JSON = JSON.stringify({
  prompt: PROMPT,
  n_predict: 180,
  ignore_eos: true,
  temperature: 0.0,
  cache_prompt: false,
});

// ── Bash job script ───────────────────────────────────────────────────────────
// Runs inside ghcr.io/ggml-org/llama.cpp:server-cuda with /bin/bash as the
// entrypoint (see job def below — ENTRYPOINT override required).
// All progress goes to stderr; a single JSON line goes to stdout.
// $VAR shell vars are safe in TS template literals; \${VAR} produces ${VAR} in bash.
const BASH_CMD = `set -euo pipefail

T_JOB_START=\$(date +%s%3N)
>&2 echo "[probe] job started ms=\$T_JOB_START"

# ── 1. nvidia-smi: record GPU identity before anything else ─────────────────
NVIDIASMI=\$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "unavailable")
>&2 echo "[probe] gpu: \$NVIDIASMI"

# ── 2. Download model (~4.9 GB) ──────────────────────────────────────────────
MODEL_URL="https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
>&2 echo "[probe] downloading model..."
curl -fL -o /tmp/model.gguf "\$MODEL_URL" >&2
T_DOWNLOAD_DONE=\$(date +%s%3N)
>&2 echo "[probe] download done in \$(( (T_DOWNLOAD_DONE - T_JOB_START) / 1000 ))s"

# ── 3. Start llama-server ────────────────────────────────────────────────────
# ENTRYPOINT is overridden in the Nosana job def; binary is at /app/llama-server.
# Server stdout+stderr → /tmp/server.log for CUDA verification.
>&2 echo "[probe] starting /app/llama-server -ngl 99 -np 32 -c 40960..."
/app/llama-server \\
  -m /tmp/model.gguf \\
  -ngl 99 \\
  -np 32 \\
  -c 40960 \\
  --port 8080 \\
  > /tmp/server.log 2>&1 &
SRV_PID=\$!
T_SERVER_START=\$(date +%s%3N)

# ── 4. Wait for server ready (max 180 s) ─────────────────────────────────────
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

# ── 5. HARD FAIL if not all layers offloaded to GPU ──────────────────────────
# llama-server logs: "llm_load_tensors: offloaded N/N layers to GPU"
# Both numbers must match; if not, the run is CPU-only and invalid.
OFFLOAD_LINE=\$(grep "offloaded.*layers to GPU" /tmp/server.log 2>/dev/null | tail -1 || echo "")
if [ -z "\$OFFLOAD_LINE" ]; then
  >&2 echo "[probe] FATAL: no 'offloaded N/N layers to GPU' line found in server log"
  >&2 cat /tmp/server.log
  exit 1
fi

NUM_OFF=\$(echo "\$OFFLOAD_LINE" | grep -oE "offloaded [0-9]+" | grep -oE "[0-9]+" || echo "0")
NUM_TOT=\$(echo "\$OFFLOAD_LINE" | grep -oE "[0-9]+/[0-9]+" | cut -d/ -f2 || echo "-1")

if [ "\$NUM_OFF" != "\$NUM_TOT" ] || [ "\$NUM_OFF" = "0" ]; then
  >&2 echo "[probe] FATAL: only \${NUM_OFF}/\${NUM_TOT} layers offloaded — GPU offload incomplete"
  >&2 cat /tmp/server.log
  exit 1
fi
>&2 echo "[probe] CUDA OK: offloaded \${NUM_OFF}/\${NUM_TOT} layers to GPU"

# ── 6. Write JSON payload ─────────────────────────────────────────────────────
# Actual prompt token count comes from llama.cpp's tokens_evaluated per response.
cat > /tmp/payload.json << 'PAYLOAD_END'
${PAYLOAD_JSON}
PAYLOAD_END

# ── 7. Run 200 Readings in batches of 32 ─────────────────────────────────────
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

# ── 8. Count real successes and extract per-response token counts ─────────────
# A success = output file exists and tokens_predicted == 180.
# tokens_evaluated = actual prompt token count (llama.cpp's own tokeniser).
SUCCESS_COUNT=0
SUM_TOKENS_EVALUATED=0

for b in 1 2 3 4 5 6 7; do
  if [ "\$b" -lt 7 ]; then COUNT=32; else COUNT=8; fi
  for i in \$(seq 1 \$COUNT); do
    f="/tmp/out_\${b}_\${i}.json"
    if [ -f "\$f" ] && [ -s "\$f" ]; then
      TP=\$(awk -F'"tokens_predicted":' 'NF>1{split(\$2,a,","); gsub(/[^0-9]/,"",a[1]); print a[1]; exit}' "\$f" 2>/dev/null || echo "0")
      TE=\$(awk -F'"tokens_evaluated":' 'NF>1{split(\$2,a,","); gsub(/[^0-9]/,"",a[1]); print a[1]; exit}' "\$f" 2>/dev/null || echo "0")
      if [ "\$TP" = "180" ]; then
        SUCCESS_COUNT=\$((SUCCESS_COUNT + 1))
        SUM_TOKENS_EVALUATED=\$((SUM_TOKENS_EVALUATED + TE))
      fi
    fi
  done
done

if [ "\$SUCCESS_COUNT" -lt 200 ]; then
  >&2 echo "[probe] FATAL: only \$SUCCESS_COUNT/200 Readings completed with tokens_predicted=180"
  exit 1
fi
MEAN_TOKENS_EVALUATED=\$((SUM_TOKENS_EVALUATED / SUCCESS_COUNT))
>&2 echo "[probe] SUCCESS_COUNT=\$SUCCESS_COUNT MEAN_TOKENS_EVALUATED=\$MEAN_TOKENS_EVALUATED"

# ── 9. Extract 3 full sample completions ─────────────────────────────────────
# sed extracts text between "content":" and ","stop":, then unescapes \n → space.
# A "full" extraction — no artificial char limit beyond the JSON field boundary.
# May truncate at embedded quote in content (prose text; unlikely for 180 tok completions).
get_sample() {
  sed -n 's/.*"content":"\\(.*\\)","stop":.*/\\1/p' "\$1" 2>/dev/null \\
    | sed 's/\\\\n/ /g; s/\\\\t/ /g; s/\\\\"/'"'"'/g' \\
    | tr -d '\\r\\n' || echo ""
}
S1=\$(get_sample /tmp/out_1_1.json)
S2=\$(get_sample /tmp/out_1_2.json)
S3=\$(get_sample /tmp/out_1_3.json)

kill "\$SRV_PID" 2>/dev/null || true

# ── 10. JSON escape helper ────────────────────────────────────────────────────
json_esc() {
  printf '%s' "\$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g' | tr -d '\\r\\n'
}

# ── 11. Emit single JSON line to stdout ───────────────────────────────────────
printf '{"probe":"inference-throughput","t_job_start_ms":%s,"t_download_done_ms":%s,"t_server_start_ms":%s,"t_server_ready_ms":%s,"t_bench_start_ms":%s,"t_bench_end_ms":%s,"total_wall_ms":%s,"steady_state_ms":%s,"completed_readings":%s,"mean_tokens_evaluated":%s,"tokens_predicted_all_180":true,"cuda_offload_all":true,"offload_line":"%s","nvidia_smi":"%s","model":"Meta-Llama-3.1-8B-Instruct","engine":"llama.cpp","quantisation":"Q4_K_M","server_flags":"-ngl 99 -np 32 -c 40960","n_predict":180,"ignore_eos":true,"sample_1":"%s","sample_2":"%s","sample_3":"%s"}\\n' \\
  "\$T_JOB_START" "\$T_DOWNLOAD_DONE" "\$T_SERVER_START" "\$T_SERVER_READY" \\
  "\$T_BENCH_START" "\$T_BENCH_END" \\
  "\$((T_BENCH_END - T_JOB_START))" "\$((T_BENCH_END - T_BENCH_START))" \\
  "\$SUCCESS_COUNT" "\$MEAN_TOKENS_EVALUATED" \\
  "\$(json_esc "\$OFFLOAD_LINE")" \\
  "\$(json_esc "\$NVIDIASMI")" \\
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
        // server-cuda image has ENTRYPOINT ["/app/llama-server"]; override it so
        // /bin/bash -c runs our script rather than passing bash as llama-server args.
        // Binary at /app/llama-server; curl and bash confirmed present in image.
        image:      'ghcr.io/ggml-org/llama.cpp:server-cuda',
        entrypoint: ['/bin/bash'],
        cmd:        ['-c', BASH_CMD],
        gpu:        true,
      },
    },
  ],
};

// ── Constants ─────────────────────────────────────────────────────────────────
const RUNG4_WAKES_DAY1  = 178_757;   // measured first-day wakes (rung 4)
const TOKENS_PER_READING = 1_130;    // 950 prompt + 180 completion (rung 1 measured)
const NOS_RAW_PER_NOS   = 1_000_000; // 1 NOS = 1,000,000 raw
const NOS_USD_PRICE     = 0.4026;    // CoinGecko 2026-11-11
const NOS_USD_DATE      = '2026-11-11';

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const walletPath = process.env['WALLET_PATH'];
  if (!walletPath && !process.env['NOSANA_WALLET_PRIVATE_KEY']) {
    console.error('Set WALLET_PATH or NOSANA_WALLET_PRIVATE_KEY');
    process.exit(1);
  }

  // Load wallet without printing it
  const walletRaw = walletPath
    ? readFileSync(walletPath, 'utf-8').trim()
    : (process.env['NOSANA_WALLET_PRIVATE_KEY'] ?? '');

  const { Client } = await import('@nosana/sdk') as { Client: any };
  const client = new Client('mainnet', walletRaw as never);

  // ── Pre-flight: query market price on-chain ───────────────────────────────
  const { Connection, PublicKey } = await import('@solana/web3.js') as any;
  const connection = new Connection(RPC_URL, 'confirmed');
  const marketSlot = await connection.getSlot();
  console.log(`Using market: ${MARKET}`);
  const market = await client.jobs.getMarket(MARKET) as any;
  // jobPrice is a BN (raw NOS per second)
  const marketPriceRaw: number = typeof market.jobPrice?.toNumber === 'function'
    ? market.jobPrice.toNumber()
    : Number(market.jobPrice);
  const marketPriceNosPerHour = (marketPriceRaw / NOS_RAW_PER_NOS) * 3600;

  console.log(`Market ${MARKET}`);
  console.log(`  jobPrice: ${marketPriceRaw} raw/s = ${marketPriceNosPerHour.toFixed(4)} NOS/GPU-hour  (slot ${marketSlot})`);

  // ── Submit job ────────────────────────────────────────────────────────────
  console.log('\nSubmitting inference throughput probe to RTX 4090 market...');

  const receipt = await wrapNosanaJob(INFERENCE_THROUGHPUT_JOB_DEF, {
    market:         MARKET,
    walletPath,
    walletEnvVar:   'NOSANA_WALLET_PRIVATE_KEY',
    pollIntervalMs: 10_000,
    timeoutMs:      900_000,   // 15 min
    jobTimeoutSecs: 900,
  });

  console.log('\nJob', receipt.job_id, '→', receipt.outcome_code);

  if (receipt.outcome_code !== 'ok') {
    console.error('Job did not succeed:', receipt.outcome_code);
    writeFileSync(
      join(ROOT, 'evidence', 'inference-throughput-receipt.json'),
      JSON.stringify({ ...receipt, market_price_raw_per_sec: marketPriceRaw, market_price_slot: marketSlot }, null, 2),
    );
    process.exit(1);
  }

  // ── Fetch IPFS result to extract probe stdout ─────────────────────────────
  let probeOutput: ProbeOutput | null = null;

  if (receipt.ipfs_cid) {
    try {
      const flowState = await client.ipfs.retrieve(receipt.ipfs_cid) as any;
      const opState = flowState?.opStates?.[0];
      const stdoutLines: string[] = (opState?.logs ?? [])
        .filter((l: any) => l.type === 'stdout' && l.log)
        .map((l: any) => l.log as string);
      const stdout = stdoutLines.join('').trim();
      if (stdout) {
        probeOutput = JSON.parse(stdout) as ProbeOutput;
        console.log('Probe output parsed — completed_readings:', probeOutput.completed_readings,
          'mean_tokens_evaluated:', probeOutput.mean_tokens_evaluated);
      }
    } catch (err) {
      console.warn('Could not parse IPFS stdout:', String(err));
    }
  }

  // ── Deposit / refund from ATA transaction history ─────────────────────────
  const costBreakdown = await fetchAtaJobCostBreakdown(connection, client, receipt);
  console.log(`Cost breakdown (${costBreakdown.source}):`,
    `deposit=${costBreakdown.deposit_raw} refund=${costBreakdown.refund_raw} net=${costBreakdown.net_raw}`);

  // ── Write receipt ─────────────────────────────────────────────────────────
  const fullReceipt: InferenceReceipt = {
    ...receipt,
    market_price_raw_per_sec: marketPriceRaw,
    market_price_slot:        marketSlot,
    cost_breakdown:           costBreakdown,
    inference_probe:          probeOutput,
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
  const steadyMs       = probeOutput.steady_state_ms;
  const totalMs        = probeOutput.total_wall_ms;
  const readings       = probeOutput.completed_readings;
  const meanPromptToks = probeOutput.mean_tokens_evaluated;
  // Use actual measured token count per Reading (not the fixed 1,130 baseline)
  const tokensPerReading = meanPromptToks + 180;
  const readingsPerSec = (readings / steadyMs) * 1000;
  const tokensPerSec   = readingsPerSec * tokensPerReading;

  const jobDurationSec = (receipt.settled_at && receipt.claimed_at)
    ? (new Date(receipt.settled_at).getTime() - new Date(receipt.claimed_at).getTime()) / 1000
    : null;

  const depositRaw = costBreakdown.deposit_raw;
  const refundRaw  = costBreakdown.refund_raw;
  const netRaw     = costBreakdown.net_raw;

  // Effective rate actually paid = net_raw ÷ job duration in seconds.
  // This captures any network fee or escrow rounding not visible in chain jobPrice.
  // Chain jobPrice (marketPriceRaw) is the base rate; effective rate is what left the wallet.
  const effectiveRateRaw: number | null =
    (jobDurationSec !== null && jobDurationSec > 0 && netRaw > 0)
      ? netRaw / jobDurationSec
      : null;
  // Use effective rate for the demand projection if we have it; fall back to chain jobPrice.
  const demandRateRaw  = effectiveRateRaw ?? marketPriceRaw;
  const rateSource     = effectiveRateRaw !== null ? 'effective (net ÷ duration)' : 'chain jobPrice (fallback)';
  const rateDiscrepancy = effectiveRateRaw !== null
    ? Math.abs(effectiveRateRaw - marketPriceRaw) / marketPriceRaw
    : 0;

  const gpuHoursPerDay = RUNG4_WAKES_DAY1 / readingsPerSec / 3600;
  const nosRawPerDay   = gpuHoursPerDay * 3600 * demandRateRaw;
  const nosPerDay      = nosRawPerDay / NOS_RAW_PER_NOS;
  const usdPerDay      = nosPerDay * NOS_USD_PRICE;

  const toNos = (raw: number) => (raw / NOS_RAW_PER_NOS).toFixed(6);
  const toUsd = (nos: number) => (nos * NOS_USD_PRICE).toFixed(4);

  // Resolved market name for display
  const MARKET_NAMES: Record<string, string> = {
    '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf': 'NVIDIA 4090 (PREMIUM)',
    'Dcwz62TisNbWuto6KJM2EGYGVKnHbdZGVGmgLASzsXy8': 'NVIDIA 4090 Community (COMMUNITY)',
  };
  const marketName = MARKET_NAMES[MARKET] ?? 'unknown';

  // ── Write nosana-priced-demand.md ─────────────────────────────────────────
  const md = `# Nosana-Priced Demand Estimate

> **ESTIMATE** where extrapolated (marked inline). Measured throughput from a single RTX 4090 job on the Nosana mainnet (${NOS_USD_DATE}).

---

## Image verification

| Check | Result |
|-------|--------|
| Image | \`ghcr.io/ggml-org/llama.cpp:server-cuda\` |
| ENTRYPOINT in image | \`/app/llama-server\` — overridden via \`entrypoint: ["/bin/bash"]\` in job def |
| Binary path confirmed | \`/app/llama-server\` |
| curl in image | yes (confirmed from Dockerfile) |
| python3 in image | no (server stage only; all parsing uses awk/grep/sed) |
| bash in image | yes (Ubuntu 24.04 base) |

---

## Probe parameters

| Parameter | Value |
|-----------|-------|
| Model | Meta-Llama-3.1-8B-Instruct |
| Quantisation | Q4_K_M (llama.cpp) |
| Engine | llama.cpp server-cuda |
| Server flags | \`-ngl 99 -np 32 -c 40960\` |
| Readings | ${readings} |
| Prompt tokens | **${meanPromptToks}** (mean \`tokens_evaluated\` per response — llama.cpp's own tokeniser) |
| Completion tokens | 180 exact (\`n_predict 180\`, \`ignore_eos true\`) |
| Tokens per Reading | ${meanPromptToks} + 180 = ${meanPromptToks + 180} |
| GPU | ${probeOutput.nvidia_smi} |
| CUDA offload | ${probeOutput.offload_line} |
| Market | \`${MARKET}\` — ${marketName} |
| Market (chain jobPrice) | ${marketPriceRaw} raw/s = ${marketPriceNosPerHour.toFixed(4)} NOS/GPU-hour (slot ${marketSlot}) |
| Public API price | 0.000275 NOS/s = 275 raw/s (network fee included) |
| Effective rate paid | ${effectiveRateRaw !== null ? `${effectiveRateRaw.toFixed(1)} raw/s (net ${netRaw} raw ÷ ${jobDurationSec!.toFixed(0)} s)` : 'n/a — computed after run'} |
| Rate used for demand projection | **${demandRateRaw.toFixed(1)} raw/s** (${rateSource}) |

---

## Measured throughput

| Metric | Value |
|--------|-------|
| Total job wall time | ${(totalMs / 1000).toFixed(1)} s (image pull + model download + server load + inference) |
| Steady-state inference time | ${(steadyMs / 1000).toFixed(1)} s (first request → last completion) |
| Readings completed (tokens_predicted=180) | ${readings} / 200 |
| **Readings/sec (steady-state)** | **${readingsPerSec.toFixed(3)}** |
| Tokens/sec (steady-state) | ${tokensPerSec.toFixed(1)} |
| Tokens per Reading (measured) | ${meanPromptToks} + 180 = ${tokensPerReading}${tokensPerReading !== TOKENS_PER_READING ? ` ⚠ differs from production baseline (${TOKENS_PER_READING})` : ''} |
${jobDurationSec !== null ? `| Job duration (claimed → settled) | ${jobDurationSec.toFixed(0)} s |` : ''}

---

## Daily demand projection — ESTIMATE

Rung-4 baseline: **${RUNG4_WAKES_DAY1.toLocaleString()} wakes** (first day after full-fleet registration, 2026-11-10).

> **ESTIMATE**: Assumes steady-state throughput scales linearly to daily volume.
> A production deployment would use multiple nodes in parallel; total GPU-hours are
> unchanged by parallelism. A faster engine (vLLM, TensorRT-LLM) would lower
> GPU-hours; Q4_K_M llama.cpp is the conservative baseline.

| Metric | Calculation | Value |
|--------|-------------|-------|
| Wakes per day | measured, rung 4 | ${RUNG4_WAKES_DAY1.toLocaleString()} |
| Readings/sec (this probe) | measured | ${readingsPerSec.toFixed(3)} |
| **GPU-hours/day** | ${RUNG4_WAKES_DAY1.toLocaleString()} ÷ ${readingsPerSec.toFixed(3)} ÷ 3600 | **${gpuHoursPerDay.toFixed(2)} GPU-h** |
| NOS raw/day | ${gpuHoursPerDay.toFixed(2)} h × 3600 × ${demandRateRaw.toFixed(1)} raw/s | ${nosRawPerDay.toFixed(0)} |
| **NOS/day** | ÷ ${NOS_RAW_PER_NOS.toLocaleString()} | **${nosPerDay.toFixed(4)} NOS** |
| **USD/day** | ${nosPerDay.toFixed(4)} NOS × \$${NOS_USD_PRICE} (CoinGecko, ${NOS_USD_DATE}) | **\$${usdPerDay.toFixed(4)}** |

> **Rate note:** chain \`jobPrice\` = ${marketPriceRaw} raw/s; public API = 275 raw/s (10% network fee on top).
> ${effectiveRateRaw !== null
  ? `Effective rate from wallet tx history = **${effectiveRateRaw.toFixed(1)} raw/s** (net ${netRaw} raw ÷ ${jobDurationSec!.toFixed(0)} s). Demand figure uses the effective rate.${rateDiscrepancy > 0.01 ? ` Discrepancy vs chain jobPrice: ${(rateDiscrepancy * 100).toFixed(1)}%.` : ''}`
  : 'Effective rate will be computed from wallet tx history after the run; demand figure will be updated.'}
>
> NOS price: \$${NOS_USD_PRICE} (point-in-time snapshot, ${NOS_USD_DATE}, CoinGecko).${tokensPerReading !== TOKENS_PER_READING ? `\n>\n> **Prompt size note:** This probe measured ${meanPromptToks} prompt tokens (mean \`tokens_evaluated\`), giving ${tokensPerReading} tokens/Reading. Production Readings are 950 prompt + 180 completion = 1,130 tokens/Reading (rung 1 measured). The projection above assumes Readings of the measured size (${tokensPerReading} tokens). GPU-hours/day at production size would be ${(RUNG4_WAKES_DAY1 / readingsPerSec / 3600 * (TOKENS_PER_READING / tokensPerReading)).toFixed(2)} h (scaled by ${(TOKENS_PER_READING / tokensPerReading).toFixed(3)}×).` : ''}

---

## Probe job cost — deposit / refund / net

Figures from wallet ATA transaction history (source: ${costBreakdown.source}${costBreakdown.source !== 'ata-history' ? ' — **fallback**: ATA query returned no transactions in window; net from receipt.cost_nos used instead' : ''}).

> This job ran on **${marketName}** (\`${MARKET}\`), not the NVIDIA 4090 PREMIUM market used in the 5 Nov 2026 GEMM receipt (\`97G9…odAf\`). Both are RTX 4090 class, same on-chain jobPrice.

| | NOS raw | NOS | USD (@ \$${NOS_USD_PRICE}, ${NOS_USD_DATE}) |
|-|---------|-----|------|
| **Deposit** (escrow locked at submit) | ${depositRaw.toLocaleString()} | ${toNos(depositRaw)} | \$${toUsd(depositRaw / NOS_RAW_PER_NOS)} |
| **Refund** (returned at settlement) | ${refundRaw.toLocaleString()} | ${toNos(refundRaw)} | \$${toUsd(refundRaw / NOS_RAW_PER_NOS)} |
| **Net cost** (deposit minus refund) | ${netRaw.toLocaleString()} | ${toNos(netRaw)} | \$${toUsd(netRaw / NOS_RAW_PER_NOS)} |

Job ID: \`${receipt.job_id}\`
Market: \`${MARKET}\`
${jobDurationSec !== null ? `Actual job duration: ${jobDurationSec.toFixed(0)} s` : ''}

---

## Sample completions (3 of ${readings})

Extracted via \`sed\` JSON field split (between \`"content":"\` and \`","stop":\`);
JSON escape sequences unescaped. Full text — no artificial character limit.

**Sample 1:**
> ${probeOutput.sample_1 || '(empty)'}

**Sample 2:**
> ${probeOutput.sample_2 || '(empty)'}

**Sample 3:**
> ${probeOutput.sample_3 || '(empty)'}

---

## Methodology notes

- Engine: llama.cpp Q4_K_M. A faster engine (vLLM, TensorRT-LLM) or higher precision would yield different Readings/sec.
- Prompt: synthetic English prose. Token count from llama.cpp's own tokeniser (mean \`tokens_evaluated\` = ${meanPromptToks}), not a heuristic estimate.
- Throughput: steady-state only (excludes model download/load). Daily projection uses steady-state.
- Rate: chain \`jobPrice\` = ${marketPriceRaw} raw/s; public API = 275 raw/s (network fee). Demand projection uses effective rate from wallet tx history (${demandRateRaw.toFixed(1)} raw/s).
- Market: ${marketName} (\`${MARKET}\`). The 5 Nov 2026 GEMM receipt used the PREMIUM market; both are RTX 4090 class with the same jobPrice.
- Fleet: 580,551 twins, 594 ecoregions (rung 4). First-day wakes (178,757) are a measured baseline.
`;

  writeFileSync(join(ROOT, 'evidence', 'nosana-priced-demand.md'), md);
  console.log('Wrote evidence/nosana-priced-demand.md');

  console.log(`
=== Probe complete ===
  Readings/sec (steady-state): ${readingsPerSec.toFixed(3)}
  Mean prompt tokens (actual):  ${meanPromptToks}
  GPU-hours/day (ESTIMATE):     ${gpuHoursPerDay.toFixed(2)}
  NOS/day (ESTIMATE):           ${nosPerDay.toFixed(4)}
  USD/day (ESTIMATE):           \$${usdPerDay.toFixed(4)}
  Job net cost:                 ${toNos(netRaw)} NOS
`);
}

// ── ATA transaction history for deposit/refund breakdown ─────────────────────
async function fetchAtaJobCostBreakdown(
  connection: any,
  client: any,
  receipt: Receipt,
): Promise<CostBreakdown> {
  try {
    const { PublicKey } = await import('@solana/web3.js') as any;
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token') as any;

    const nosMint  = new PublicKey(NOS_MINT_STR);
    const walletPk = client.solana.wallet.publicKey;
    const ata      = getAssociatedTokenAddressSync(nosMint, walletPk);
    const ataStr   = ata.toString();

    const postedUnix  = new Date(receipt.posted_at).getTime() / 1000;
    const settledUnix = receipt.settled_at
      ? new Date(receipt.settled_at).getTime() / 1000
      : postedUnix + 900;

    // Most-recent-first; job window is recent so it's near the front
    const sigs = await connection.getSignaturesForAddress(ata, { limit: 30 });

    let depositRaw = 0;
    let refundRaw  = 0;

    for (const sigInfo of sigs) {
      if (!sigInfo.blockTime) continue;
      if (sigInfo.blockTime < postedUnix - 60) continue;    // before job posted
      if (sigInfo.blockTime > settledUnix + 120) continue;  // well after settled

      const tx = await connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta) continue;

      const accounts = tx.transaction.message.accountKeys;
      const ataIdx   = accounts.findIndex((a: any) => a.pubkey.toString() === ataStr);
      if (ataIdx === -1) continue;

      const pre  = tx.meta.preTokenBalances?.find((b: any) => b.accountIndex === ataIdx);
      const post = tx.meta.postTokenBalances?.find((b: any) => b.accountIndex === ataIdx);

      const preRaw  = Number(pre?.uiTokenAmount.amount  ?? 0);
      const postRaw = Number(post?.uiTokenAmount.amount ?? 0);
      const delta   = postRaw - preRaw;

      if (delta < 0) depositRaw += Math.abs(delta);
      if (delta > 0) refundRaw  += delta;
    }

    if (depositRaw === 0) {
      // Fallback if window query missed transactions
      return fallbackBreakdown(receipt);
    }

    return {
      deposit_raw: depositRaw,
      refund_raw:  refundRaw,
      net_raw:     depositRaw - refundRaw,
      source:      'ata-history',
    };
  } catch (err) {
    console.warn('ATA history query failed, using receipt cost_nos:', String(err));
    return fallbackBreakdown(receipt);
  }
}

function fallbackBreakdown(receipt: Receipt): CostBreakdown {
  const net = receipt.cost_nos ?? 0;
  return { deposit_raw: 0, refund_raw: 0, net_raw: net, source: 'receipt-cost_nos-fallback' };
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProbeOutput {
  probe:                   string;
  t_job_start_ms:          number;
  t_download_done_ms:      number;
  t_server_start_ms:       number;
  t_server_ready_ms:       number;
  t_bench_start_ms:        number;
  t_bench_end_ms:          number;
  total_wall_ms:           number;
  steady_state_ms:         number;
  completed_readings:      number;
  mean_tokens_evaluated:   number;
  tokens_predicted_all_180: boolean;
  cuda_offload_all:        boolean;
  offload_line:            string;
  nvidia_smi:              string;
  model:                   string;
  engine:                  string;
  quantisation:            string;
  server_flags:            string;
  n_predict:               number;
  ignore_eos:              boolean;
  sample_1:                string;
  sample_2:                string;
  sample_3:                string;
}

interface CostBreakdown {
  deposit_raw: number;
  refund_raw:  number;
  net_raw:     number;
  source:      string;
}

interface InferenceReceipt extends Receipt {
  market_price_raw_per_sec: number;
  market_price_slot:        number;
  cost_breakdown:           CostBreakdown;
  inference_probe:          ProbeOutput | null;
}

main().catch(err => { console.error(err); process.exit(1); });
