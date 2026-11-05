/**
 * Fetch a completed Nosana job's on-chain data + IPFS result and build a full receipt.
 */
import { createHash } from 'crypto';
import { Client } from '@nosana/sdk';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import {
  parseGemmOutput,
  buildCorrectnessCheck,
  buildPerformanceCheck,
} from '../src/index.js';
import type { ProbeReceipt } from '../src/index.js';

const raw = (process.env['NOSANA_WALLET_PRIVATE_KEY'] ?? '').trim();
if (!raw) throw new Error('NOSANA_WALLET_PRIVATE_KEY not set');

const jobId   = process.env['JOB_ID'] ?? 'YDcMRyj9hddbucDSErNSyE8n2zC93haKFaTfXs3mSAL';
const market  = '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf';

const client  = new Client('mainnet', raw as never);
const job     = await (client.jobs as any).get(jobId);

console.log('job state:', job.state, '  price:', job.price, '  node:', job.node);
console.log('ipfsResult:', job.ipfsResult ?? '(none)');

if (!job.ipfsResult) {
  console.log('No ipfsResult — cannot build full receipt.');
  process.exit(1);
}

// Fetch the IPFS result artifact
const flowState = await (client.ipfs as any).retrieve(job.ipfsResult);
const resultHash = createHash('sha256').update(JSON.stringify(flowState)).digest('hex');
console.log('result_hash:', resultHash);

// Extract stdout lines from the first op
const opState = flowState?.state?.opStates?.[0];
const stdoutLines: string[] = ((opState?.logs ?? []) as Array<{type:string; log?:string}>)
  .filter(l => l.type === 'stdout' && l.log)
  .map(l => l.log as string);
const stdout = stdoutLines.join('\n');

console.log('\n--- stdout ---');
console.log(stdout || '(empty)');
console.log('--- end stdout ---\n');

// Build receipt
const receipt: ProbeReceipt = {
  receipt_version: '0.1.0',
  provider:        'nosana',
  job_id:          jobId,
  market,
  host:            job.node ?? null,
  gpu_class:       null,
  posted_at:       '2026-11-04T14:48:44.467Z',  // from original run
  claimed_at:      '2026-11-04T14:48:55.160Z',
  started_at:      null,                          // was null at poll time; actual start unknown
  settled_at:      new Date().toISOString(),
  result_hash:     resultHash,
  cost_nos:        job.price != null ? Number(job.price) : null,
  outcome_code:    'ok',
};

// Populate probe fields if stdout looks like GEMM output
if (stdout) {
  try {
    const gemmOut = parseGemmOutput(stdout);
    receipt.correctness = buildCorrectnessCheck(gemmOut);
    receipt.performance = buildPerformanceCheck(gemmOut, 'RTX 4090');
    console.log('correctness.pass:', receipt.correctness.pass);
    console.log('performance.conformance_score:', receipt.performance?.conformance_score);
  } catch (e: any) {
    console.log('stdout is not GEMM probe format:', e.message);
  }
}

console.log('\n=== RECEIPT JSON ===');
console.log(JSON.stringify(receipt, null, 2));
