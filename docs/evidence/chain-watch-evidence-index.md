# Chain-watch: evidence index

Single source for every chain-watch figure cited outside this repo. Cite this file; don't restate numbers from memory. As of 17 Nov 2026.

## What it is

A second 10k fleet, outside Eden, run against live third-party on-chain data: stablecoin freezes on Ethereum and Tron. It is the first non-Eden operator of the coordinator.

## The claim

10k can hold a fleet of dormant agent-twins, one per frozen wallet, at almost no cost, and wake exactly the twin a new on-chain event concerns. In the proof run, that twin's assessment ran on a Nosana job that anyone can verify on Solana mainnet.

## Pillar A: scale and demand (census, keyed direct queries)

| Figure | Value | Definition |
| --- | --- | --- |
| Live-frozen wallets, each a potential dormant twin | **12,732** | Distinct addresses with an active blacklist state across the 7 account-level stablecoin contracts (ETH USDT, ETH USDC, BUSD, USDP, TUSD, Tron USDT, Tron USDC). Raw census 12,757; 25 near-zero issuer sentinel / test addresses excluded per the rule in `docs/watchlist-audit.md` §3. |
| **N — new freezes, headline** | **434 events / 433 distinct accounts** | Freeze-add events in the 30-day window ending 2026-11-16 UTC across **six** account-level stablecoin contracts (ETH USDT, ETH USDC, BUSD, USDP, TUSD, Tron USDT). Excludes Tron USDC (issuer attestation unconfirmed — see §7 and RETRY-1 of `docs/watchlist-audit.md`). |
| N — cross-check with Tron USDC included | 519 events / 518 distinct accounts | Same window, **seven** account-level contracts (adds Tron USDC, `legacy, ABI-verified, issuer-unconfirmed`). Use only alongside the headline with that footnote. |
| New freezes per day | **≈ 14.5 / day** | 434 ÷ 30 on the headline definition. The cross-check 519 figure is NOT safe to divide by 30: 71 of the 85 Tron USDC adds in the window fired in a single batch on 2026-11-02 (see §Rate note below). |
| Oldest live freeze | 9 June 2018 | Ethereum, block 5,758,962, an ordinary user address (not a contract or test address). Span 2018-06-09 to 2026-11-16. Say "frozen as far back as June 2018". |
| Registered fleet, Phase 2 (live catch) | 11,081 | 2,851 Ethereum USDT + 8,230 Tron USDT; reconciled exactly (11,081 resolved, 0 unresolved), every row with its freeze transaction, block and timestamp. A subset of the 12,732 census (USDT on Ethereum and Tron only). |

Sources: `docs/watchlist-audit.md`, `docs/evidence/watchlist-30d-counts.json`, `docs/evidence/dormant-sample-500*.json`.

Census data powered by Etherscan (free-tier attribution requirement: carry this credit wherever these figures appear).

### Reconciliation — the earlier 400 figure

An earlier Issue C probe reported **N = 400 events** (fallback 347 without Tron USDC). That probe covered only **4 contracts** (USDT and USDC on both chains) AND used incomplete Tron pagination that stopped at the first empty response (the Tron USDT 30d subset returned 237 there vs the full 308 recovered by the fingerprint-walked census). Both effects run in the same direction; **the 400/347 figure is retracted as an undercount** (see `docs/watchlist-audit.md` §3 "Reconciliation of the earlier 237 → 308 figure" and RETRY-2). The headline N (434/433) is derived from the same evidence file on the broader 6-contract set with full pagination.

### Rate note — single-batch warning

A per-day freeze rate is only honest on the headline definition (434/30 ≈ 14.5/day). The 519 cross-check cannot be divided to a per-day figure: 71 of the 85 Tron USDC adds in the 30-day window fired in a **single batch on 2026-11-02** (8 on 10-28, 6 on 11-07, 0 on every other day). Report the Tron USDC leg as a batch event, not a cadence.

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
- Fleet size: Phase 1 = "1 of 501 registered twins"; Phase 2 = "1 of 11,081 registered". The census (12,732) is wallets that could each have a twin. Never "holds 12,732 agents".
- Rate: "**434 in 30 days, about 14.5 a day**" (headline). Never divide 519 by 30 — 71 of its 85 Tron USDC events were a single 2026-11-02 batch.
- Scope words: the headline covers **six** account-level contracts (USDT, USDC, BUSD, USDP, TUSD on ETH + USDT on Tron). The 519 cross-check adds Tron USDC. Say "six account-level stablecoin contracts" not "all contracts" unless the sentence is quoting 519.
- USD: always with its NOS price date.
- Credit: "Census data powered by Etherscan".

## Addendum — Binance-hack cross-check (29–30 Oct 2026)

Read-only cross-check against Tether's 29 Oct 2026 press release reporting freezes linked to the Binance hack. Raw rows: `docs/evidence/binance-xref-29oct2026.json`. Census data powered by Etherscan.

**Match is by date and chain only.** Tether's release does not list addresses; we cannot say which wallets are "the hack wallets". The rows below are all USDT freezes in the window — a superset of any hack-related subset.

### 1. How many USDT freezes in the window?

- ETH USDT: 11 `AddedBlackList` events.
- Tron USDT: 75 `AddedBlackList` events.
- Combined: 86 across 29–30 Oct 2026 UTC.

### 2. How much frozen value is that?

**ETH USDT only — a lower bound.** Sum of `balanceOf(wallet, tag=hex(freeze_block))` across the 11 ETH USDT rows: ≈ **1,382,022,670 USDT (~$1.38B)**. This is the ETH-leg sum of frozen USDT balances in the 29–30 Oct window; it does **not** include the 75 Tron USDT freezes, whose archive-state `balanceOf` is unavailable on free-tier TronGrid and is recorded as a per-row data gap. The $1.38B figure is therefore a lower bound on the window's total frozen USDT and is a superset of (but not limited to) the funds Tether reports freezing from the Binance hack. Comparison to the ~$1.5B headline must account for the missing Tron leg.

### 3. Do these wallets match our fleet?

- Phase-2 fleet (11,081 twins, `docs/evidence/dormant-fleet-usdt-enriched.json`): 84 of 86 rows matched (**97.7 %**), 11/11 ETH + 73/75 Tron. The two Tron misses are likely post-Phase-2-cutoff adds (Phase 2 enrichment predates the window).
- Census-seedable set (non-sentinel `currently_frozen`, `docs/evidence/watchlist-30d-counts.json`; 11,484 distinct wallets across 7 contracts, 12,732 counting cross-contract duplicates): same 84/86 match.
- No sentinel (`address[2:22] == "0"*20`) rows observed in the window.

### 4. Post-freeze wake activity since 29 Oct

Scanning `DestroyedBlackFunds` + `RemovedBlackList` on the same contracts from each freeze block forward to head: **2 wake hits**, both Tron `RemovedBlackList` (unfreeze reversals), no `DestroyedBlackFunds`. Each would have woken exactly 1 twin in the Phase-2 fleet.

### 5. Clustering vs the 30-day baseline (~15 USDT freezes/day combined)

24-hour buckets, UTC, ETH+Tron combined:

| Date | Freezes |
|---|---|
| 2026-10-27 | 5 |
| 2026-10-28 | 39 |
| 2026-10-29 | 21 |
| 2026-10-30 | 65 |
| 2026-11-01 | 2 |

The 28–30 Oct window runs ~2–4× the ~15/day baseline, with the largest bucket on 30 Oct — consistent with Tether announcing freezes on 29 Oct and continuing the action into the following day. Times and counts only; no address lists.

### Scope and disclaimers

- Chains: ETH USDT and Tron USDT only (Tether's release is USDT-specific; other stablecoins out of scope).
- Decoders pinned in `docs/evidence/decode-fixtures.json`.
- Historical balance on ETH used `proxy/eth_call balanceOf(wallet)` with `tag=hex(freeze_block)` after a one-call pre-flight test passed; Tron archive state is unavailable on the free tier and is reported as a per-row data gap.
- Budget: 18 Etherscan V2 calls + 3 TronGrid calls (ceilings 200 / 20).

## Where to look

- Census, audit and the test-address rule: `docs/watchlist-audit.md`, `docs/evidence/`
- Case 1 receipt and reconciliation: PR #28
- Operator API contract: edenbotanical `docs/coordinator/operator-api-v0.md` (#652, #668)
- Lane history: edenbotanical issue #648
