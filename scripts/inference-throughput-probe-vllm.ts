/**
 * Inference throughput probe — vLLM Llama 3.1 8B AWQ INT4 on Nosana.
 *
 * Uses the official Nosana vLLM job definition verbatim:
 *   https://learn.nosana.com/inference/examples/vllm.html
 *
 * Architecture: service run (not batch).
 *   - Posts job to premium market 97G9… (or community Dcwz62… if premium has no idle nodes).
 *   - Override with --market <addr> or NOSANA_MARKET env var.
 *   - Probe runs from local machine against the job's exposed endpoint.
 *   - Endpoint URL computed from job ID via SDK expose hash:
 *       https://<getExposeIdHash(jobId, opIndex=0, port=8000)>.node.k8s.prd.nos.ci
 *     Source: @nosana/sdk dist/utils/expose.js getExposeIdHash + @nosana/cli .env.prd FRP_SERVER_ADDRESS
 *   - Warm-up: 1 × /v1/completions (max_tokens=180, ignore_eos=true); aborts if completion_tokens < 180
 *   - Benchmark: 200 Readings at 32 concurrent, per-request timing; only counts reading as successful
 *     if usage.completion_tokens == 180 (ignore_eos=true enforces full-length responses)
 *   - 480 s benchmark watchdog; PARTIAL recorded if benchmark incomplete
 *   - finally: client.jobs.end(jobId) on all exit paths
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
  // Replicate getExposeIdHash(flowId=jobId, op=0, port=8000):
  //   inputString = `${op}:${port}:${flowId}` = "0:8000:<jobId>"
  //   bs58.encode(nacl.hash(textEncoder.encode(inputString))).slice(0, 44)
  const bs58   = (await import('bs58')).default;
  const nacl   = (await import('tweetnacl')).default;
  const input  = `0:8000:${jobId}`;
  const hash   = nacl.hash(new TextEncoder().encode(input));
  const exposeId = bs58.encode(hash).slice(0, 44);
  return `https://${exposeId}.${FRP_SERVER_ADDR}`;
}

// ── Official vLLM job definition ────────────────────────────────────────────
// Verbatim from https://learn.nosana.com/inference/examples/vllm.html
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
const TOTAL_READINGS    = 200;
const CONCURRENCY       = 32;
const MAX_TOKENS        = 180;        // exact completion length enforced by ignore_eos
const BENCH_WATCHDOG_MS = 480_000;    // 480 s
const HEALTH_TIMEOUT_MS = 300_000;    // 5 min to become healthy
const JOB_TIMEOUT_SECS  = 1800;       // platform-side 30 min hard cap
const JOB_TIMEOUT_MS    = 1_800_000;

// NOS mint for ATA balance checks
const NOS_MINT = 'nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7';

// 950-token Eden Reading prompt (approximated; content is stable across runs)
const PROMPT = `You are an ecological intelligence. A player has requested a Reading for their current encounter.

Encounter context:
- Species: Belted Kingfisher (Megaceryle alcyon)
- Habitat: Riparian woodland, creek margin
- Coordinates: 37.8716° N, 122.2727° W
- Timestamp: 2026-11-11T16:42:00Z
- Weather: Partly cloudy, 14°C, wind 8 km/h NW
- Recent activity: Player has been observing the creek for 20 minutes
- Previous encounters this season: 3
- Player's Eden tier: Observer

Write a full ecological Reading for this encounter. Include: the species' ecological role in this habitat, what the weather and season mean for this individual's behaviour, what the player might witness if they remain still, and a closing reflection on the significance of this encounter within the player's season arc. Aim for approximately 180 tokens.`;

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
  ok:                boolean;  // true only if completion_tokens == MAX_TOKENS
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
        ignore_eos:  true,   // prevent early stops from inflating throughput
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
      prompt_tokens, completion_tokens,
      ok,
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

  // ── Idle-node check: premium first, fall back to community ────────────────
  let chosenMarket = MARKET;
  console.log(`Checking market ${chosenMarket}...`);
  const marketObj = await client.jobs.getMarket(chosenMarket) as Record<string, unknown>;
  const queueType = Number((marketObj as { queueType?: unknown }).queueType ?? -1);
  const queueLen  = Number((marketObj as { queue?: unknown[] }).queue?.length ?? 0);
  console.log(`  queueType=${queueType} (1=NODE_QUEUE=idle nodes), queueLen=${queueLen}`);

  if (queueType !== 1 || queueLen === 0) {
    // If explicit market was given (not defaulting), abort rather than silently switch
    if (MARKET !== RTX_4090_PREMIUM) {
      console.error(`ABORT: requested market ${MARKET} has no idle nodes. Re-run when nodes are available.`);
      process.exit(1);
    }
    // Auto-fallback: try community
    console.log(`Premium has no idle nodes — checking community ${RTX_4090_COMMUNITY}...`);
    const communityObj = await client.jobs.getMarket(RTX_4090_COMMUNITY) as Record<string, unknown>;
    const cqt = Number((communityObj as { queueType?: unknown }).queueType ?? -1);
    const cql = Number((communityObj as { queue?: unknown[] }).queue?.length ?? 0);
    console.log(`  queueType=${cqt}, queueLen=${cql}`);
    if (cqt !== 1 || cql === 0) {
      console.error('ABORT: neither premium nor community market has idle nodes. Re-run later.');
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
  console.log(`  (derived: bs58(sha512("0:8000:${job_id}")).slice(0,44).${FRP_SERVER_ADDR})`);

  // ── State tracking ─────────────────────────────────────────────────────────
  let claimed_at:  string | null = null;
  let started_at:  string | null = null;
  let settled_at:  string | null = null;
  let host:        string | null = null;
  let outcome_code: string | null = null;
  let jobEnded = false;

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
  }

  process.once('SIGINT', async () => {
    console.log('\n[SIGINT]');
    outcome_code = 'partial';
    await endJob('SIGINT');
    process.exit(130);
  });

  // ── Poll until RUNNING ─────────────────────────────────────────────────────
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
      outcome_code = 'failed';
      console.error(`Job terminated prematurely: ${jobState}`);
      break;
    }
  }

  if (!started_at) {
    outcome_code = 'timeout';
    await endJob('never-reached-RUNNING');
    await writeReceipt({ job_id, endpoint, chosenMarket, outcome_code, posted_at, claimed_at, started_at, settled_at, host, preBalance, client, connection, walletPubkey, probe: null });
    process.exit(1);
  }

  // ── Wait for /health ────────────────────────────────────────────────────────
  console.log(`\nPolling ${endpoint}/health (up to ${HEALTH_TIMEOUT_MS / 1000}s)...`);
  const healthDeadline = nowMs() + HEALTH_TIMEOUT_MS;
  let healthy = false;
  while (nowMs() < healthDeadline) {
    try {
      const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) { healthy = true; break; }
      process.stdout.write('.');
    } catch { process.stdout.write('x'); }
    await sleep(5_000);
  }
  if (!healthy) {
    console.error('\nFATAL: vLLM never became healthy within 300s');
    outcome_code = 'job_error';
    await endJob('health-timeout');
    await writeReceipt({ job_id, endpoint, chosenMarket, outcome_code, posted_at, claimed_at, started_at, settled_at, host, preBalance, client, connection, walletPubkey, probe: null });
    process.exit(1);
  }
  const t_healthy = nowIso();
  console.log(`\nHealthy at ${t_healthy}`);

  // ── GET /v1/models ──────────────────────────────────────────────────────────
  const modelsRes  = await fetch(`${endpoint}/v1/models`);
  const modelsBody = await modelsRes.json();
  console.log('\n/v1/models:', JSON.stringify(modelsBody));

  // ── Warm-up ──────────────────────────────────────────────────────────────────
  console.log('\nRunning warm-up request (ignore_eos=true, max_tokens=180)...');
  const warmup = await runReading(endpoint, 0);
  console.log(`Warm-up: ${warmup.latency_ms}ms  prompt_tokens=${warmup.prompt_tokens}  completion_tokens=${warmup.completion_tokens}  ok=${warmup.ok}`);
  if (warmup.completion_tokens < MAX_TOKENS) {
    console.error(`FATAL: warm-up returned completion_tokens=${warmup.completion_tokens} < ${MAX_TOKENS}; model is stopping early despite ignore_eos=true`);
    outcome_code = 'job_error';
    await endJob('warmup-short-completion');
    await writeReceipt({ job_id, endpoint, chosenMarket, outcome_code, posted_at, claimed_at, started_at, settled_at, host, preBalance, client, connection, walletPubkey, probe: { warmup_error: warmup.error } });
    process.exit(1);
  }

  // ── Benchmark: 200 Readings at 32 concurrent ───────────────────────────────
  console.log(`\nStarting benchmark: ${TOTAL_READINGS} readings at ${CONCURRENCY} concurrent (watchdog=${BENCH_WATCHDOG_MS / 1000}s)...`);
  const t_bench_start = nowMs();
  const results: ReadingResult[] = [];
  let   watchdogFired   = false;
  let   benchComplete   = false;

  const watchdog = setTimeout(() => {
    if (!benchComplete) {
      watchdogFired = true;
      console.error(`\n[WATCHDOG] benchmark exceeded ${BENCH_WATCHDOG_MS / 1000}s — stopping`);
    }
  }, BENCH_WATCHDOG_MS);

  for (let batchStart = 0; batchStart < TOTAL_READINGS && !watchdogFired; batchStart += CONCURRENCY) {
    const batchEnd  = Math.min(batchStart + CONCURRENCY, TOTAL_READINGS);
    const batchIdxs = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i + 1);
    const batchResults = await Promise.all(batchIdxs.map(i => runReading(endpoint, i)));
    results.push(...batchResults);
    const ok = batchResults.filter(r => r.ok).length;
    console.log(`  Batch ${batchStart + 1}–${batchEnd}: ${ok}/${batchResults.length} ok`);
    if (watchdogFired) break;
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

  console.log(`\nBenchmark complete: ${ok_readings.length}/${TOTAL_READINGS} ok (${results.filter(r => !r.ok).length} short/failed)`);
  console.log(`  Wall time:  ${(bench_wall_ms / 1000).toFixed(1)}s`);
  console.log(`  Readings/s: ${readings_per_sec.toFixed(2)} (only full-${MAX_TOKENS}-token completions counted)`);
  console.log(`  Latency p50/p95/p99: ${p50}/${p95}/${p99} ms`);

  const probe = {
    t_healthy,
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
    watchdog_fired:           watchdogFired,
    engine:                   'vllm 0.5.4',
    quantization:             'awq-int4',
    model:                    'hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4',
    timing_source:            'local-machine-network',
    per_reading_results:      results,
  };

  await endJob(`outcome=${outcome_code}`);
  await writeReceipt({ job_id, endpoint, chosenMarket, outcome_code, posted_at, claimed_at, started_at, settled_at, host, preBalance, client, connection, walletPubkey, probe });

  if (outcome_code !== 'ok') {
    console.error(`\nOutcome: ${outcome_code}`);
    process.exit(1);
  }
  console.log('\nOutcome: ok — probe complete.');
}

// ── Receipt writer ────────────────────────────────────────────────────────────
async function writeReceipt(ctx: {
  job_id:        string;
  endpoint:      string;
  chosenMarket:  string;
  outcome_code:  string | null;
  posted_at:     string;
  claimed_at:    string | null;
  started_at:    string | null;
  settled_at:    string | null;
  host:          string | null;
  preBalance:    number | null;
  client:        NosanaClient;
  connection:    Parameters<typeof getAtaBalance>[0];
  walletPubkey:  unknown;
  probe:         unknown;
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
    receipt_version:  '0.1.0',
    provider:         'nosana',
    job_id,
    market:           chosenMarket,
    market_name:      MARKET_NAMES[chosenMarket] ?? 'unknown',
    host,
    endpoint,
    endpoint_derivation: `bs58(sha512("0:8000:${job_id}")).slice(0,44).${FRP_SERVER_ADDR}`,
    endpoint_source:  '@nosana/sdk dist/utils/expose.js getExposeIdHash + @nosana/cli dist/.env.prd FRP_SERVER_ADDRESS',
    posted_at,
    claimed_at,
    started_at,
    settled_at:       settled_at ?? new Date().toISOString(),
    ipfs_cid,
    cost_breakdown:   costBreakdown,
    outcome_code,
    engine:           'vllm 0.5.4',
    quantization:     'awq-int4',
    inference_probe:  probe,
    _job_def_source:  'https://learn.nosana.com/inference/examples/vllm.html (verbatim)',
    _ipfs_raw:        ipfs_raw,
  };

  const jobPrefix       = job_id.slice(0, 8);
  const receiptFilename = outcome_code === 'ok'
    ? 'inference-throughput-receipt.json'
    : `inference-throughput-receipt-FAILED-${jobPrefix}.json`;

  writeFileSync(join(ROOT, 'evidence', receiptFilename), JSON.stringify(receipt, null, 2), 'utf-8');
  console.log(`\nWrote evidence/${receiptFilename}`);

  if (outcome_code === 'ok' && probe && typeof probe === 'object' && 'readings_per_sec' in probe) {
    const p = probe as { readings_per_sec: number; latency_p95_ms: number };
    const rps     = p.readings_per_sec;
    const rph     = rps * 3600;
    const fleet1k = 1_000 / rps;
    const fleet10k = 10_000 / rps;
    const md = `# Nosana Inference Demand Estimate — vLLM Llama 3.1 8B AWQ INT4

> **ESTIMATE** — derived from a single probe run on a Nosana RTX 4090 node.
> Engine: vLLM 0.5.4 · Model: Meta-Llama-3.1-8B-Instruct-AWQ-INT4 · Timing: local-machine network
> Only full-180-token completions counted (ignore_eos=true enforced).

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
