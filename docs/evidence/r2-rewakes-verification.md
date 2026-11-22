# R2 RE-WAKES — INDEPENDENT VERIFICATION

*Census data powered by Etherscan.*

- Generated: 2026-11-22
- Enriched census: `docs/evidence/dormant-fleet-usdt-enriched.json`
- Enriched census sha256: `bcd1edb34c4d5e43ac1a635f92a39d45fc17ce7aca7d7859b6fb5fef3c7038d7` (verified before use)
- Enriched census generated at: 2026-11-17T19:53:54Z
- Ledger input (read-only): `~/eden-local/phase2b-r2/day1/state.json.ledger.jsonl`
- Chain reads: Etherscan v2 (chainid=1, ≤ 1 call / 2s), TronGrid (≤ 2 / s). Nothing paid.

## Method

For each of the 5 round-2 re-wake transactions in the detector ledger, the transaction receipt was fetched fresh from the chain and the USDT `DestroyedBlackFunds` log was decoded independently (topic0 = `0x61e6e66b…698c6`). Confirmed: the contract address, the event, the affected wallet, the amount destroyed, and the block / block time. The wallet was then looked up in the enriched census to obtain the original freeze time and compute dormancy. Results are reported as-is.

Note on event shape: on ETH USDT, `DestroyedBlackFunds(address, uint)` is **non-indexed**, so both the wallet and the amount are in `data`. On Tron USDT (same contract, different compilation), the wallet address is **indexed** in `topics[1]`, and `data` carries only the amount. Both shapes were decoded accordingly.

## Table

| # | Chain | Tx | Block | Block time (UTC) | Wallet | Amount destroyed (USDT) | In census? | Original freeze | Dormancy |
|---|-------|----|------:|------------------|--------|------------------------:|:----------:|-----------------|---------:|
| 1 | ETH   | `0x9f7d…c80a` | 26465143 | 2026-11-19 02:14:47 | `0xf322a332…5e97e` |   2,117,677.970136 | ✓ | 2025-02-12 15:52:47 | 644.43 d |
| 2 | ETH   | `0x26a2…2555` | 26465143 | 2026-11-19 02:14:47 | `0x89cf540a…f1da5` |   4,242,287.280000 | ✓ | 2024-10-22 14:49:47 | 757.48 d |
| 3 | ETH   | `0xf799…6748` | 26465143 | 2026-11-19 02:14:47 | `0xe3d11143…15e14` |   5,680,262.520000 | ✓ | 2024-12-20 02:25:11 | 698.99 d |
| 4 | ETH   | `0x78a9…3583` | 26465143 | 2026-11-19 02:14:47 | `0xca44101a…0a4db` |     482,357.071069 | ✓ | 2025-01-07 17:06:23 | 680.38 d |
| 5 | TRX   | `ad05…d2fb` | 88203147 | 2026-11-21 17:52:42 | `TJ8tvVij…v63p`    |     277,406.754110 | ✗ | — | — |

**ETH subtotal:** 12,522,584.841205 USDT · **TRX subtotal:** 277,406.754110 USDT · **Total:** 12,799,991.595315 USDT

All five events verified on-chain: contract address matches USDT (`0xdac17f95…1ec7` on ETH; `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` on Tron), event is `DestroyedBlackFunds`, block numbers match the ledger, wallet addresses match, and status = success.

Ledger `log_index` values for the 4 ETH events (14, 17, 20, 23) match the on-chain receipt log indices exactly.

## Mismatches / caveats (reported as-is)

- **Tron wallet `TJ8tvVijjKrxdnKQWaivnLLNPXnuMZv63p` is not present** in `docs/evidence/dormant-fleet-usdt-enriched.json`. The census snapshot is dated 2026-11-17T19:53:54Z; the Tron destroy occurred 2026-11-21T17:52:42Z. Either (a) the wallet was blacklisted/frozen on Tron after the census snapshot was taken, or (b) it was omitted from the census. In either case, an original freeze time — and therefore a dormancy length — cannot be derived from the on-repo census for this event. A separate on-chain lookup for the AddedBlackList event on this wallet would be needed to fill that gap.

No other mismatches detected.
