/**
 * Run GEMM probe against a market and print the receipt JSON.
 * Usage: MARKET=<pubkey> TIMEOUT_MS=1200000 railway run --service edenbotanical -- npx tsx scripts/run-probe.ts
 */
import { wrapNosanaJob, GEMM_PROBE_JOB_DEF } from '../src/index.js';

const RTX_4090_MARKET = '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf';
const market     = process.env['MARKET']     ?? RTX_4090_MARKET;
const timeoutMs  = parseInt(process.env['TIMEOUT_MS'] ?? '1200000', 10);
const pollMs     = parseInt(process.env['POLL_MS']    ?? '15000',   10);

console.log(`Posting GEMM probe → market ${market}  timeout ${timeoutMs / 60000} min`);

const receipt = await wrapNosanaJob(GEMM_PROBE_JOB_DEF, {
  market,
  walletEnvVar:   'NOSANA_WALLET_PRIVATE_KEY',
  pollIntervalMs: pollMs,
  timeoutMs,
  jobTimeoutSecs: 1_800,
});

console.log(`outcome: ${receipt.outcome_code}  job_id: ${receipt.job_id}`);
console.log(JSON.stringify(receipt, null, 2));
