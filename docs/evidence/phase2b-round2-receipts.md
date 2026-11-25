# Phase 2b — round 2 receipts

Chain-watch live round 2, 20–23 November 2026. Three 24-hour slots, one batch
Nosana job per day, against the 11,081-twin dormant USDT fleet (ETH + Tron).
Source of truth: the per-job reconciliation posted on edenbotanical #648
(comment 7168113953) and the independent on-chain re-wake verification in
[`r2-rewakes-verification.md`](r2-rewakes-verification.md).
Census data powered by Etherscan.

## Window and configuration

- Window: **2026-11-20T22:34:41Z → 2026-11-23T22:35:45Z** (3 × 24 h).
- Scheme: one batch Nosana job per day (Mark's Option A).
- Market: `Dcwz62TisNbWuto6KJM2EGYGVKnHbdZGVGmgLASzsXy8`.
- Image: `eden-oneshot-llm@sha256:976a320a…5c0a`.
- Poster wallet: `CXx2eZ5SGDRGqmKkDBrgDqCp29kVssdgKnUBhR3QzCAg`.
- Dormant fleet pin: `docs/evidence/dormant-fleet-usdt-enriched.json`, SHA-256 `bcd1edb34c4d5e43ac1a635f92a39d45fc17ce7aca7d7859b6fb5fef3c7038d7` (11,081 rows).

## Batches

| day | items | job account | post tx | post time (UTC) |
|---|---:|---|---|---|
| 1 | 11 | `EnNb97z2BwK9VqshukmPfAxRZXQyFBqweDze9XW8EPyS` | `21LZLK7w4u…c1TUD26` | 2026-11-22T14:14:32Z |
| 2 |  3 | `B6mBjY8YuXVYQDcDe9SXNDnXNCdDFdDTmvm5YQtCRCHK` | `3Yj2NESZ8S…bsbcd`  | 2026-11-22T22:35:14Z |
| 3 | 28 | `CfVxbNeBiEdw1dAKCdRpKLRdu62sVxtRwhkzhttQYg1a` | `pjG7vQPezH…YdsAc` | 2026-11-23T22:35:49Z |

Each day is three signatures on the poster wallet: **post → finish (~60–90 s)
→ close/rent-reclaim (~1 h)**. All nine transactions `err = OK`. Full tx
hashes and per-leg balance deltas are in the #648 reconciliation.

Note on day 1: two pre-post failures occurred before edenbotanical #744 landed;
no spend resulted, and both are excluded from the receipts above.

## Re-wakes (6 of 11,081)

Six dormant twins woke across the three days, each triggered by a `DestroyedBlackFunds`
or `RemovedBlackList` event on a wallet that matched the pinned fleet. All six
transactions, events, affected wallets, and freeze histories are independently
verified on chain (`r2-rewakes-verification.md` for the five
`DestroyedBlackFunds`; #648 §4 for the day-3 `RemovedBlackList`).

| # | Chain | Event | On-chain tx | Block | Block time (UTC) | Wallet | Frozen at |
|---|---|---|---|---:|---|---|---|
| 1 | Tron | `DestroyedBlackFunds` | `ad05b5e2…cd2fb` | 88,203,147 | 2026-11-21T17:52:42Z | `TJ8tvVij…Zv63p` | 2026-06-11T20:43:00Z |
| 2 | ETH  | `DestroyedBlackFunds` | `0x9f7d956f…ec80a` | 26,465,143 | 2026-11-21T18:02:47Z | `0xf322a332…5e97e` | 2025-02-12T15:52:47Z |
| 3 | ETH  | `DestroyedBlackFunds` | `0x26a26b8d…f2555` | 26,465,143 | 2026-11-21T18:02:47Z | `0x89cf540a…f1da5` | 2024-10-22T14:49:47Z |
| 4 | ETH  | `DestroyedBlackFunds` | `0xf799d4e2…f6748` | 26,465,143 | 2026-11-21T18:02:47Z | `0xe3d11143…15e14` | 2024-12-20T02:25:11Z |
| 5 | ETH  | `DestroyedBlackFunds` | `0x78a90586…d3583` | 26,465,143 | 2026-11-21T18:02:47Z | `0xca44101a…0a4db` | 2025-01-07T17:06:23Z |
| 6 | Tron | `RemovedBlackList`    | `8ece0aae…6cdb2` | 88,257,564 | 2026-11-23T15:14:21Z | `0xfd6bacbb…e1a20` (`TZ5Awxri…Sg9GXe`) | 2026-08-27T16:57:54Z (dormant ≈ 88 d) |

Each wake-up produced one receipt line in its day's Nosana job. All six twins
were present in the SHA-256-pinned dormant fleet. **Woke 6 of 11,081 dormant
twins.**

## Cost reconciliation (from #648)

Row-wise sums of the nine per-tx deltas equal the wallet delta exactly (no
unaccounted transactions on `CXx2eZ5…` in the window).

| day | items | deposit (NOS) | refund (NOS) | net (NOS) | net (SOL, fees) |
|---|---:|---:|---:|---:|---:|
| 1 | 11 | −0.5652 | +0.543534 | **−0.021666** | −0.00001703 |
| 2 |  3 | −0.5886 | +0.583368 | **−0.005232** | −0.00001703 |
| 3 | 28 | −0.5562 | +0.527772 | **−0.028428** | −0.00001703 |
|   | **42** | **−1.7100** | **+1.654674** | **−0.055326** | **−0.00005109** |

Independent wallet-balance check (chain):

| metric | before day 1 post | after day 3 close | delta |
|---|---|---|---|
| SOL | 0.056339192 | 0.056288102 | **−0.00005109** (= 3 × fee) |
| NOS | 13.892445   | 13.837119   | **−0.055326** |

The −0.055326 NOS total funded **42 verifiable Nosana job receipts**, six of
them produced by a dormant twin waking on a real `DestroyedBlackFunds` or
`RemovedBlackList` event.

## Known gap

One transient Ethereum poll error at **2026-11-23T20:20Z**, recovered on the
next poll. Nothing processed during the error; nothing missed. Reported here so
the window is complete.

The round-1 100-minute detector gap (2026-11-20T22:21:47Z → 2026-11-21T00:01:23Z)
belongs to round 1 and is recorded in `phase2b-round1-receipts.md`.

## Wording for citation

- "Detected in real time … ran on a verifiable Nosana job — posting transaction on Solana mainnet." Never "proof of computation".
- "**Woke 6 of 11,081 dormant twins**" is accurate because all six re-wakes are independently verified on chain.
- The dormancy numbers are properties of **the frozen wallet**, not the twin itself; the twin was registered when the fleet was seeded.
- 0.5B model receipt text is vague in places; the claim is the verifiable compute, not the note text.

Census data powered by Etherscan.
