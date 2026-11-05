/**
 * Recover a completed Nosana job receipt from on-chain transaction history.
 *
 * Used when the job account has been closed (post-settlement) so jobs.get()
 * returns nothing. Walks getSignaturesForAddress on the job pubkey, finds the
 * finish transaction, extracts the IPFS result hash from instruction data, and
 * builds a full receipt.
 *
 * Usage:
 *   JOB_ID=<base58> NOSANA_WALLET_PRIVATE_KEY=<key> npx tsx scripts/recover-job-from-chain.ts
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { Client } from '@nosana/sdk';
import { createHash } from 'crypto';

const JOB_ID   = process.env['JOB_ID']   ?? 'KSxoprXsX4vegwTWPAjYKQ1osV5Dybp5DjSUkRVAYLj';
const RPC_URL  = process.env['RPC_URL']  ?? 'https://api.mainnet-beta.solana.com';
const WALLET   = (process.env['NOSANA_WALLET_PRIVATE_KEY'] ?? '').trim();
const MARKET   = process.env['MARKET']   ?? '97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf';

const connection = new Connection(RPC_URL, 'confirmed');

console.log(`Recovering job: ${JOB_ID}`);
console.log(`RPC: ${RPC_URL}`);

const jobPubkey = new PublicKey(JOB_ID);

// Step 1: Get all signatures for the job account
const sigs = await connection.getSignaturesForAddress(jobPubkey, { limit: 50 });
console.log(`\nFound ${sigs.length} signatures:`);
for (const s of sigs) {
  console.log(`  ${s.signature}  slot=${s.slot}  err=${s.err ?? 'null'}  memo=${s.memo ?? '-'}`);
}

if (sigs.length === 0) {
  console.error('No signatures found — job ID may be wrong');
  process.exit(1);
}

// Step 2: Fetch each transaction and look for the one that closes/settles the job
// The finish tx is the last one (oldest) or the one with no error that isn't the first (create)
// We'll fetch all and print their data to identify the finish ix

let ipfsCid: string | null = null;
let finishTxSig: string | null = null;
let finishSlot: number | null = null;

// The Nosana program ID
const NOSANA_JOBS_PROGRAM = 'nosJhNRqr2bc9g1nfGDcXXTXvYUmxD4cVwy2pMWhrYM';

for (const sigInfo of sigs) {
  const tx = await connection.getParsedTransaction(sigInfo.signature, {
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) continue;

  const ixs = tx.transaction.message.instructions;
  for (const ix of ixs) {
    if ('programId' in ix && ix.programId.toString() === NOSANA_JOBS_PROGRAM) {
      console.log(`\nNosana ix in ${sigInfo.signature}:`);
      console.log('  keys:', 'accounts' in ix ? (ix as any).accounts?.map((k: any) => k.toString()) : 'parsed');
      if ('data' in ix) {
        const dataHex = Buffer.from(ix.data as string, 'base64').toString('hex');
        console.log('  data (hex):', dataHex);
        // Nosana finish instruction data: 8-byte discriminant + 32-byte IPFS hash
        // discriminant for "finish" is derived from sha256("global:finish")[0..8]
        if (dataHex.length >= 80) { // 40 bytes = 8 discrim + 32 hash
          const hashBytes = dataHex.slice(16, 80); // bytes 8-40
          console.log('  possible IPFS bytes (hex):', hashBytes);

          // Try IPFS.solHashToIpfsHash equivalent:
          // prepend 0x1220 to the 32-byte hash → base58-encode → CIDv0
          const { IPFS } = await import('@nosana/sdk') as any;
          if (IPFS?.solHashToIpfsHash) {
            const hashBuf = Buffer.from(hashBytes, 'hex');
            try {
              const cid = IPFS.solHashToIpfsHash(hashBuf);
              console.log('  IPFS CID:', cid);
              ipfsCid = cid;
              finishTxSig = sigInfo.signature;
              finishSlot = sigInfo.slot;
            } catch (e: any) {
              console.log('  solHashToIpfsHash error:', e.message);
            }
          }
        }
      }
    }
  }
}

// Step 3: If we have a CID, fetch the IPFS result and build the receipt
if (ipfsCid && WALLET) {
  console.log(`\nFetching IPFS result for CID: ${ipfsCid}`);
  const client = new Client('mainnet', WALLET as never);
  try {
    const content = await client.ipfs.retrieve(ipfsCid);
    console.log('\nIPFS content (first 500 chars):');
    console.log(JSON.stringify(content).slice(0, 500));

    const result_hash = createHash('sha256')
      .update(JSON.stringify(content))
      .digest('hex');

    console.log('\nresult_hash:', result_hash);

    // Extract logs from FlowState
    const flowState = content as any;
    const logs: string[] = flowState?.opStates?.[0]?.logs?.map((l: any) => l.log) ?? [];
    console.log('\nContainer logs:');
    for (const line of logs) console.log(' ', line);

    // Build receipt
    const receipt = {
      receipt_version: '0.1.0',
      provider:        'nosana',
      job_id:          JOB_ID,
      market:          MARKET,
      host:            null as string | null,
      gpu_class:       null,
      posted_at:       '2026-11-04T15:47:34.158Z', // from probe-attempt2b.log
      claimed_at:      '2026-11-04T15:47:54.201Z', // from probe-attempt2b.log
      started_at:      null as string | null,
      settled_at:      null as string | null,
      result_hash,
      cost_nos:        null as number | null,
      outcome_code:    'ok',
      _note:           `Recovered from on-chain tx history. Finish tx: ${finishTxSig} slot ${finishSlot}. Observer poller missed COMPLETED transition due to state-enum bug (fixed). Job completed on-chain; collector recorded timeout.`,
    };

    console.log('\nRecovered receipt:');
    console.log(JSON.stringify(receipt, null, 2));
  } catch (e: any) {
    console.error('IPFS fetch failed:', e.message);
  }
} else if (!ipfsCid) {
  console.log('\nCould not extract IPFS CID from transaction data.');
  console.log('Manual inspection needed — check the signatures above.');
} else {
  console.log('\nNo wallet set — skipping IPFS fetch. Set NOSANA_WALLET_PRIVATE_KEY.');
}
