/**
 * Pull exact NOS balance changes for the wallet's Associated Token Account.
 * Unlike wallet-tx-history.ts (which tracked ANY NOS account in each tx),
 * this script derives the wallet's ATA and queries changes there specifically.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Client } from '@nosana/sdk';

const RPC_URL  = 'https://api.mainnet-beta.solana.com';
const NOS_MINT = new PublicKey('nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7');
const WALLET   = (process.env['NOSANA_WALLET_PRIVATE_KEY'] ?? '').trim();

const client     = new Client('mainnet', WALLET as never);
const connection = new Connection(RPC_URL, 'confirmed');

const walletPk = client.solana.wallet.publicKey;
const ata      = getAssociatedTokenAddressSync(NOS_MINT, walletPk);
console.log('wallet:', walletPk.toString());
console.log('NOS ATA:', ata.toString());

// Current balance
const bal = await connection.getTokenAccountBalance(ata);
console.log('current NOS balance:', bal.value.uiAmount, 'NOS  (raw:', bal.value.amount, ')');

// All signatures for this ATA
const sigs = await connection.getSignaturesForAddress(ata, { limit: 50 });
console.log(`\nFound ${sigs.length} ATA signatures (most recent first):`);

let runningBalance: number | null = null;

for (const sigInfo of sigs) {
  const tx = await connection.getParsedTransaction(sigInfo.signature, {
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) continue;

  // Find this ATA's account index in the tx message
  const accounts = tx.transaction.message.accountKeys;
  const ataIndex = accounts.findIndex(a => a.pubkey.toString() === ata.toString());

  const pre  = tx.meta?.preTokenBalances?.find(b => b.accountIndex === ataIndex);
  const post = tx.meta?.postTokenBalances?.find(b => b.accountIndex === ataIndex);

  const preAmt  = pre?.uiTokenAmount.uiAmount   ?? null;
  const postAmt = post?.uiTokenAmount.uiAmount  ?? null;
  const preRaw  = Number(pre?.uiTokenAmount.amount  ?? 0);
  const postRaw = Number(post?.uiTokenAmount.amount ?? 0);

  const deltaRaw = (postRaw - preRaw);
  const deltaUi  = deltaRaw / 1_000_000;
  const timeStr  = sigInfo.blockTime
    ? new Date(sigInfo.blockTime * 1000).toISOString()
    : 'unknown';

  const sign = deltaRaw >= 0 ? '+' : '';
  console.log(
    `  ${timeStr}  slot=${sigInfo.slot}  NOS ${sign}${deltaUi.toFixed(6)} (${sign}${deltaRaw} raw)`
    + `  pre=${preRaw} post=${postRaw}`
    + `  tx=${sigInfo.signature.slice(0, 16)}…`,
  );
}
