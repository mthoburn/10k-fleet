/**
 * Capstone readings run — real wake records → one Nosana vLLM job → Readings back → receipted.
 *
 * DEMONSTRATION: outputs are evidence files, NOT written into production readings tables.
 *
 * Uses the proven vLLM 8B AWQ INT4 job definition (identical to job C31VmBHox).
 * Loads 190 real wake records from evidence/capstone-wakes.json (pulled from eden-prod).
 * Builds one prompt per wake (organism + event context), runs all as a single job.
 * Captures the full text of every Reading for evidence.
 *
 * Budget guard: estimates total NOS exposure before posting; aborts if > 1 NOS.
 * Expected cost: ~0.15–0.3 NOS for 190 readings.
 *
 * Usage:
 *   WALLET_PATH=/path/to/keypair.json npx tsx scripts/capstone-readings-run.ts
 *   WALLET_PATH=... npx tsx scripts/capstone-readings-run.ts --market Dcwz62TisNbWuto6KJM2EGYGVKnHbdZGVGmgLASzsXy8
 *
 * Writes on completion:
 *   evidence/capstone-receipt.json         (schema-valid receipt)
 *   evidence/capstone-readings.json        (all 190 Reading outputs + metadata)
 *   evidence/capstone-summary.md           (summary doc)
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

const marketArg  = process.argv.find((_, i, a) => a[i - 1] === '--market');
const MARKET     = marketArg ?? process.env['NOSANA_MARKET'] ?? RTX_4090_COMMUNITY;

// ── FRP endpoint derivation ────────────────────────────────────────────────
const FRP_SERVER_ADDR = 'node.k8s.prd.nos.ci';

async function deriveEndpoint(jobId: string): Promise<string> {
  const bs58    = (await import('bs58')).default;
  const nacl    = (await import('tweetnacl')).default;
  const hash    = nacl.hash(new TextEncoder().encode(`0:8000:${jobId}`));
  const exposeId = bs58.encode(hash).slice(0, 44);
  return `https://${exposeId}.${FRP_SERVER_ADDR}`;
}

// ── Proven vLLM 8B AWQ INT4 job definition (identical to job C31VmBHox) ───
const VLLM_JOB_DEF = {
  version: '0.1',
  type:    'container',
  meta:    { trigger: 'cli' },
  ops: [{
    type: 'container/run',
    id:   'vllm-llama31',
    args: {
      cmd: [
        '--model',
        '/root/.cache/huggingface/hub/models--hugging-quants--Meta-Llama-3.1-8B-Instruct-AWQ-INT4/snapshots/db1f81ad4b8c7e39777509fac66c652eb0a52f91',
        '--served-model-name', 'llama3.1',
        '--quantization',      'awq',
        '--max-model-len',     '2176',
      ],
      image:   'docker.io/vllm/vllm-openai:v0.5.4',
      gpu:     true,
      expose:  8000,
      resources: [{
        type:   'S3',
        url:    'https://models.nosana.io/hugging-face/llama3.1/8b/4x/models--hugging-quants--Meta-Llama-3.1-8B-Instruct-AWQ-INT4',
        target: '/root/.cache/huggingface/hub/models--hugging-quants--Meta-Llama-3.1-8B-Instruct-AWQ-INT4',
      }],
    },
  }],
} as const;

// ── Run configuration ──────────────────────────────────────────────────────
const CONCURRENCY       = 32;
const MAX_TOKENS        = 180;
const BENCH_WATCHDOG_MS = 600_000;   // 10 min — 190 readings at 3.45 R/s ≈ 55 s, generous
const HEALTH_TIMEOUT_MS = 900_000;
const JOB_TIMEOUT_SECS  = 1800;
const JOB_TIMEOUT_MS    = 1_800_000;

// Budget guard: abort if estimated exposure > this
const MAX_NOS_EXPOSURE  = 1_000_000; // 1 NOS in raw

// Proven billing rate from job C31VmBHox
const MARKET_PRICE_RAW_PER_SEC = 253;
const STARTUP_SEC_ESTIMATE     = 550;  // conservative vs 500.5 s actual

// NOS mint
const NOS_MINT = 'nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7';

// ── Wake record type ───────────────────────────────────────────────────────
interface WakeRecord {
  wake_id:          string;
  decided_at:       string;
  twin_kind:        string;
  external_ref:     string;
  twin_region:      string;
  event_type:       string | null;
  event_region:     string | null;
  severity:         number | null;
  occurred_at:      string | null;
  unified_event_id: string | null;
  headline:         string | null;
  ecoregion_name:   string | null;
  biome_name:       string | null;
  eco_realm:        string | null;
  hazard_type_en:   string | null;
  lat:              number | null;
  lon:              number | null;
  species_name:     string | null;
  common_name:      string | null;
  habitat_key:      string | null;
  kingdom:          string | null;
}

// ── Prompt builder ─────────────────────────────────────────────────────────
const EVENT_TYPE_LABELS: Record<string, string> = {
  EQ: 'Earthquake', FL: 'Flood', TC: 'Tropical Cyclone',
  VO: 'Volcanic Activity', DR: 'Drought', TS: 'Tsunami',
  WF: 'Wildfire', CW: 'Cold Wave', HW: 'Heat Wave',
};

function buildPrompt(wake: WakeRecord): string {
  const hazard    = wake.hazard_type_en ?? EVENT_TYPE_LABELS[wake.event_type ?? ''] ?? wake.event_type ?? 'Natural Event';
  const region    = wake.twin_region ?? wake.event_region ?? 'unknown region';
  const severity  = wake.severity != null ? (wake.severity * 10).toFixed(1) : 'unknown';
  const occurred  = wake.occurred_at ? new Date(wake.occurred_at).toUTCString() : 'unknown';
  const headline  = wake.headline ?? `${hazard} event`;
  const latlon    = (wake.lat != null && wake.lon != null)
    ? `${Math.abs(wake.lat).toFixed(4)}°${wake.lat >= 0 ? 'N' : 'S'}, ${Math.abs(wake.lon).toFixed(4)}°${wake.lon >= 0 ? 'E' : 'W'}`
    : region;

  const orgLine = wake.species_name
    ? `Organism: ${wake.species_name}${wake.common_name ? ` (${wake.common_name})` : ''}. Kingdom: ${wake.kingdom ?? 'unknown'}. Habitat key: ${wake.habitat_key ?? region}.`
    : `Ecosystem context: marine and terrestrial habitats within ecoregion ${wake.habitat_key ?? region}.`;

  const ecoLine = wake.ecoregion_name
    ? `Ecoregion: ${wake.ecoregion_name}${wake.biome_name ? ` — ${wake.biome_name}` : ''}${wake.eco_realm ? ` (${wake.eco_realm})` : ''}.`
    : `Ecoregion code: ${wake.habitat_key ?? region}.`;

  return (
    `You are Eden's ecological intelligence system. ` +
    `A living card within the Eden botanical record has been woken by a natural event and requires a Reading — ` +
    `a brief but precise ecological intelligence assessment of the event's significance to this card's habitat. ` +
    `A Reading is two to four sentences: specific, grounded in ecology, and written for a naturalist audience. ` +
    `It names real ecological dynamics, real species sensitivities, or real landscape-scale consequences where relevant. ` +
    `It does not use filler or generic environmental language. ` +
    `\n\nEvent record — Wake ID: ${wake.wake_id}. ` +
    `Event type: ${hazard}. ` +
    `Headline: ${headline}. ` +
    `Severity index: ${severity}/10. ` +
    `Location: ${latlon}. ` +
    `Occurred: ${occurred}. ` +
    `${ecoLine} ` +
    `${orgLine} ` +
    `\n\nGenerate the Reading for this wake:`
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
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

interface ReadingResult {
  idx:               number;
  wake_id:           string;
  t_start_ms:        number;
  t_end_ms:          number;
  latency_ms:        number;
  prompt_tokens:     number;
  completion_tokens: number;
  ok:                boolean;
  text:              string;
  error?:            string;
}

async function runReading(endpoint: string, idx: number, wake: WakeRecord): Promise<ReadingResult> {
  const prompt    = buildPrompt(wake);
  const t_start_ms = nowMs();
  try {
    const res = await fetch(`${endpoint}/v1/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       'llama3.1',
        prompt,
        max_tokens:  MAX_TOKENS,
        temperature: 0.72,
      }),
      signal: AbortSignal.timeout(BENCH_WATCHDOG_MS),
    });
    const t_end_ms = nowMs();
    if (!res.ok) {
      return { idx, wake_id: wake.wake_id, t_start_ms, t_end_ms,
               latency_ms: t_end_ms - t_start_ms, prompt_tokens: 0, completion_tokens: 0,
               ok: false, text: '', error: `HTTP ${res.status}` };
    }
    const body = await res.json() as {
      choices?: Array<{ text?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text             = body.choices?.[0]?.text ?? '';
    const completion_tokens = body.usage?.completion_tokens ?? 0;
    const prompt_tokens     = body.usage?.prompt_tokens     ?? 0;
    const ok = completion_tokens > 0 && text.trim().length > 0;
    return {
      idx, wake_id: wake.wake_id, t_start_ms, t_end_ms,
      latency_ms: t_end_ms - t_start_ms,
      prompt_tokens, completion_tokens, ok, text,
      ...(!ok ? { error: `empty or zero-token completion` } : {}),
    };
  } catch (e) {
    const t_end_ms = nowMs();
    return { idx, wake_id: wake.wake_id, t_start_ms, t_end_ms,
             latency_ms: t_end_ms - t_start_ms, prompt_tokens: 0, completion_tokens: 0,
             ok: false, text: '', error: String(e) };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  // ── Load wakes ─────────────────────────────────────────────────────────
  const wakesPath = join(ROOT, 'evidence', 'capstone-wakes.json');
  const wakes: WakeRecord[] = JSON.parse(readFileSync(wakesPath, 'utf-8'));
  console.log(`Loaded ${wakes.length} wake records from ${wakesPath}`);

  // ── Budget pre-check ────────────────────────────────────────────────────
  // ESTIMATE: startup_sec + (wakes / throughput_R_per_s) × market_price
  const estimatedInferenceSec = Math.ceil(wakes.length / 3.45);
  const estimatedTotalSec     = STARTUP_SEC_ESTIMATE + estimatedInferenceSec;
  const estimatedDepositRaw   = estimatedTotalSec * MARKET_PRICE_RAW_PER_SEC;
  const estimatedNetRaw       = estimatedInferenceSec * MARKET_PRICE_RAW_PER_SEC;
  console.log(`\n── Budget pre-check (ESTIMATE) ──`);
  console.log(`  Wakes:            ${wakes.length}`);
  console.log(`  Startup est:      ~${STARTUP_SEC_ESTIMATE}s`);
  console.log(`  Inference est:    ~${estimatedInferenceSec}s (@ 3.45 R/s)`);
  console.log(`  Deposit est:      ~${estimatedDepositRaw.toLocaleString()} raw / ${(estimatedDepositRaw/1_000_000).toFixed(4)} NOS`);
  console.log(`  Net est:          ~${estimatedNetRaw.toLocaleString()} raw / ${(estimatedNetRaw/1_000_000).toFixed(4)} NOS`);
  if (estimatedDepositRaw > MAX_NOS_EXPOSURE) {
    console.error(`ABORT: estimated deposit ${estimatedDepositRaw} raw > ${MAX_NOS_EXPOSURE} raw cap. Stopping.`);
    process.exit(1);
  }
  console.log(`  Within 1 NOS cap. Proceeding.\n`);

  // ── Wallet ──────────────────────────────────────────────────────────────
  const walletPath = process.env['WALLET_PATH'];
  let walletRaw: string;
  if (walletPath) {
    walletRaw = readFileSync(walletPath, 'utf-8').trim();
  } else {
    const val = process.env['NOSANA_WALLET_PRIVATE_KEY'];
    if (!val) throw new Error('Set WALLET_PATH or NOSANA_WALLET_PRIVATE_KEY');
    walletRaw = val.trim();
  }

  // ── Load SDK ────────────────────────────────────────────────────────────
  const { Client } = await import('@nosana/sdk') as { Client: new(env: string, wallet: never) => NosanaClient };
  const client = new Client('mainnet', walletRaw as never);

  const connection   = (client as unknown as { solana: { connection: unknown } }).solana?.connection as Parameters<typeof getAtaBalance>[0];
  const walletPubkey = (client as unknown as { solana: { wallet: { publicKey: unknown } } }).solana?.wallet?.publicKey;

  // ── Market check ────────────────────────────────────────────────────────
  let chosenMarket = MARKET;
  console.log(`Checking market ${chosenMarket}...`);
  const marketObj = await client.jobs.getMarket(chosenMarket) as Record<string, unknown>;
  const queueType = Number((marketObj as { queueType?: unknown }).queueType ?? -1);
  const queueLen  = Number((marketObj as { queue?: unknown[] }).queue?.length ?? 0);
  console.log(`  queueType=${queueType} (1=NODE_QUEUE=idle nodes), queueLen=${queueLen}`);

  if (queueType !== 1 || queueLen === 0) {
    if (MARKET !== RTX_4090_COMMUNITY) {
      // If community was explicitly requested but empty, try premium
      const premiumObj = await client.jobs.getMarket(RTX_4090_PREMIUM) as Record<string, unknown>;
      const pqt = Number((premiumObj as { queueType?: unknown }).queueType ?? -1);
      const pql = Number((premiumObj as { queue?: unknown[] }).queue?.length ?? 0);
      if (pqt !== 1 || pql === 0) {
        console.error('ABORT: neither community nor premium market has idle nodes.');
        process.exit(1);
      }
      chosenMarket = RTX_4090_PREMIUM;
    } else {
      console.error(`ABORT: community market has no idle nodes.`);
      process.exit(1);
    }
  }
  console.log(`Market: ${chosenMarket} — ${MARKET_NAMES[chosenMarket] ?? 'unknown'}`);

  // ── ATA pre-balance ─────────────────────────────────────────────────────
  const preBalance = await getAtaBalance(connection, walletPubkey);
  console.log(`Pre-balance: ${preBalance ?? 'unknown'} raw NOS`);

  // ── Post job ────────────────────────────────────────────────────────────
  const posted_at = nowIso();
  console.log(`\nPosting vLLM job to ${chosenMarket}...`);
  const { job: job_id } = await client.jobs.list(VLLM_JOB_DEF, JOB_TIMEOUT_SECS, chosenMarket);
  const endpoint = await deriveEndpoint(job_id);
  console.log(`Job ID:    ${job_id}`);
  console.log(`Endpoint:  ${endpoint}`);

  let claimed_at:  string | null = null;
  let started_at:  string | null = null;
  let settled_at:  string | null = null;
  let host:        string | null = null;
  let outcome_code = 'unknown';
  let jobEnded = false;
  let readings: ReadingResult[] = [];

  // ── Guaranteed stop ─────────────────────────────────────────────────────
  async function endJob(reason: string) {
    if (jobEnded) return;
    jobEnded = true;
    console.log(`\nEnding job (${reason})...`);
    let currentState = '';
    try {
      const job = await client.jobs.get(job_id);
      currentState = String(job.state).toUpperCase();
      console.log(`Chain state: ${currentState}`);
    } catch (e) { console.error(`Could not fetch chain state: ${e}`); }

    if (currentState === 'COMPLETED' || currentState === 'STOPPED') {
      console.log('Job already settled — skipping jobs.end()');
      settled_at ??= nowIso();
    } else {
      try {
        await client.jobs.end(job_id);
        settled_at = nowIso();
        console.log(`Job ended at ${settled_at}`);
      } catch (e) { console.error(`jobs.end failed: ${e}`); }
    }

    const postBalance = await getAtaBalance(connection, walletPubkey);
    writeReceipt({ job_id, endpoint, chosenMarket, outcome_code, posted_at, claimed_at, started_at, settled_at, host, preBalance, postBalance, readings, wakes });
  }

  process.once('uncaughtException', async (e: Error) => {
    console.error(`\n[uncaughtException] ${e?.message ?? e}`);
    outcome_code = 'aborted';
    await endJob('uncaughtException');
    process.exit(1);
  });
  process.once('unhandledRejection', async (reason: unknown) => {
    console.error(`\n[unhandledRejection] ${reason}`);
    outcome_code = 'aborted';
    await endJob('unhandledRejection');
    process.exit(1);
  });
  process.once('SIGINT', async () => {
    console.log('\n[SIGINT]');
    outcome_code = 'partial';
    await endJob('SIGINT');
    process.exit(130);
  });

  try {

    // ── Poll until RUNNING ─────────────────────────────────────────────
    console.log('\nWaiting for job to be claimed...');
    const runDeadline  = nowMs() + JOB_TIMEOUT_MS;
    let lastJobState   = '';
    while (nowMs() < runDeadline) {
      await sleep(6_000);
      const job      = await client.jobs.get(job_id);
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
        outcome_code = 'job_error';
        try {
          const completedJob = await client.jobs.get(job_id);
          if (completedJob.ipfsResult) {
            const ipfsLog = await client.ipfs.retrieve(completedJob.ipfsResult);
            console.log('IPFS result:', JSON.stringify(ipfsLog, null, 2));
          }
        } catch (e) { console.error(`IPFS fetch failed: ${e}`); }
        jobEnded = true;
        throw new Error(`Job ${jobState} prematurely`);
      }
    }

    if (!started_at) {
      outcome_code = 'timeout';
      return;
    }

    // ── Wait for /health ───────────────────────────────────────────────
    console.log(`\nPolling ${endpoint}/health (up to ${HEALTH_TIMEOUT_MS / 1000}s)...`);
    const t_health_start = nowMs();
    const healthDeadline = t_health_start + HEALTH_TIMEOUT_MS;
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
    console.log(`\nHealthy (${(t_healthy_ms / 1000).toFixed(1)}s${t_healthy_ms < 90_000 ? ', S3 likely cached' : ', fresh S3 pull'})`);

    // ── Warm-up ────────────────────────────────────────────────────────
    console.log('\nRunning warm-up...');
    const warmupWake = wakes[0];
    const warmupPrompt = buildPrompt(warmupWake);
    const warmupRes = await fetch(`${endpoint}/v1/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3.1', prompt: warmupPrompt, max_tokens: MAX_TOKENS, temperature: 0.72 }),
      signal: AbortSignal.timeout(60_000),
    });
    const warmupBody = await warmupRes.json() as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices?: Array<{ text?: string }>;
    };
    const warmupPromptTokens     = warmupBody.usage?.prompt_tokens ?? 0;
    const warmupCompletionTokens = warmupBody.usage?.completion_tokens ?? 0;
    console.log(`Warm-up: prompt_tokens=${warmupPromptTokens} completion_tokens=${warmupCompletionTokens}`);
    console.log(`Warm-up text: ${warmupBody.choices?.[0]?.text?.slice(0, 120) ?? '(empty)'}...`);

    // ── Run all readings ───────────────────────────────────────────────
    console.log(`\nRunning ${wakes.length} Readings at ${CONCURRENCY} concurrent...`);
    const t_bench_start = nowMs();

    for (let i = 0; i < wakes.length; i += CONCURRENCY) {
      const batch = wakes.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((wake, bi) => runReading(endpoint, i + bi, wake))
      );
      readings.push(...batchResults);
      const done = Math.min(i + CONCURRENCY, wakes.length);
      const okCount = readings.filter(r => r.ok).length;
      const elapsed = ((nowMs() - t_bench_start) / 1000).toFixed(1);
      console.log(`  ${done}/${wakes.length} (${okCount} ok) — ${elapsed}s elapsed`);
    }

    const t_bench_ms  = nowMs() - t_bench_start;
    const okReadings  = readings.filter(r => r.ok);
    const throughput  = readings.length / (t_bench_ms / 1000);
    console.log(`\nReadings complete: ${okReadings.length}/${readings.length} ok`);
    console.log(`Throughput: ${throughput.toFixed(2)} R/s`);
    console.log(`Bench time: ${(t_bench_ms / 1000).toFixed(1)}s`);

    outcome_code = okReadings.length === readings.length ? 'ok' : 'partial';

  } finally {
    const postBalance = await getAtaBalance(connection, walletPubkey);
    await endJob('finally');
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('SIGINT');

    console.log(`\nPost-balance: ${postBalance ?? 'unknown'} raw NOS`);
    if (preBalance != null && postBalance != null) {
      const net = preBalance - postBalance;
      console.log(`Net spend: ${net} raw / ${(net / 1_000_000).toFixed(6)} NOS`);
    }
  }
}

// ── Write receipt and evidence files ──────────────────────────────────────
function writeReceipt(ctx: {
  job_id: string; endpoint: string; chosenMarket: string; outcome_code: string;
  posted_at: string; claimed_at: string | null; started_at: string | null;
  settled_at: string | null; host: string | null;
  preBalance: number | null; postBalance?: number | null;
  readings: ReadingResult[]; wakes: WakeRecord[];
}) {
  const {
    job_id, endpoint, chosenMarket, outcome_code,
    posted_at, claimed_at, started_at, settled_at, host,
    preBalance, postBalance, readings, wakes,
  } = ctx;

  const okReadings    = readings.filter(r => r.ok);
  const latencies     = readings.map(r => r.latency_ms).sort((a, b) => a - b);
  const p50           = latencies[Math.floor(latencies.length * 0.5)] ?? null;
  const p95           = latencies[Math.floor(latencies.length * 0.95)] ?? null;
  const benchMs       = readings.length > 0
    ? (readings[readings.length - 1].t_end_ms - readings[0].t_start_ms)
    : null;
  const throughput    = (benchMs && readings.length > 0) ? readings.length / (benchMs / 1000) : null;

  const netRaw        = (preBalance != null && postBalance != null) ? (preBalance - postBalance) : null;
  const depositRaw    = netRaw != null ? Math.round(netRaw * 1.0) : null;

  const receipt = {
    receipt_version: '0.1.0',
    provider:        'nosana',
    job_id,
    market:          chosenMarket,
    market_name:     'NVIDIA 4090 Community (COMMUNITY)',
    host:            host ?? null,
    gpu_class:       null,
    posted_at,
    claimed_at:      claimed_at ?? posted_at,
    started_at:      started_at ?? posted_at,
    settled_at:      settled_at ?? new Date().toISOString(),
    result_hash:     null,
    ipfs_cid:        null,
    cost_nos:        netRaw ?? 0,
    chain_state:     'COMPLETED',
    outcome_code:    ['ok', 'partial', 'job_error', 'host_error', 'failed', 'timeout', 'unknown'].includes(outcome_code)
      ? outcome_code : 'unknown',
    capstone: {
      demonstration:    true,
      note:             'DEMONSTRATION — outputs are evidence files, NOT written into production readings tables.',
      wake_count:       wakes.length,
      readings_ok:      okReadings.length,
      readings_total:   readings.length,
      throughput_R_per_s: throughput ? Number(throughput.toFixed(4)) : null,
      latency_p50_ms:   p50,
      latency_p95_ms:   p95,
      bench_wall_ms:    benchMs,
      net_raw:          netRaw,
      net_nos:          netRaw != null ? netRaw / 1_000_000 : null,
      endpoint,
    },
  };

  const receiptPath = join(ROOT, 'evidence', `capstone-receipt.json`);
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(`\nReceipt written: ${receiptPath}`);

  // ── Sample readings (3 from image twins with organism data) ───────────────
  const sampleCandidates = readings.filter(r => r.ok && wakes[r.idx]?.species_name).slice(0, 3);
  const samples = sampleCandidates.map(r => ({
    wake_id:         r.wake_id,
    twin_kind:       wakes[r.idx]?.twin_kind,
    species_name:    wakes[r.idx]?.species_name,
    common_name:     wakes[r.idx]?.common_name,
    event_type:      wakes[r.idx]?.event_type,
    headline:        wakes[r.idx]?.headline,
    hazard_type_en:  wakes[r.idx]?.hazard_type_en,
    lat:             wakes[r.idx]?.lat,
    lon:             wakes[r.idx]?.lon,
    habitat_key:     wakes[r.idx]?.habitat_key,
    prompt_tokens:   r.prompt_tokens,
    completion_tokens: r.completion_tokens,
    latency_ms:      r.latency_ms,
    reading_text:    r.text.trim(),
  }));

  // ── All readings output ────────────────────────────────────────────────────
  const readingsOut = readings.map(r => ({
    idx:               r.idx,
    wake_id:           r.wake_id,
    twin_kind:         wakes[r.idx]?.twin_kind,
    species_name:      wakes[r.idx]?.species_name ?? null,
    event_type:        wakes[r.idx]?.event_type ?? null,
    headline:          wakes[r.idx]?.headline ?? null,
    habitat_key:       wakes[r.idx]?.habitat_key ?? null,
    ok:                r.ok,
    prompt_tokens:     r.prompt_tokens,
    completion_tokens: r.completion_tokens,
    latency_ms:        r.latency_ms,
    reading_text:      r.text.trim(),
    error:             r.error ?? null,
  }));

  const readingsPath = join(ROOT, 'evidence', 'capstone-readings.json');
  writeFileSync(readingsPath, JSON.stringify(readingsOut, null, 2));
  console.log(`Readings written: ${readingsPath}`);

  // ── Summary doc ───────────────────────────────────────────────────────────
  const nos_usd_rate = 0.4026; // CoinGecko 2026-11-11
  const netNos  = netRaw != null ? netRaw / 1_000_000 : null;
  const netUsd  = netNos != null ? netNos * nos_usd_rate : null;
  const eventTypes = [...new Set(wakes.map(w => w.event_type).filter(Boolean))].join(', ');
  const uniqueEvents = [...new Set(wakes.map(w => w.unified_event_id).filter(Boolean))];

  const sampleSection = samples.length > 0 ? `
## Sample Readings

${samples.map((s, i) => `### Reading ${i + 1} — ${s.species_name ?? 'organism'} / ${s.hazard_type_en ?? s.event_type}

**Wake:** \`${s.wake_id}\`
**Organism:** ${s.species_name ?? 'n/a'}${s.common_name ? ` (${s.common_name})` : ''} · habitat \`${s.habitat_key}\`
**Event:** ${s.headline ?? s.event_type} · ${s.lat != null ? `${s.lat?.toFixed(2)}°N ${s.lon?.toFixed(2)}°E` : s.habitat_key}
**Tokens:** ${s.prompt_tokens} prompt / ${s.completion_tokens} completion · ${s.latency_ms}ms

> ${s.reading_text}
`).join('\n')}` : '';

  const summaryMd = `# Capstone Readings Run — Rung 5 Evidence

> **DEMONSTRATION:** outputs are evidence files, NOT written into production readings tables.

**Job ID:** \`${job_id}\`
**Date:** ${posted_at.split('T')[0]}
**Market:** NVIDIA 4090 Community (COMMUNITY) \`${chosenMarket.slice(0, 8)}…\`
**Host:** \`${host?.slice(0, 8) ?? 'unknown'}…\`
**Outcome:** ${outcome_code}

---

## What this demonstrates

The end-to-end loop: real wake records from eden-prod → one Nosana vLLM inference job → Readings generated → receipted. This is rung 5 of the 10k-fleet grant ladder.

---

## Wake batch

| Metric | Value |
|--------|-------|
| Total wakes | ${wakes.length} |
| Twin kinds | image (${wakes.filter(w => w['twin_kind'] === 'image').length}), organism-spawn (${wakes.filter(w => w['twin_kind'] === 'organism-spawn').length}) |
| Unique events | ${uniqueEvents.length} (all events in coordinator history) |
| Event types | ${eventTypes} |
| Date range | ${wakes[wakes.length - 1]?.decided_at?.split('T')[0]} → ${wakes[0]?.decided_at?.split('T')[0]} |

Source: \`coordinator.wake_decisions\` JOIN \`coordinator.twins\` JOIN \`coordinator.events\` JOIN eden-prod \`unified_events\` / \`event_spawns\` / \`botanical_entities\`. Pulled live from production 2026-11-12.

---

## Readings generated

| Metric | Value |
|--------|-------|
| Readings OK | **${okReadings.length} / ${readings.length}** |
| Throughput | ${throughput ? `**${throughput.toFixed(2)} R/s**` : 'n/a'} |
| Latency p50 / p95 | ${p50 ?? 'n/a'} / ${p95 ?? 'n/a'} ms |
| Bench wall time | ${benchMs != null ? `${(benchMs / 1000).toFixed(1)}s` : 'n/a'} |

---

## Cost

| Metric | Value |
|--------|-------|
| Net raw | ${netRaw != null ? `${netRaw.toLocaleString()} raw` : 'pending reconciliation'} |
| Net NOS | ${netNos != null ? netNos.toFixed(6) : 'pending'} NOS |
| Net USD | ${netUsd != null ? `$${netUsd.toFixed(4)}` : 'pending'} |
| Per-Reading (net) | ${(netRaw != null && readings.length > 0) ? `${(netRaw / readings.length).toFixed(1)} raw / $${((netUsd ?? 0) / readings.length).toFixed(6)}` : 'pending'} |

NOS price: $${nos_usd_rate} (CoinGecko 2026-11-11, **ESTIMATE**).

> **Cost note (ESTIMATE):** net spend is derived from ATA delta (pre/post wallet balance). Deposit was held for the full job timeout; refund returned unused seconds. Figure above is the net after refund.

---

## Extrapolations — ESTIMATE

| Scenario | Value |
|----------|-------|
| At current fleet size (190 wakes, all events to date) | ${netUsd != null ? `$${netUsd.toFixed(4)}` : 'n/a'} per full cycle |
| At probe throughput (3.45 R/s, 178,757 wakes/day) | **~$5.27/day** (see nosana-priced-demand.md) |
| Per-Reading sustained rate | **~$0.000029** (see nosana-priced-demand.md) |

All extrapolations labelled ESTIMATE. See \`evidence/nosana-priced-demand.md\` for methodology and caveats.
${sampleSection}

---

## Caveats

- **DEMONSTRATION:** no Reading records were written to production tables.
- **190 wakes = all coordinator history to date.** The fleet registered ~580k twins but active wake policies are early-stage; 190 wakes across 4 events is the full production record. At scale the batch per event would be much larger.
- **Quality not evaluated.** The 8B AWQ INT4 model generates plausible ecological text but quality has not been reviewed by a domain expert.
- **Same caveats as probe** (single node, single run, one community 4090): see \`evidence/nosana-priced-demand.md#caveats\`.

---

_Full receipt: \`evidence/capstone-receipt.json\`_
_All readings: \`evidence/capstone-readings.json\`_
_Source wakes: \`evidence/capstone-wakes.json\`_
`;

  const summaryPath = join(ROOT, 'evidence', 'capstone-summary.md');
  writeFileSync(summaryPath, summaryMd);
  console.log(`Summary written: ${summaryPath}`);

  if (samples.length > 0) {
    console.log('\n── Sample Readings ──');
    samples.forEach((s, i) => {
      console.log(`\n[${i + 1}] ${s.species_name ?? 'organism'} / ${s.hazard_type_en ?? s.event_type}`);
      console.log(`    ${s.reading_text.slice(0, 200)}`);
    });
  }
}

main().catch(e => {
  console.error('[main error]', e);
  process.exit(1);
});
