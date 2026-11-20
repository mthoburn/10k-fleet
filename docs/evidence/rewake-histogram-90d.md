# 90-day re-wake histogram

*Census data powered by Etherscan.*

- Window: `2026-08-22T00:04:28Z` → `2026-11-20T00:04:28Z` (90 days to script-run time).
- Dormant fleet pin: `docs/evidence/dormant-fleet-usdt-enriched.json` (sha256 `bcd1edb34c4d5e43ac1a635f92a39d45fc17ce7aca7d7859b6fb5fef3c7038d7`).
- Chains: ETH USDT + Tron USDT. Events: `RemovedBlackList`, `DestroyedBlackFunds`.

## Headline — P(≥1 re-wake in a random window)

| Chain | Scope | 24 h | 48 h | 72 h | 7 d |
|---|---|---:|---:|---:|---:|
| ETH USDT | total | 15.7% | 31.4% | 43.3% | 80.1% |
| ETH USDT | dormant fleet | 15.7% | 31.4% | 43.3% | 80.1% |
| Tron USDT | total | 38.3% | 64.6% | 80.0% | 100.0% |
| Tron USDT | dormant fleet | 21.4% | 42.4% | 56.1% | 87.7% |
| Combined | total | 39.4% | 66.9% | 82.3% | 100.0% |
| Combined | dormant fleet | 22.5% | 44.7% | 58.5% | 90.2% |

## Per-event cadence

| Chain | Event | Count | Distinct days | Longest dry gap (days) |
|---|---|---:|---:|---:|
| ETH USDT | RemovedBlackList | 0 | 0 | 91 |
| ETH USDT | DestroyedBlackFunds | 38 | 14 | 11 |
| ETH USDT | Either | 38 | 14 | 11 |
| Tron USDT | RemovedBlackList | 44 | 21 | 25 |
| Tron USDT | DestroyedBlackFunds | 142 | 19 | 11 |
| Tron USDT | Either | 186 | 35 | 7 |

## Dormant-fleet-restricted cadence (same table, joined on wallet)

| Chain | Event | Count (fleet) | Distinct days | Longest dry gap (days) |
|---|---|---:|---:|---:|
| ETH USDT | RemovedBlackList | 0 | 0 | 91 |
| ETH USDT | DestroyedBlackFunds | 38 | 14 | 11 |
| ETH USDT | Either | 38 | 14 | 11 |
| Tron USDT | RemovedBlackList | 0 | 0 | 91 |
| Tron USDT | DestroyedBlackFunds | 142 | 19 | 11 |
| Tron USDT | Either | 142 | 19 | 11 |

## Budget used

- Etherscan V2 calls: **4** (rate: ≤ 1 call / 2 s)
- TronGrid calls:     **2** (rate: ≤ 2 calls / s)
- $0, read-only. Keys loaded from `~/keys/api-keys.txt`, never printed.
