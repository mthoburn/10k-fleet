/**
 * Look up which job pubkeys are associated with a list of tx signatures.
 */
import { Connection } from '@solana/web3.js';

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const NOSANA_JOBS_PROGRAM = 'nosJhNRqr2bc9g1nfGDcXXTXvYUmxD4cVwy2pMWhrYM';

const SIG = process.env['SIG'] ?? '';
if (!SIG) { console.error('set SIG env var'); process.exit(1); }

const connection = new Connection(RPC_URL, 'confirmed');
const tx = await connection.getParsedTransaction(SIG, { maxSupportedTransactionVersion: 0 });
if (!tx) { console.error('tx not found'); process.exit(1); }

const accounts = tx.transaction.message.accountKeys.map(k => k.pubkey.toString());
console.log('accounts:', accounts);

const ixs = tx.transaction.message.instructions;
for (const ix of ixs) {
  if ('programId' in ix && ix.programId.toString() === NOSANA_JOBS_PROGRAM) {
    console.log('Nosana ix accounts:', 'accounts' in ix ? (ix as any).accounts?.map((k: any) => k.toString()) : []);
  }
}
