# Phase 2 run #2 — retrospective shadow log

**RETROSPECTIVE: reconstructed from chain after the window; nothing was processed live (no catch).**
Census data powered by Etherscan.

## Window
- Start: `2026-11-18T18:15:34Z`
- Close: `2026-11-19T18:15:56Z`
- Live detector outcome (edenbotanical #648): no qualifying event; no job posted.

## Method
Audit script: `scripts/wlaudit/phase2_run2_shadow.py`.
Pulls every `AddedBlackList`, `RemovedBlackList`, `DestroyedBlackFunds` event on
ETH USDT (`0xdAC17F958D2ee523a2206206994597C13D831ec7`) and Tron USDT
(`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`) in the exact window, then cross-checks
each wallet against the pinned dormant fleet.

Dormant-fleet pin: `docs/evidence/dormant-fleet-usdt-enriched.json`
SHA-256 `bcd1edb34c4d5e43ac1a635f92a39d45fc17ce7aca7d7859b6fb5fef3c7038d7`
(2,851 ETH wallets + 8,230 Tron wallets, verified at run-time).

ETH block range for window: `26443680..26450861`. ETH finality depth matched
the live detector at 64 blocks; the full qualifying set is checked for any
event inside the last 64 blocks before close.

Rate limits respected per shared-key rule: Etherscan ≤ 1 call / 2 s,
TronGrid ≤ 2 calls / s.

## Qualifying events in window (RemovedBlackList + DestroyedBlackFunds)

| Chain | RemovedBlackList | DestroyedBlackFunds |
|------|---:|---:|
| ETH USDT  | 0 | 0 |
| Tron USDT | 0 | 0 |

**Total qualifying: 0. Detector misses (qualifying event on a pinned dormant wallet): 0.**

This matches the live detector's outcome — no post was warranted.

## Context: AddedBlackList (births) — skipped live as not pre-registered

| Chain | AddedBlackList |
|------|---:|
| ETH USDT  | 10 |
| Tron USDT | 6 |

Not qualifying under the Phase-2 rule set; recorded here so the shadow log is
complete.

## ETH finality flag
No qualifying event; nothing to flag inside the last 64 blocks before close.

## Artefacts
- `docs/evidence/phase2-run2-shadow-log.json` — full per-event payload
- `docs/evidence/phase2-run2-shadow-log.md` — this summary
