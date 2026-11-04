/**
 * Print NOS token transaction history for the wallet to reconcile costs.
 * Usage: railway run --service edenbotanical npx tsx scripts/wallet-tx-history.ts
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { Client } from '@nosana/sdk';

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const WALLET  = (process.env['NOSANA_WALLET_PRIVATE_KEY'] ?? '').trim();

const client     = new Client('mainnet', WALLET as never);
const connection = new Connection(RPC_URL, 'confirmed');

// Get wallet pubkey from SDK
const walletPubkey = client.solana.wallet.publicKey;
console.log('wallet:', walletPubkey.toString());

// Get NOS token account balance history via signatures
const sigs = await connection.getSignaturesForAddress(walletPubkey, { limit: 30 });
console.log(`\nFound ${sigs.length} wallet signatures (most recent first):`);

for (const sigInfo of sigs) {
  const tx = await connection.getParsedTransaction(sigInfo.signature, {
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) continue;

  // Look at pre/post token balances to see NOS changes
  const preBalances  = tx.meta?.preTokenBalances  ?? [];
  const postBalances = tx.meta?.postTokenBalances ?? [];

  // Find NOS token (mint: nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7)
  const NOS_MINT = 'nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7';

  let nosChange: number | null = null;
  for (const pre of preBalances) {
    if (pre.mint !== NOS_MINT) continue;
    const post = postBalances.find(p => p.accountIndex === pre.accountIndex);
    if (post) {
      const delta = (post.uiTokenAmount.uiAmount ?? 0) - (pre.uiTokenAmount.uiAmount ?? 0);
      if (Math.abs(delta) > 0.000001) {
        nosChange = delta;
      }
    }
  }

  const timeStr = sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toISOString() : 'unknown';
  if (nosChange !== null) {
    const sign = nosChange > 0 ? '+' : '';
    console.log(`  ${timeStr}  slot=${sigInfo.slot}  NOS ${sign}${nosChange.toFixed(6)}  tx=${sigInfo.signature.slice(0, 20)}...`);
  } else {
    console.log(`  ${timeStr}  slot=${sigInfo.slot}  (no NOS change)  tx=${sigInfo.signature.slice(0, 20)}...`);
  }
}

// Current NOS balance
const nos = await (client.nos as any).balanceOf(walletPubkey);
console.log(`\nCurrent NOS balance: ${nos}`);
