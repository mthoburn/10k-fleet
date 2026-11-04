/**
 * Test-only: pin a minimal job def and check the IPFS hash + list() error.
 * Does NOT poll — just posts and prints job_id or error.
 * Never deducts NOS unless jobs.list() fully succeeds.
 */
import { Client } from '@nosana/sdk';

const raw = (process.env['NOSANA_WALLET_PRIVATE_KEY'] ?? '').trim();
const market = '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf';

const client = new Client('mainnet', raw as never);

// Test 1: original job def (no entrypoint)
const origDef = {
  version: '0.1',
  type: 'container',
  meta: { trigger: 'api' },
  ops: [{ type: 'container/run', id: 'gemm-probe', args: { image: 'python:3.11-slim', cmd: ['python', '--version'] } }],
};

// Test 2: new job def with entrypoint + sh -c
const newDef = {
  version: '0.1',
  type: 'container',
  meta: { trigger: 'api' },
  ops: [{ type: 'container/run', id: 'gemm-probe', args: { image: 'python:3.11-slim', entrypoint: ['/bin/sh', '-c'], cmd: ['python3 --version'] } }],
};

for (const [label, def] of [['orig (no entrypoint)', origDef], ['new (sh -c entrypoint)', newDef]] as const) {
  console.log(`\n--- Testing: ${label} ---`);
  try {
    const ipfs = await (client.ipfs as any).pin(def);
    console.log('IPFS CID:', ipfs);
    // If IPFS pin succeeded, attempt list() — this WILL spend NOS if it succeeds
    // so we stop here for the test
    console.log('Pin OK — skipping list() to avoid spending NOS');
  } catch (e: any) {
    console.log('Error:', e.message);
  }
}
