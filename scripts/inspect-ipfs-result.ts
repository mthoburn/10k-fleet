/**
 * Print the full IPFS result for a completed job to understand its structure.
 * Usage: railway run --service edenbotanical -- npx tsx scripts/inspect-ipfs-result.ts
 */
import { Client } from '@nosana/sdk';

const raw = (process.env['NOSANA_WALLET_PRIVATE_KEY'] ?? '').trim();
const CID = process.env['CID'] ?? 'QmXUwGutoSp87XVL8gpg8TksMMXqTGaunzrcH3FAp8b7D7';

const client = new Client('mainnet', raw as never);
const result = await (client.ipfs as any).retrieve(CID);
console.log(JSON.stringify(result, null, 2));
