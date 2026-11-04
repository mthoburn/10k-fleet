/**
 * Check NOS balance and on-chain state of a job.
 * Usage: JOB_ID=<pubkey> railway run --service edenbotanical -- npx tsx scripts/check-wallet.ts
 * Never prints the private key.
 */
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { Client } from '@nosana/sdk';
import bs58 from 'bs58';

const NOS_MINT    = 'nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7';
const RPC         = 'https://api.mainnet-beta.solana.com';
const NOS_DECIMALS = 6;

const raw = (process.env['NOSANA_WALLET_PRIVATE_KEY'] ?? '').trim();
if (!raw) throw new Error('NOSANA_WALLET_PRIVATE_KEY not set');

const bytes = raw.startsWith('[') ? new Uint8Array(JSON.parse(raw)) : bs58.decode(raw);
const kp    = bytes.length === 64 ? Keypair.fromSecretKey(bytes) : Keypair.fromSeed(bytes.slice(0, 32));
const wallet = kp.publicKey;
console.log('wallet:', wallet.toBase58());

// NOS balance
const conn = new Connection(RPC, 'confirmed');
const ata  = await getAssociatedTokenAddress(new PublicKey(NOS_MINT), wallet);
let nosBalance = 0n;
try {
  const acc = await getAccount(conn, ata);
  nosBalance = acc.amount;
  console.log(`NOS balance: ${(Number(nosBalance) / 10 ** NOS_DECIMALS).toFixed(6)} NOS  (raw: ${nosBalance})`);
} catch (e: any) {
  console.log('NOS balance: 0 (no token account yet or error:', e.message, ')');
}

// On-chain state of the timed-out job
const jobId = process.env['JOB_ID'] ?? 'YDcMRyj9hddbucDSErNSyE8n2zC93haKFaTfXs3mSAL';
try {
  const client = new Client('mainnet', raw as never);
  const job = await (client.jobs as any).get(jobId);
  const stateMap: Record<number, string> = { 0:'QUEUED', 1:'RUNNING', 2:'COMPLETED', 3:'STOPPED' };
  const stateName = stateMap[job.state as number] ?? String(job.state);
  console.log(`job ${jobId}  state=${job.state} (${stateName})  price=${job.price ?? 'null'}  node=${job.node ?? 'null'}`);
} catch (e: any) {
  console.log('job fetch error:', e.message);
}
