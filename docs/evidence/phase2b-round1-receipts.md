# Phase 2b — round 1 receipts

Chain-watch live round 1, 19–20 November 2026. Source of truth: edenbotanical
issue #648 closeout (22:22Z 20 Nov) and VERIFIED mark (22:28Z 20 Nov). On-chain
transaction hashes were refetched from Solana mainnet-beta RPC at write-up time.
Census data powered by Etherscan.

## Window

- Detector start: 2026-11-19T21:30Z (approx.)
- Live run close: 2026-11-20T22:22Z
- Detector gap inside the window: **2026-11-20T22:21:47Z → 2026-11-21T00:01:23Z** (100 minutes). This gap ended the active live window; nothing was processed during it. It is carried as a known gap of round 1.

## Slot A — live catch, posted but never ran

A real USDT `AddedBlackList` event (a new freeze, not a re-wake), detected in
real time on Tron, was turned into a posted Nosana job within the window. The
job **never ran** because the market it landed in was later shown to be gated
(fixed by edenbotanical #733); it is **held on chain unspent** as of this
write-up, so the "ran on a verifiable Nosana job" citation does **not** apply
to slot A. The verifiable-job citation for round 1 is the batch job
`4QAsPc…` below.

| field | value |
|---|---|
| Chain / event | Tron USDT, **`AddedBlackList`** (new freeze; `kind = birth` in the R1 ledger) |
| Tron tx | `acedca63e86867d26a55a7e353e026d503c841d6faae07beb4f98411d2695249` |
| Tron block | 88,149,913 |
| Affected wallet | `THMgyHT9BojxSCy1pgzqod9Nz75k3eUUPS` (hex `0x5109611bb05328b2d37c7d56a2e625c1d794e971`) |
| In pinned dormant fleet? | **No** (`in_fleet = false`). This was a newly frozen wallet; it is not one of the 11,081 pre-registered dormant twins. |
| Detector latency | ~17 s after block time |
| Finalisation | ~51 s after detection |
| Nosana job account | `CKAF4G7ZioeA4UjFTMhfcXUnvkppXLfiGLhQ6BDtxjcg` |
| Post tx (Solana) | `4caeCqkCA6mySzG1aRjqdS7nkrASibE5439GwwsjtnYBeRKZ9K3ABKMr4rP3TgC2C9rYwpf3JCv647KrhFTUhjG9` |
| Post slot / time | 471,487,141 · 2026-11-19T21:31:31Z |
| Market | `3EWVbggirRpDY2npzPDA7k21yzwz5wgwGxVVv6zCnRpa` (gated — see edenbotanical #733) |
| Status | **Posted, never ran.** Account owner is the Nosana jobs program. Lamports locked: 1,869,440 (0.00186944 SOL). Signatures on account: **1 total** (the post). Untouched at round-2 closeout per #648. |

Reported as-is: a verifiable on-chain **post** of the correct detection, in a
market from which the job could not proceed. No assessment was produced.

## Batch — 11 receipts

The other detected events (freezes) in the same window were assessed in the
batch — a single Nosana job that ran to completion. This is the verifiable
Nosana job that carries the round-1 citation.

| field | value |
|---|---|
| Job account | `4QAsPcFAHPPeiFHRcZLNYtetogtL6wiLZe5CbTHQFwNP` |
| Market | `Dcwz62TisNbWuto6KJM2EGYGVKnHbdZGVGmgLASzsXy8` |
| Post tx | `Z4Z4cX45SS4KuZXoZkCCRrGkwPZG4ZyeX5jXkgm35QA7CK4Ey7GB9fSAcqmcP4Eq3AaUZJyYaEhRCVH6LGJywzV` |
| Post slot / time | 471,729,518 · 2026-11-20T14:40:24Z |
| Finish tx | `23mWgU8LhiZgmY6CvY7CxvJYm8UT5ZKYMpX86ds1rQ9AH9nBJQRkDUu58CEo35gBsqduHgUgKXXKmZ5PXxZB2uQ2` |
| Finish slot / time | 471,729,860 · 2026-11-20T14:41:38Z |
| Close tx | `3voYeM6MoC7yosNQeLAcg1uVe3pCzzi721BAcK9riahuJDQzif5vdtoXqXgGmD9AuCh77J24uDRE5zkWoyLjiqQn` |
| Close slot / time | 471,747,562 · 2026-11-20T15:45:03Z |
| Receipts | 11 (0 errors, 0 capped) |
| IPFS result CID | `QmV93Bu4PT7F8HVwzHa9NCx5po2JrzBfoXLBqpp1MHhisK` (stdout verbatim) |

Verify on Solana mainnet:
- Post: <https://explorer.solana.com/tx/Z4Z4cX45SS4KuZXoZkCCRrGkwPZG4ZyeX5jXkgm35QA7CK4Ey7GB9fSAcqmcP4Eq3AaUZJyYaEhRCVH6LGJywzV>
- Job account: <https://explorer.solana.com/address/4QAsPcFAHPPeiFHRcZLNYtetogtL6wiLZe5CbTHQFwNP>
- Finish: <https://explorer.solana.com/tx/23mWgU8LhiZgmY6CvY7CxvJYm8UT5ZKYMpX86ds1rQ9AH9nBJQRkDUu58CEo35gBsqduHgUgKXXKmZ5PXxZB2uQ2>

## Re-wakes

**None in round 1.** Round 1 detected only new-freeze (`AddedBlackList`) activity
within the batched subset. Dormant-twin re-wakes are the round 2 claim; round 1
is reported without a re-wake count to avoid conflating the two.

## Cost reconciliation (round 1 total)

From the #648 closeout: wallet delta −0.028078 NOS, −0.001903 SOL. This is the
end-to-end change on the poster wallet `CXx2eZ5SGDRGqmKkDBrgDqCp29kVssdgKnUBhR3QzCAg`
across the slot-A post and the batch post/finish/close, with the slot-A rent
still locked as noted above.

| item | NOS Δ | SOL Δ |
|---|---:|---:|
| Slot A post (rent locked in `CKAF4G7Z…`) | 0 | −0.00186944 (locked) |
| Batch post/finish/close net | −0.028078 | ~−0.00003 (fees only; rent recovered) |
| **Round 1 total (wallet delta)** | **−0.028078** | **−0.001903** |

The authoritative single-number figures are the wallet delta in the right-hand
column; the per-item split is the closeout's own breakdown and is reproduced
here for narrative clarity, not re-derived from first principles.

## Wording for citation

- "Detected in real time … ran on a verifiable Nosana job — posting transaction on Solana mainnet." Never "proof of computation". **The "ran on a verifiable Nosana job" citation applies to the batch job `4QAsPc…` only; slot A was posted but never ran.**
- Round 1 is **not** phrased as "woke N of 11,081"; slot A was a new freeze on a non-fleet wallet (`in_fleet = false`), and the batch assessed other detected freezes — neither is a dormant-twin re-wake.
- The slot-A assessment notes used a 0.5B model and are vague in places (one receipt uses the word "malicious"). **The claim is the verifiable compute, not the note text.**

Census data powered by Etherscan.
