/**
 * Inference throughput probe — vLLM Llama 3.1 8B AWQ INT4 on Nosana.
 *
 * Uses the official Nosana vLLM 8B AWQ INT4 job definition (verbatim).
 * Source: https://learn.nosana.com/inference/examples/vllm.html
 *   "Llama 3.1 8B AWQ 4" section — market EzuHhkrhmV98… (RTX 4070 on the docs page).
 *   The docs associate this AWQ job def with the 4070 market; we post to the
 *   premium/community 4090 market which has more VRAM and runs the same model.
 *   Snapshot hash db1f81ad… matches the S3 resource target dir verbatim.
 *
 * Architecture: service run (not batch).
 *   - Posts job to premium market 97G9… (or community Dcwz62… if premium has no idle nodes).
 *   - Override with --market <addr> or NOSANA_MARKET env var.
 *   - Probe runs from local machine against the job's exposed endpoint.
 *   - Endpoint URL computed from job ID via SDK expose hash:
 *       https://<getExposeIdHash(jobId, opIndex=0, port=8000)>.node.k8s.prd.nos.ci
 *     Source: @nosana/sdk dist/utils/expose.js getExposeIdHash + @nosana/cli dist/.env.prd
 *   - Prompt: ~950 token ecological sensor-report prompt (900–1,000 token range enforced at warm-up)
 *   - Warm-up: 1 × /v1/completions (max_tokens=180, ignore_eos=true)
 *     Aborts if usage.prompt_tokens outside 900–1,000 or completion_tokens < 180
 *   - Benchmark: 200 Readings at 32 concurrent, per-request timing
 *     A reading is ok only if usage.completion_tokens == 180
 *   - 900 s health wait (image pull + S3 staging took 509 s in job 6); logs time-to-healthy
 *   - 480 s benchmark watchdog; PARTIAL recorded if benchmark incomplete
 *   - Shutdown: try/finally + uncaughtException + unhandledRejection → endJob → exit
 *
 * Usage:
 *   WALLET_PATH=/path/to/keypair.json npx tsx scripts/inference-throughput-probe-vllm.ts
 *   WALLET_PATH=... npx tsx scripts/inference-throughput-probe-vllm.ts --market Dcwz62TisNbWuto6KJM2EGYGVKnHbdZGVGmgLASzsXy8
 *
 * Writes on completion:
 *   evidence/inference-throughput-receipt.json          (success)
 *   evidence/inference-throughput-receipt-FAILED-*.json (any non-ok outcome)
 *   evidence/nosana-priced-demand.md                    (ESTIMATE-labelled demand)
 */

import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

// ── Market configuration ───────────────────────────────────────────────────
const RTX_4090_PREMIUM   = '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf';
const RTX_4090_COMMUNITY = 'Dcwz62TisNbWuto6KJM2EGYGVKnHbdZGVGmgLASzsXy8';
const MARKET_NAMES: Record<string, string> = {
  [RTX_4090_PREMIUM]:   'NVIDIA 4090 (PREMIUM)',
  [RTX_4090_COMMUNITY]: 'NVIDIA 4090 Community (COMMUNITY)',
};

const marketArg = process.argv.find((_, i, a) => a[i - 1] === '--market');
const MARKET = marketArg ?? process.env['NOSANA_MARKET'] ?? RTX_4090_PREMIUM;

// ── FRP endpoint derivation ─────────────────────────────────────────────────
// Source: @nosana/sdk dist/utils/expose.js getExposeIdHash()
//         @nosana/cli dist/.env.prd FRP_SERVER_ADDRESS=node.k8s.prd.nos.ci
// URL = https://<bs58(sha512("0:8000:<jobId>")).slice(0,44)>.node.k8s.prd.nos.ci
const FRP_SERVER_ADDR = 'node.k8s.prd.nos.ci';

async function deriveEndpoint(jobId: string): Promise<string> {
  const bs58   = (await import('bs58')).default;
  const nacl   = (await import('tweetnacl')).default;
  const hash   = nacl.hash(new TextEncoder().encode(`0:8000:${jobId}`));
  const exposeId = bs58.encode(hash).slice(0, 44);
  return `https://${exposeId}.${FRP_SERVER_ADDR}`;
}

// ── Official vLLM 8B AWQ INT4 job definition ────────────────────────────────
// Verbatim from https://learn.nosana.com/inference/examples/vllm.html
// "Llama 3.1 8B AWQ 4" section.
// Snapshot hash db1f81ad4b8c7e39777509fac66c652eb0a52f91 matches the S3
// resource target dir; docs list this same hash — no discrepancy.
// (The docs pair this job def with market EzuHhkrhmV98… (4070); we post to
//  the 4090 market which has more VRAM and runs the same model fine.)
const VLLM_JOB_DEF = {
  version: '0.1',
  type:    'container',
  meta:    { trigger: 'cli' },
  ops: [{
    type: 'container/run',
    id:   'VLLM-llama3.1',
    args: {
      cmd: [
        '--model',
        '/root/.cache/huggingface/hub/models--hugging-quants--Meta-Llama-3.1-8B-Instruct-AWQ-INT4/snapshots/db1f81ad4b8c7e39777509fac66c652eb0a52f91',
        '--served-model-name', 'llama3.1',
        '--quantization',      'awq',
        '--max-model-len',     '2176',
      ],
      image: 'docker.io/vllm/vllm-openai:v0.5.4',
      gpu:   true,
      expose: 8000,
      resources: [{
        type:   'S3',
        url:    'https://models.nosana.io/hugging-face/llama3.1/8b/4x/models--hugging-quants--Meta-Llama-3.1-8B-Instruct-AWQ-INT4',
        target: '/root/.cache/huggingface/hub/models--hugging-quants--Meta-Llama-3.1-8B-Instruct-AWQ-INT4',
      }],
    },
  }],
} as const;

// ── Probe configuration ─────────────────────────────────────────────────────
const TOTAL_READINGS     = 200;
const CONCURRENCY        = 32;
const MAX_TOKENS         = 180;        // exact completion length enforced by ignore_eos
const BENCH_WATCHDOG_MS  = 480_000;    // 480 s benchmark watchdog
const HEALTH_TIMEOUT_MS  = 900_000;    // 900 s — image pull + S3 staging took 509 s in job 6
const JOB_TIMEOUT_SECS   = 1800;
const JOB_TIMEOUT_MS     = 1_800_000;
const PROMPT_MIN_TOKENS  = 900;
const PROMPT_MAX_TOKENS  = 1_000;

// NOS mint for ATA balance checks
const NOS_MINT = 'nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7';

// ── Prompt — 951 tokens without BOS, 952 with BOS ───────────────────────────
// Measured with hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4 tokenizer.json
// via the `tokenizers` Python package (Tokenizer.from_file, add_special_tokens=True/False).
// vLLM reports usage.prompt_tokens including BOS → expect 952.
// Based on the original llama.cpp probe's sensor-report prompt, padded with a
// Hydrological Data paragraph (+130 tokens) to reach range.
// Warm-up aborts if usage.prompt_tokens is outside 900–1,000.
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
  'Hydrological Data from stream gauges and groundwater monitoring wells: Stream flow rate in primary drainage channel measured at 2.84 cubic meters per second, representing 134 percent of seasonal median. Groundwater table depth recorded at 0.73 meters below surface across upslope monitoring transect. Dissolved oxygen in stream at 10.2 milligrams per liter. Turbidity elevated at 4.8 nephelometric turbidity units following recent precipitation events. Canopy interception estimated at 22 percent of gross precipitation based on throughfall collectors. Atmospheric carbon dioxide concentration measured at 418.3 parts per million at canopy height sensor array. ' +
  'Task: Provide a comprehensive ecological assessment including primary phenomena identification, contributing environmental factors, expected ecological cascade effects, recommended monitoring protocols for the next 30 and 90 day periods, and specific conservation management actions suitable for immediate implementation.';

// ── Helpers ──────────────────────────────────────────────────────────────────
function nowIso(): string { return new Date().toISOString(); }
function nowMs():  number { return Date.now(); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function getAtaBalance(
  connection: { getTokenAccountBalance(ata: unknown): Promise<{ value: { amount: string } }> },
  walletPubkey: unknown,
): Promise<number | null> {
  try {
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token') as {
      getAssociatedTokenAddressSync(mint: unknown, owner: unknown): unknown;
    };
    const { PublicKey } = await import('@solana/web3.js') as { PublicKey: new(s: string) => unknown };
    const ata = getAssociatedTokenAddressSync(new PublicKey(NOS_MINT), walletPubkey);
    const bal = await connection.getTokenAccountBalance(ata);
    return Number(bal.value.amount);
  } catch { return null; }
}

// ── SDK types ────────────────────────────────────────────────────────────────
interface NosanaClient {
  jobs: {
    list(jobDef: unknown, timeoutSecs: number, market: string): Promise<{ tx: string; job: string; run: string }>;
    get(jobId: string): Promise<{ state: string; node?: { toString(): string }; price?: { valueOf(): number }; ipfsResult?: string }>;
    end(jobId: string): Promise<unknown>;
    delist(jobId: string): Promise<unknown>;
    getMarket(addr: string): Promise<unknown>;
  };
  ipfs: { retrieve(hash: string): Promise<unknown> };
  solana: { connection: unknown; wallet: { publicKey: unknown } };
}

// ── Single reading ────────────────────────────────────────────────────────────
interface ReadingResult {
  idx:               number;
  t_start_ms:        number;
  t_end_ms:          number;
  latency_ms:        number;
  prompt_tokens:     number;
  completion_tokens: number;
  ok:                boolean;
  error?:            string;
}

async function runReading(endpoint: string, idx: number): Promise<ReadingResult> {
  const t_start_ms = nowMs();
  try {
    const res = await fetch(`${endpoint}/v1/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       'llama3.1',
        prompt:      PROMPT,
        max_tokens:  MAX_TOKENS,
        temperature: 0.7,
        ignore_eos:  true,
      }),
      signal: AbortSignal.timeout(BENCH_WATCHDOG_MS),
    });
    const t_end_ms = nowMs();
    if (!res.ok) {
      return { idx, t_start_ms, t_end_ms, latency_ms: t_end_ms - t_start_ms,
               prompt_tokens: 0, completion_tokens: 0, ok: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json() as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const completion_tokens = body.usage?.completion_tokens ?? 0;
    const prompt_tokens     = body.usage?.prompt_tokens     ?? 0;
    const ok = completion_tokens === MAX_TOKENS;
    return {
      idx, t_start_ms, t_end_ms,
      latency_ms: t_end_ms - t_start_ms,
      prompt_tokens, completion_tokens, ok,
      ...(!ok ? { error: `completion_tokens=${completion_tokens} expected ${MAX_TOKENS}` } : {}),
    };
  } catch (e) {
    const t_end_ms = nowMs();
    return { idx, t_start_ms, t_end_ms, latency_ms: t_end_ms - t_start_ms,
             prompt_tokens: 0, completion_tokens: 0, ok: false, error: String(e) };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // ── Wallet ────────────────────────────────────────────────────────────────
  const walletPath = process.env['WALLET_PATH'];
  let walletRaw: string;
  if (walletPath) {
    walletRaw = readFileSync(walletPath, 'utf-8').trim();
  } else {
    const val = process.env['NOSANA_WALLET_PRIVATE_KEY'];
    if (!val) throw new Error('Set WALLET_PATH or NOSANA_WALLET_PRIVATE_KEY');
    walletRaw = val.trim();
  }

  // ── Load SDK ───────────────────────────────────────────────────────────────
  const { Client } = await import('@nosana/sdk') as { Client: new(env: string, wallet: never) => NosanaClient };
  const client = new Client('mainnet', walletRaw as never);

  const connection   = (client as unknown as { solana: { connection: unknown } }).solana?.connection as Parameters<typeof getAtaBalance>[0];
  const walletPubkey = (client as unknown as { solana: { wallet: { publicKey: unknown } } }).solana?.wallet?.publicKey;

  // ── Idle-node check ────────────────────────────────────────────────────────
  let chosenMarket = MARKET;
  console.log(`Checking market ${chosenMarket}...`);
  const marketObj = await client.jobs.getMarket(chosenMarket) as Record<string, unknown>;
  const queueType = Number((marketObj as { queueType?: unknown }).queueType ?? -1);
  const queueLen  = Number((marketObj as { queue?: unknown[] }).queue?.length ?? 0);
  console.log(`  queueType=${queueType} (1=NODE_QUEUE=idle nodes), queueLen=${queueLen}`);

  if (queueType !== 1 || queueLen === 0) {
    if (MARKET !== RTX_4090_PREMIUM) {
      console.error(`ABORT: requested market ${MARKET} has no idle nodes.`);
      process.exit(1);
    }
    console.log(`Premium has no idle nodes — checking community ${RTX_4090_COMMUNITY}...`);
    const communityObj = await client.jobs.getMarket(RTX_4090_COMMUNITY) as Record<string, unknown>;
    const cqt = Number((communityObj as { queueType?: unknown }).queueType ?? -1);
    const cql = Number((communityObj as { queue?: unknown[] }).queue?.length ?? 0);
    console.log(`  queueType=${cqt}, queueLen=${cql}`);
    if (cqt !== 1 || cql === 0) {
      console.error('ABORT: neither premium nor community market has idle nodes.');
      process.exit(1);
    }
    chosenMarket = RTX_4090_COMMUNITY;
    console.log(`Using community market.`);
  } else {
    console.log(`Market OK: ${queueLen} idle node(s).`);
  }
  console.log(`Market: ${chosenMarket} — ${MARKET_NAMES[chosenMarket] ?? 'unknown'}`);

  // ── ATA pre-balance ────────────────────────────────────────────────────────
  const preBalance = await getAtaBalance(connection, walletPubkey);
  console.log(`Pre-balance: ${preBalance ?? 'unknown'} raw NOS`);

  // ── Post job ───────────────────────────────────────────────────────────────
  const posted_at = nowIso();
  console.log(`\nPosting vLLM job to ${chosenMarket}...`);
  const { job: job_id } = await client.jobs.list(VLLM_JOB_DEF, JOB_TIMEOUT_SECS, chosenMarket);
  const endpoint = await deriveEndpoint(job_id);
  console.log(`Job ID:    ${job_id}`);
  console.log(`Endpoint:  ${endpoint}`);

  // ── State tracking ─────────────────────────────────────────────────────────
  let claimed_at:   string | null = null;
  let started_at:   string | null = null;
  let settled_at:   string | null = null;
  let host:         string | null = null;
  let outcome_code: string | null = null;
  let jobEnded = false;
  let probe:    unknown = null;

  // ── Guaranteed stop ────────────────────────────────────────────────────────
  async function endJob(reason: string) {
    if (jobEnded) return;
    jobEnded = true;
    console.log(`\nEnding job (${reason})...`);
    try {
      await client.jobs.end(job_id);
      settled_at = nowIso();
      console.log(`Job ended OK at ${settled_at}`);
    } catch (e) {
      console.error(`client.jobs.end failed: ${e}`);
    }
    try {
      const job = await client.jobs.get(job_id);
      console.log(`Chain state after end: ${job.state}`);
    } catch (e) {
      console.error(`Could not verify chain state: ${e}`);
    }
    // Write receipt even on abrupt exit paths
    try {
      await writeReceipt({ job_id, endpoint, chosenMarket, outcome_code: outcome_code ?? 'aborted', posted_at, claimed_at, started_at, settled_at, host, preBalance, client, connection, walletPubkey, probe });
    } catch (e) {
      console.error(`Receipt write failed: ${e}`);
    }
  }

  // Process-level handlers for uncaught errors after job is posted
  const uncaughtHandler = async (e: Error) => {
    console.error(`\n[uncaughtException] ${e?.message ?? e}`);
    outcome_code ??= 'aborted';
    await endJob('uncaughtException');
    process.exit(1);
  };
  const rejectionHandler = async (reason: unknown) => {
    console.error(`\n[unhandledRejection] ${reason}`);
    outcome_code ??= 'aborted';
    await endJob('unhandledRejection');
    process.exit(1);
  };
  process.once('uncaughtException',  uncaughtHandler);
  process.once('unhandledRejection', rejectionHandler as (r: unknown, p: Promise<unknown>) => void);

  process.once('SIGINT', async () => {
    console.log('\n[SIGINT]');
    outcome_code = 'partial';
    await endJob('SIGINT');
    process.exit(130);
  });

  // ── All post-post logic wrapped in try/finally ─────────────────────────────
  try {

    // ── Poll until RUNNING ───────────────────────────────────────────────────
    console.log('\nWaiting for job to be claimed and start running...');
    const runDeadline = nowMs() + JOB_TIMEOUT_MS;
    let lastJobState = '';
    while (nowMs() < runDeadline) {
      await sleep(6_000);
      const job = await client.jobs.get(job_id);
      const jobState = String(job.state).toUpperCase();
      if (jobState !== lastJobState) {
        console.log(`  → ${jobState}  ${nowIso()}`);
        lastJobState = jobState;
      }
      if (job.node && !host) {
        host       = String(job.node);
        claimed_at = nowIso();
        console.log(`  Claimed by ${host}`);
      }
      if (jobState === 'RUNNING' && !started_at) {
        started_at = nowIso();
        break;
      }
      if (jobState === 'COMPLETED' || jobState === 'STOPPED') {
        throw new Error(`Job terminated prematurely: ${jobState}`);
      }
    }

    if (!started_at) {
      outcome_code = 'timeout';
      return; // finally block calls endJob + writeReceipt
    }

    // ── Wait for /health ─────────────────────────────────────────────────────
    console.log(`\nPolling ${endpoint}/health (up to ${HEALTH_TIMEOUT_MS / 1000}s)...`);
    const t_health_start  = nowMs();
    const healthDeadline  = t_health_start + HEALTH_TIMEOUT_MS;
    let healthy = false;
    while (nowMs() < healthDeadline) {
      try {
        const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(10_000) });
        if (r.ok) { healthy = true; break; }
        process.stdout.write('.');
      } catch { process.stdout.write('x'); }
      await sleep(5_000);
    }
    const t_healthy_ms = nowMs() - t_health_start;
    if (!healthy) {
      outcome_code = 'job_error';
      throw new Error(`vLLM never became healthy within ${HEALTH_TIMEOUT_MS / 1000}s`);
    }
    const t_healthy = nowIso();
    console.log(`\nHealthy at ${t_healthy} (time-to-healthy: ${(t_healthy_ms / 1000).toFixed(1)}s)`);
    if (t_healthy_ms < 90_000) {
      console.log('  (< 90 s — S3 resource likely was cached on this node)');
    } else {
      console.log('  (> 90 s — S3 resource likely required fresh staging)');
    }

    // ── GET /v1/models ───────────────────────────────────────────────────────
    const modelsRes  = await fetch(`${endpoint}/v1/models`);
    const modelsBody = await modelsRes.json();
    console.log('\n/v1/models:', JSON.stringify(modelsBody));

    // ── Warm-up ──────────────────────────────────────────────────────────────
    console.log('\nRunning warm-up (ignore_eos=true, max_tokens=180)...');
    const warmup = await runReading(endpoint, 0);
    console.log(`Warm-up: ${warmup.latency_ms}ms  prompt_tokens=${warmup.prompt_tokens}  completion_tokens=${warmup.completion_tokens}  ok=${warmup.ok}`);

    if (warmup.prompt_tokens < PROMPT_MIN_TOKENS || warmup.prompt_tokens > PROMPT_MAX_TOKENS) {
      outcome_code = 'job_error';
      throw new Error(`FATAL: warm-up prompt_tokens=${warmup.prompt_tokens} outside expected range ${PROMPT_MIN_TOKENS}–${PROMPT_MAX_TOKENS}; prompt may have changed`);
    }
    if (warmup.completion_tokens < MAX_TOKENS) {
      outcome_code = 'job_error';
      throw new Error(`FATAL: warm-up completion_tokens=${warmup.completion_tokens} < ${MAX_TOKENS}; model stopping early despite ignore_eos=true`);
    }
    console.log(`Warm-up OK — prompt_tokens=${warmup.prompt_tokens} in range, completion_tokens=${warmup.completion_tokens}`);

    // ── Benchmark: 200 Readings at 32 concurrent ─────────────────────────────
    console.log(`\nBenchmark: ${TOTAL_READINGS} readings at ${CONCURRENCY} concurrent (watchdog=${BENCH_WATCHDOG_MS / 1000}s)...`);
    const t_bench_start = nowMs();
    const results: ReadingResult[] = [];
    let   watchdogFired = false;
    let   benchComplete = false;

    const watchdog = setTimeout(() => {
      if (!benchComplete) {
        watchdogFired = true;
        console.error(`\n[WATCHDOG] benchmark exceeded ${BENCH_WATCHDOG_MS / 1000}s`);
      }
    }, BENCH_WATCHDOG_MS);

    for (let batchStart = 0; batchStart < TOTAL_READINGS && !watchdogFired; batchStart += CONCURRENCY) {
      const batchEnd  = Math.min(batchStart + CONCURRENCY, TOTAL_READINGS);
      const batchIdxs = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i + 1);
      const batchResults = await Promise.all(batchIdxs.map(i => runReading(endpoint, i)));
      results.push(...batchResults);
      const ok = batchResults.filter(r => r.ok).length;
      console.log(`  Batch ${batchStart + 1}–${batchEnd}: ${ok}/${batchResults.length} ok`);
    }

    benchComplete = true;
    clearTimeout(watchdog);

    const t_bench_end    = nowMs();
    const bench_wall_ms  = t_bench_end - t_bench_start;
    const ok_readings    = results.filter(r => r.ok);
    const readings_per_sec = ok_readings.length / (bench_wall_ms / 1000);
    const latencies        = ok_readings.map(r => r.latency_ms).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.50)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;
    const avg_completion_tokens = ok_readings.length
      ? ok_readings.reduce((s, r) => s + r.completion_tokens, 0) / ok_readings.length
      : 0;

    outcome_code = watchdogFired              ? 'partial'
                 : results.length < TOTAL_READINGS ? 'partial'
                 : 'ok';

    console.log(`\nBenchmark: ${ok_readings.length}/${TOTAL_READINGS} ok  (${results.filter(r => !r.ok).length} short/failed)`);
    console.log(`  Wall time:  ${(bench_wall_ms / 1000).toFixed(1)}s`);
    console.log(`  Readings/s: ${readings_per_sec.toFixed(2)} (full-${MAX_TOKENS}-token completions only)`);
    console.log(`  Latency p50/p95/p99: ${p50}/${p95}/${p99} ms`);

    probe = {
      t_healthy,
      t_healthy_ms,
      s3_cache_signal: t_healthy_ms < 90_000 ? 'likely-cached' : 'likely-fresh-pull',
      models_response:          modelsBody,
      warmup_latency_ms:        warmup.latency_ms,
      warmup_prompt_tokens:     warmup.prompt_tokens,
      warmup_completion_tokens: warmup.completion_tokens,
      bench_wall_ms,
      readings_ok:              ok_readings.length,
      readings_attempted:       results.length,
      readings_total_target:    TOTAL_READINGS,
      readings_per_sec:         parseFloat(readings_per_sec.toFixed(4)),
      latency_p50_ms:           p50,
      latency_p95_ms:           p95,
      latency_p99_ms:           p99,
      avg_completion_tokens:    parseFloat(avg_completion_tokens.toFixed(1)),
      max_tokens_requested:     MAX_TOKENS,
      ignore_eos:               true,
      ok_criterion:             `completion_tokens == ${MAX_TOKENS}`,
      prompt_tokens_range:      `${PROMPT_MIN_TOKENS}–${PROMPT_MAX_TOKENS}`,
      watchdog_fired:           watchdogFired,
      engine:                   'vllm 0.5.4',
      quantization:             'awq-int4',
      model:                    'hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4',
      timing_source:            'local-machine-network',
      per_reading_results:      results,
    };

  } finally {
    // Remove process handlers before endJob to avoid double-firing on its errors
    process.removeListener('uncaughtException',  uncaughtHandler);
    process.removeListener('unhandledRejection', rejectionHandler as (r: unknown, p: Promise<unknown>) => void);
    await endJob(`outcome=${outcome_code ?? 'unknown'}`);
  }

  if (outcome_code !== 'ok') {
    console.error(`\nOutcome: ${outcome_code}`);
    process.exit(1);
  }
  console.log('\nOutcome: ok — probe complete.');
}

// ── Receipt writer ────────────────────────────────────────────────────────────
async function writeReceipt(ctx: {
  job_id:       string;
  endpoint:     string;
  chosenMarket: string;
  outcome_code: string;
  posted_at:    string;
  claimed_at:   string | null;
  started_at:   string | null;
  settled_at:   string | null;
  host:         string | null;
  preBalance:   number | null;
  client:       NosanaClient;
  connection:   Parameters<typeof getAtaBalance>[0];
  walletPubkey: unknown;
  probe:        unknown;
}) {
  const { job_id, endpoint, chosenMarket, outcome_code, posted_at, claimed_at, started_at, settled_at, host, preBalance, client, connection, walletPubkey, probe } = ctx;

  let costBreakdown: { net_raw: number | null; source: string } = { net_raw: null, source: 'unavailable' };
  if (preBalance != null && connection && walletPubkey) {
    try {
      const { getAssociatedTokenAddressSync } = await import('@solana/spl-token') as { getAssociatedTokenAddressSync(m: unknown, o: unknown): unknown };
      const { PublicKey } = await import('@solana/web3.js') as { PublicKey: new(s: string) => unknown };
      const ata = getAssociatedTokenAddressSync(new PublicKey(NOS_MINT), walletPubkey);
      const bal = await (connection as { getTokenAccountBalance(a: unknown): Promise<{ value: { amount: string } }> }).getTokenAccountBalance(ata);
      const net_raw = preBalance - Number(bal.value.amount);
      costBreakdown = { net_raw, source: 'ata-delta' };
      console.log(`\nNet cost: ${net_raw} raw / ${(net_raw / 1_000_000).toFixed(6)} NOS`);
    } catch (e) {
      console.error(`ATA balance check failed: ${e}`);
    }
  }

  let ipfs_cid: string | null = null;
  let ipfs_raw: unknown = null;
  try {
    const job = await client.jobs.get(job_id);
    if (job.ipfsResult) {
      ipfs_cid = job.ipfsResult;
      try { ipfs_raw = await client.ipfs.retrieve(ipfs_cid); } catch { /* ok */ }
    }
  } catch { /* ok */ }

  const receipt = {
    receipt_version:     '0.1.0',
    provider:            'nosana',
    job_id,
    market:              chosenMarket,
    market_name:         MARKET_NAMES[chosenMarket] ?? 'unknown',
    host,
    endpoint,
    endpoint_derivation: `bs58(sha512("0:8000:${job_id}")).slice(0,44).${FRP_SERVER_ADDR}`,
    endpoint_source:     '@nosana/sdk dist/utils/expose.js getExposeIdHash + @nosana/cli dist/.env.prd',
    posted_at,
    claimed_at,
    started_at,
    settled_at:          settled_at ?? new Date().toISOString(),
    ipfs_cid,
    cost_breakdown:      costBreakdown,
    outcome_code,
    engine:              'vllm 0.5.4',
    quantization:        'awq-int4',
    inference_probe:     probe,
    _job_def_source:     'https://learn.nosana.com/inference/examples/vllm.html (verbatim, Llama 3.1 8B AWQ 4 section)',
    _ipfs_raw:           ipfs_raw,
  };

  const jobPrefix       = job_id.slice(0, 8);
  const receiptFilename = outcome_code === 'ok'
    ? 'inference-throughput-receipt.json'
    : `inference-throughput-receipt-FAILED-${jobPrefix}.json`;

  writeFileSync(join(ROOT, 'evidence', receiptFilename), JSON.stringify(receipt, null, 2), 'utf-8');
  console.log(`\nWrote evidence/${receiptFilename}`);

  if (outcome_code === 'ok' && probe && typeof probe === 'object' && 'readings_per_sec' in probe) {
    const p = probe as { readings_per_sec: number; latency_p95_ms: number; warmup_prompt_tokens: number };
    const rps      = p.readings_per_sec;
    const rph      = rps * 3600;
    const fleet1k  = 1_000 / rps;
    const fleet10k = 10_000 / rps;
    const md = `# Nosana Inference Demand Estimate — vLLM Llama 3.1 8B AWQ INT4

> **ESTIMATE** — derived from a single probe run on a Nosana RTX 4090 node.
> Engine: vLLM 0.5.4 · Model: Meta-Llama-3.1-8B-Instruct-AWQ-INT4 · Timing: local-machine network
> Only full-180-token completions counted (ignore_eos=true enforced).
> Actual prompt tokens: ${p.warmup_prompt_tokens} (measured at warm-up).

## Probe result

| Metric | Value |
|--------|-------|
| Readings/sec (sustained, full-180-token) | **${rps.toFixed(2)}** |
| Readings/hour | **${Math.round(rph).toLocaleString()}** |
| Latency p95 | ${p.latency_p95_ms} ms |

## Fleet demand

| Scenario | GPU nodes needed |
|----------|-----------------|
| 1,000 concurrent Reading requests | ${fleet1k.toFixed(1)} nodes |
| 10,000 concurrent Reading requests | ${fleet10k.toFixed(1)} nodes |

_Each node = Nosana RTX 4090 running vLLM 0.5.4 at AWQ INT4 precision._
_See \`evidence/${receiptFilename}\` for full probe results._
`;
    writeFileSync(join(ROOT, 'evidence', 'nosana-priced-demand.md'), md, 'utf-8');
    console.log('Wrote evidence/nosana-priced-demand.md');
  }
}

main().catch(e => {
  console.error('[probe] fatal:', e);
  process.exit(1);
});
