# R2 RE-WAKES — INDEPENDENT VERIFICATION

*Census data powered by Etherscan.*

- Generated: 2026-11-22 (revision v2 — corrects two errors in v1; see below)
- Enriched census: `docs/evidence/dormant-fleet-usdt-enriched.json`
- Enriched census sha256: `bcd1edb34c4d5e43ac1a635f92a39d45fc17ce7aca7d7859b6fb5fef3c7038d7` (verified before use)
- Enriched census generated at: 2026-11-17T19:53:54Z
- Ledger input (read-only): `~/eden-local/phase2b-r2/day1/state.json.ledger.jsonl`
- Chain reads: Etherscan v2 (chainid=1, ≤ 1 call / 2s), TronGrid (≤ 2 / s). Nothing paid.

## Corrections from v1

1. **ETH block timestamp.** v1 used the wrong hex tag (`0x19388f7` = block 26,444,023) when calling `eth_getBlockByNumber`, which returned 2026-11-19T02:14:47Z — the time of a different block, not 26,465,143. The correct hex tag for 26,465,143 is **`0x193d377`**; refetching returns timestamp **1795284167 = 2026-11-21T18:02:47Z**, consistent with the detector observing these events at ~18:03Z. All 4 ETH dormancy figures have been recomputed from the corrected time.
2. **Tron wallet census lookup.** v1 reported `TJ8tvVijjKrxdnKQWaivnLLNPXnuMZv63p` as absent from the census. That was a search bug on my end, not a detector or census bug. Tron rows in `dormant-fleet-usdt-enriched.json` store the 0x-hex form of the address in `address` and the base58 form in a separate `tron_base58` field; v1 only compared the base58 string against `address`. An exhaustive search across all string fields in every form (base58 / `0x…` / `41…`, case-insensitive) finds the wallet at **row 5777**, matching both `address = 0x5996131728b1d8944bdfbf9c0ede43c2d4370093` and `tron_base58 = TJ8tvVijjKrxdnKQWaivnLLNPXnuMZv63p`. Original freeze: **2026-06-11T20:43:00Z**; dormancy: **162.88 d**. The detector's `in_fleet=true` was correct.

## Method

For each of the 5 round-2 re-wake transactions, the receipt was fetched fresh from the chain and the USDT `DestroyedBlackFunds` log was decoded independently (topic0 = `0x61e6e66b…698c6`). Confirmed: contract address, event, affected wallet, amount destroyed, block, and block-time. The wallet was then looked up in the enriched census (exhaustive form/field search) to obtain the original freeze time and dormancy.

Event shape note: on ETH USDT, `DestroyedBlackFunds(address, uint)` is **non-indexed** (wallet and amount both in `data`). On Tron USDT (same contract, different compilation), the wallet is **indexed** in `topics[1]`. Both shapes were decoded accordingly.

## Table

| # | Chain | Tx | Block | Block time (UTC) | Wallet | Amount destroyed (USDT) | In census? | Original freeze | Dormancy |
|---|-------|----|------:|------------------|--------|------------------------:|:----------:|-----------------|---------:|
| 1 | ETH   | `0x9f7d…c80a` | 26465143 | 2026-11-21 18:02:47 | `0xf322a332…5e97e` |   2,117,677.970136 | ✓ | 2025-02-12 15:52:47 | 647.09 d |
| 2 | ETH   | `0x26a2…2555` | 26465143 | 2026-11-21 18:02:47 | `0x89cf540a…f1da5` |   4,242,287.280000 | ✓ | 2024-10-22 14:49:47 | 760.13 d |
| 3 | ETH   | `0xf799…6748` | 26465143 | 2026-11-21 18:02:47 | `0xe3d11143…15e14` |   5,680,262.520000 | ✓ | 2024-12-20 02:25:11 | 701.65 d |
| 4 | ETH   | `0x78a9…3583` | 26465143 | 2026-11-21 18:02:47 | `0xca44101a…0a4db` |     482,357.071069 | ✓ | 2025-01-07 17:06:23 | 683.04 d |
| 5 | TRX   | `ad05…d2fb` | 88203147 | 2026-11-21 17:52:42 | `TJ8tvVij…v63p`    |     277,406.754110 | ✓ | 2026-06-11 20:43:00 | 162.88 d |

**ETH subtotal:** 12,522,584.841205 USDT · **TRX subtotal:** 277,406.754110 USDT · **Total:** 12,799,991.595315 USDT

All five events verified on-chain: contract matches USDT (`0xdac17f95…1ec7` on ETH; `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` / `41a614f8…d13c` on Tron), event is `DestroyedBlackFunds`, block numbers match the ledger, wallets match, amounts decoded cleanly, receipt status = success. Ledger `log_index` values for the 4 ETH events (14, 17, 20, 23) match the on-chain receipt indices exactly. All 5 wallets found in the enriched census (sha256-verified).

## Mismatches

None.
