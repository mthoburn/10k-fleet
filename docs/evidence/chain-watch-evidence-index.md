# Chain-watch: evidence index

Single source for every chain-watch figure cited outside this repo. Cite this file; don't restate numbers from memory. As of 17 Nov 2026.

## What it is

A second 10k fleet, outside Eden, run against live third-party on-chain data: stablecoin freezes on Ethereum and Tron. It is the first non-Eden operator of the coordinator.

## The claim

10k can hold a fleet of dormant agent-twins, one per frozen wallet, at almost no cost, and wake exactly the twin a new on-chain event concerns. In the proof run, that twin's assessment ran on a Nosana job that anyone can verify on Solana mainnet.

## Pillar A: scale and demand (census, keyed direct queries)

| Figure | Value | Note |
| --- | --- | --- |
| Live-frozen wallets, each a potential dormant twin | 12,732 | Across 7 account-level stablecoin contracts (Ethereum and Tron USDT and USDC, BUSD, USDP). Raw census 12,757; 25 near-zero issuer test addresses excluded, rule in `docs/watchlist-audit.md`. |
| Freezes in the last 30 days (headline) | 434 | Freeze events emitted by the issuers' own contracts. |
| Freezes in the last 30 days, all contracts | 519 | Includes a legacy Tron USDC contract whose issuer attestation is pending. Use only with that footnote. |
| New freezes per day | about 15 | 434 / 30. (About 17 a day matches the 519 figure, so use it only alongside 519.) |
| Oldest live freeze | 2020 | |

Sources: `docs/watchlist-audit.md`, `docs/evidence/watchlist-30d-counts.json`, `docs/evidence/dormant-sample-500*.json`.

Census data powered by Etherscan (free-tier attribution requirement: carry this credit wherever these figures appear).

## Pillar B: the loop works, verifiably (Case 1)

- **Fleet in the proof run:** 501 registered twins, one per frozen wallet (`docs/evidence/chain-watch-case1-input.json`). The full fleet would be 12,732.
- **Event:** a real historical on-chain event, **replayed**. The log shows `DestroyedBlackFunds` naming a wallet that had been frozen since 16 May 2024, 886 days before the event (19 Oct 2026).
- **Wake:** exactly 1 of the 501 twins woke. There was no fan-out.
- **Assessment:** one Nosana job (vLLM, Llama 3.1 8B).
- **Cost:** reconciled on chain. Deposit 0.505800 NOS, refund 0.357994 NOS, **net 0.147806 NOS**, about $0.06 at the 11 Nov NOS price. The vault closes to zero, and the poster wallet's balance change matches exactly.
- **Why the cost is per job:** this was a single-wake job, so the whole job's start-up cost fell on one assessment. Batching spreads that cost across many wakes; for comparison, the 12 Nov capstone ran 190 Readings in one job for 0.0634 NOS.

Verify on Solana mainnet:

- Post transaction: https://explorer.solana.com/tx/5GHBgaQCTDDPoDA5Du7SCAE1Crv3oxVFyRtqJpTbW3SK3NfXbQbhHkSQK68RDtbWXfXZa6VFpoPY8L8W7b26ePjt (Success, Finalized; the job account is owned by the Nosana program)
- Job account: https://explorer.solana.com/address/GYxWJKo86rXAuTHiJ6sV4bA7huYXzPHUfHnAtiisEorh
- End transaction: https://explorer.solana.com/tx/2iy71Q9SpLzLJ9xB9uedUgM2z5svQPFxDwRVVjPt54srZFspw2mvTzH8Ttw3pVN79gZjgY54tZyogfDB6y7mo1X9

Don't use the Nosana explorer's `/jobs/` URL as the verification link: it doesn't render ended jobs.

Receipt JSON and on-chain reconciliation: PR #28 (`case1-chain-watch-record`).

## What it proves, and what it doesn't

**Proves:**
- Scale: a census of 12,732 live-frozen wallets.
- Selective wake: 1 of 501 twins.
- Real Nosana compute demand: a verifiable job.
- The cost model: dormant twins cost almost nothing, and you pay only for the ones that wake.

**Doesn't yet prove:**
- Live detection. Case 1 replayed a historical event, and its receipt says so. Live detection on new events is next.
- That the full 12,732 run. Only 501 twins were registered in the proof run.
- That the twin itself slept for 886 days. The 886 days is how long the *wallet* had been frozen. The twin was registered for the proof run.

## How to cite these figures

- Say "ran on a verifiable Nosana job, posting transaction on Solana mainnet". Never say "proof of computation": the record proves which job served the inference, not that the computation was correct.
- Dormancy: "a wallet frozen 886 days earlier". Never "a twin asleep 886 days", and never "a six-year fleet" (the sample is weighted to 2025–26).
- Wallets: neutral wording only, such as "the log shows DestroyedBlackFunds naming <wallet>". Never an accusation.
- Fleet size: "1 of 501 registered twins woke; the full fleet would be 12,732". Never "holds 12,732 agents" until it does.
- Rate: "434 in 30 days, about 15 a day".
- USD: always with its NOS price date.
- Credit: "Census data powered by Etherscan".

## Where to look

- Census, audit and the test-address rule: `docs/watchlist-audit.md`, `docs/evidence/`
- Case 1 receipt and reconciliation: PR #28
- Operator API contract: edenbotanical `docs/coordinator/operator-api-v0.md` (#652, #668)
- Lane history: edenbotanical issue #648
