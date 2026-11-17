# Case-1 chain-watch — cost reconciliation

Run: 17 Nov 2026, ~13:35 ET. Reviewer: chain-watch (old sup terminal).
Printed line: `case1: woke 1 of 501 | registered=501 wake_decisions=1 jobs=1 spend_usd=0.000157`.

Coordinator `spend_usd = 0.000157` is an internal counter. The authoritative cost is
the on-chain NOS net below.

## Nosana job

| field | value |
| --- | --- |
| job_address | `GYxWJKo86rXAuTHiJ6sV4bA7huYXzPHUfHnAtiisEorh` |
| market_address | `Dcwz62TisNbWuto6KJM2EGYGVKnHbdZGVGmgLASzsXy8` |
| service_url_host | `55fe7fvawrkwwzbshrxfq5ybaxym2nyiypbftuxada9q.node.k8s.prd.nos.ci` |
| post_tx | `5GHBgaQCTDDPoDA5Du7SCAE1Crv3oxVFyRtqJpTbW3SK3NfXbQbhHkSQK68RDtbWXfXZa6VFpoPY8L8W7b26ePjt` |
| end_tx | `2iy71Q9SpLzLJ9xB9uedUgM2z5svQPFxDwRVVjPt54srZFspw2mvTzH8Ttw3pVN79gZjgY54tZyogfDB6y7mo1X9` |
| explorer_job_url | https://explorer.nosana.io/jobs/GYxWJKo86rXAuTHiJ6sV4bA7huYXzPHUfHnAtiisEorh (secondary; Nosana explorer does not resolve Ended jobs at this path) |

Receipt's `nosana` block matches the posted job (`job_address` and `post_tx` identical).

## Verifiable pointers (headline)

The Nosana explorer `/jobs/` route does not resolve for Ended jobs — expected, not
a failure. The headline verification is the Solana mainnet tx + job account, both
permanent:

- Post tx (Solana):
  - https://explorer.solana.com/tx/5GHBgaQCTDDPoDA5Du7SCAE1Crv3oxVFyRtqJpTbW3SK3NfXbQbhHkSQK68RDtbWXfXZa6VFpoPY8L8W7b26ePjt
  - https://solscan.io/tx/5GHBgaQCTDDPoDA5Du7SCAE1Crv3oxVFyRtqJpTbW3SK3NfXbQbhHkSQK68RDtbWXfXZa6VFpoPY8L8W7b26ePjt
- Job account (Solana):
  - https://explorer.solana.com/address/GYxWJKo86rXAuTHiJ6sV4bA7huYXzPHUfHnAtiisEorh
  - https://solscan.io/account/GYxWJKo86rXAuTHiJ6sV4bA7huYXzPHUfHnAtiisEorh
- End tx (Solana):
  - https://explorer.solana.com/tx/2iy71Q9SpLzLJ9xB9uedUgM2z5svQPFxDwRVVjPt54srZFspw2mvTzH8Ttw3pVN79gZjgY54tZyogfDB6y7mo1X9

The receipt's `explorer_job_url` is retained as a cosmetic/secondary field. The
authoritative reviewer checks are `post_tx` and `job_address` against Solana.

Grant/writeup copy: "ran on a verifiable Nosana job — posting transaction on Solana
mainnet", linking the Solana tx. Never "proof of computation".

## Wallets and accounts

- Poster wallet (SOL fee payer, NOS owner): `CXx2eZ5SGDRGqmKkDBrgDqCp29kVssdgKnUBhR3QzCAg`
- Poster NOS ATA: `4RtTusPLekRkdZpKVnX7LXjt9a1dFSJKDogrSUPJ7mQp`
- Market/job vault NOS acct: `6M5REuhLJatxxCdWD6ZfeLC7wyncSUAC9Q5sSKxTUJsK`
- Node payout NOS acct: `7LHibyXvYAfiskLgxuEtfnrLSe6nMHEKaA9KeZ87bQh8` (owner `5Pd2h6ioc1vWa6tQzm2AcZfmSBQ6oJK1KZq6nCQpTPmS`)
- NOS mint: `nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7`
- Nosana program: `nosJhNRqr2bc9g1nfGDcXXTXvYUmxD4cVwy2pMWhrYM`

## NOS reconciliation (authoritative)

Verified by `getTransaction … jsonParsed` against Solana mainnet-beta RPC; token
balance deltas confirmed against the Nosana program's token accounts.

| leg | tx | poster NOS Δ | vault NOS Δ | node NOS Δ |
| --- | --- | --- | --- | --- |
| Post (deposit) | `5GHBga…ePjt` | 4.122581 → 3.616781 (−0.505800) | 359.360052 → 359.865852 (+0.505800) | — |
| End (refund + payout) | `2iy71Q…1X9` | 3.616781 → 3.974775 (+0.357994) | 359.865852 → 359.360052 (−0.505800) | 523.860389 → 524.008195 (+0.147806) |

- NOS deposited: **0.505800**
- NOS refunded to poster: **0.357994**
- NOS paid to node: **0.147806**
- **Net NOS cost = 0.505800 − 0.357994 = 0.147806 NOS** (equals node payout — vault closes to zero delta)
- Pre-go poster NOS: 4.122581 → post-End: 3.974775 (Δ −0.147806) ✓

## SOL reconciliation

- Post-tx fee: 15,000 lamports
- End-tx fee: 5,000 lamports
- Fee sum: **20,000 lamports (0.00002 SOL)**
- Observed poster SOL: 0.00828 → 0.00639 (Δ −0.00189 SOL). Residual ≈ 0.00187 SOL
  reflects rent-exempt balances held by job-adjacent accounts (job account still
  carries 1,869,440 lamports at End; owned by Nosana program).

## Stop-condition checks

1. Receipt carries required `nosana` block keys. ✓
2. `job_address` matches posted job. ✓
3. `post_tx` matches posted job. ✓
4. On-chain `End` instruction succeeded (Nosana program log `Instruction: End`, no err). ✓
