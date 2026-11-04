/**
 * 60-second quickstart — submit a GEMM probe to the Nosana RTX 4090 market
 * and print the resulting ProbeReceipt.
 *
 * Usage:
 *   WALLET_PATH=/path/to/keypair.json npx tsx examples/submit-and-wrap.ts
 *
 * Requirements:
 *   npm install @nosana/sdk @solana/web3.js
 *   A funded wallet keypair (JSON array of 64 bytes) at WALLET_PATH.
 *   The wallet must hold enough NOS to cover one job on the RTX 4090 market.
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

  const walletPath = process.env['WALLET_PATH'];
  if (!walletPath) {
    console.error('Set WALLET_PATH=/path/to/keypair.json  or run with --dry-run');
    process.exit(1);
  }

  console.log('Posting GEMM probe to RTX 4090 market...');

  const receipt = await wrapNosanaJob(GEMM_PROBE_JOB_DEF, {
    market:         RTX_4090_MARKET,
    walletPath,
    pollIntervalMs: 8_000,
    timeoutMs:      600_000, // 10 min — GPU startup can be slow
  });

  // Build probe receipt from the job stdout
  let probeReceipt: ProbeReceipt = { ...receipt };

  if (receipt.outcome_code === 'ok' && receipt.result_hash) {
    // The result_hash covers the full stdout. Parse it for probe fields.
    // (In a real pipeline you'd fetch the job artifacts from the Nosana result store.)
    // For the quickstart we include a mock parse note:
    console.log('\nJob completed. result_hash:', receipt.result_hash);
    console.log('(Fetch the job artifacts from the Nosana result store to populate probe fields.)');
  } else {
    console.log('\nJob outcome:', receipt.outcome_code);
  }

  if (receipt.gpu_class) {
    // If we have parsed stdout from the artifact store, fill these in:
    // const gemmOut = parseGemmOutput(stdout);
    // probeReceipt.correctness = buildCorrectnessCheck(gemmOut);
    // probeReceipt.performance = buildPerformanceCheck(gemmOut, receipt.gpu_class);
  }

  console.log('\n=== Receipt ===');
  console.log(JSON.stringify(probeReceipt, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
