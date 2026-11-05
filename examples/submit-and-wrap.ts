/**
 * 60-second quickstart — submit a GEMM probe to the Nosana RTX 4090 market
 * and print the resulting ProbeReceipt.
 *
 * Usage (wallet file):
 *   WALLET_PATH=/path/to/keypair.json npx tsx examples/submit-and-wrap.ts
 *
 * Usage (env var — base58 Phantom format or JSON array):
 *   NOSANA_WALLET_PRIVATE_KEY=<base58> npx tsx examples/submit-and-wrap.ts
 *
 * Requirements:
 *   npm install @nosana/sdk @solana/web3.js
 *   A funded wallet with enough NOS for one job on the RTX 4090 market.
 *
 * DRY RUN (no wallet needed):
 *   npx tsx examples/submit-and-wrap.ts --dry-run
 *   Prints examples/dry-run-fixture.json and exits.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  wrapNosanaJob,
  GEMM_PROBE_JOB_DEF,
  parseGemmOutput,
  buildCorrectnessCheck,
  buildPerformanceCheck,
  buildDeviceInfo,
} from '../src/index.js';
import type { ProbeReceipt } from '../src/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// RTX 4090 market on Nosana mainnet
const RTX_4090_MARKET = '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf';

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  if (isDryRun) {
    const fixture = JSON.parse(
      readFileSync(join(__dir, 'dry-run-fixture.json'), 'utf-8'),
    );
    console.log('=== DRY RUN — fixture receipt (not a real job) ===');
    console.log(JSON.stringify(fixture, null, 2));
    return;
  }

  // Wallet: prefer WALLET_PATH env var (file), else fall back to NOSANA_WALLET_PRIVATE_KEY.
  // Both JSON-array and base58 formats are supported.
  const walletPath = process.env['WALLET_PATH'];

  console.log('Posting GEMM probe to RTX 4090 market...');
  console.log('Wallet source:', walletPath ? `file: ${walletPath}` : 'NOSANA_WALLET_PRIVATE_KEY env var');

  const receipt = await wrapNosanaJob(GEMM_PROBE_JOB_DEF, {
    market:         RTX_4090_MARKET,
    walletPath:     walletPath,              // undefined → falls back to env var
    walletEnvVar:   'NOSANA_WALLET_PRIVATE_KEY',
    pollIntervalMs: 8_000,
    timeoutMs:      600_000,                // 10 min — GPU startup can be slow
    jobTimeoutSecs: 1_800,
  });

  console.log('\nJob', receipt.job_id, '→', receipt.outcome_code);

  // ── Build probe receipt from IPFS result logs ──────────────────────────────
  // The GEMM container writes one JSON line to stdout.
  // The IPFS result is a FlowState: { state: { opStates: [{ logs: [...] }] } }
  // Extract stdout lines, find the JSON, run probe checks.

  const probeReceipt: ProbeReceipt = { ...receipt };

  if (receipt.outcome_code === 'ok' && receipt.result_hash) {
    console.log('result_hash:', receipt.result_hash);
    console.log('cost_nos:', receipt.cost_nos);

    // Fetch IPFS result to extract stdout for probe checks
    try {
      const { Client } = await import('@nosana/sdk') as { Client: any };
      const walletSrc = process.env['NOSANA_WALLET_PRIVATE_KEY'] ?? '';
      const client = new Client('mainnet', walletSrc as never);
      // Re-fetch the job account to get the ipfsResult CID.
      // The account may be closed shortly after settlement; attempt it now.
      const jobAccount = await client.jobs.get(receipt.job_id).catch(() => null);
      const ipfsResult = jobAccount?.ipfsResult;

      if (ipfsResult) {
        const flowState = await client.ipfs.retrieve(ipfsResult);
        // IPFS FlowState structure: { status, opStates: [{ logs: [...] }] }
        // No extra 'state' wrapper — top-level opStates.
        const opState = flowState?.opStates?.[0];
        const stdoutLines: string[] = (opState?.logs ?? [])
          .filter((l: { type: string; log?: string }) => l.type === 'stdout' && l.log)
          .map((l: { log: string }) => l.log);

        const stdout = stdoutLines.join('\n');

        if (stdout) {
          console.log('\nStdout from container:');
          console.log(stdout);
          const gemmOut = parseGemmOutput(stdout);
          probeReceipt.device_info  = buildDeviceInfo(gemmOut);
          probeReceipt.correctness  = buildCorrectnessCheck(gemmOut);
          probeReceipt.performance  = buildPerformanceCheck(gemmOut, 'RTX 4090');
          console.log('\nProbe results:');
          console.log('  device_name:', probeReceipt.device_info.device_name);
          console.log('  cuda_version:', probeReceipt.device_info.cuda_version);
          console.log('  driver_version:', probeReceipt.device_info.driver_version);
          console.log('  compute_capability:', probeReceipt.device_info.compute_capability);
          console.log('  tf32_matmul:', (gemmOut as any).tf32_matmul);
          console.log('  tf32_cudnn:', (gemmOut as any).tf32_cudnn);
          console.log('  measured_tflops:', gemmOut.measured_tflops);
          console.log('  correctness.pass:', probeReceipt.correctness.pass);
          console.log('  max_rel_error:', probeReceipt.correctness.max_rel_error);
          console.log('  performance.conformance_score:', probeReceipt.performance?.conformance_score);
        }
      }
    } catch (err) {
      console.warn('Could not fetch IPFS result for probe checks:', String(err));
    }
  } else {
    console.log('Job outcome:', receipt.outcome_code);
    console.log('Note: on timeout, the job may still be live on-chain. Check job address:', receipt.job_id);
  }

  console.log('\n=== Receipt ===');
  console.log(JSON.stringify(probeReceipt, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
