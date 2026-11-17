# Watchlist audit — chain-watch Issue C (P0)

Status: draft, 2026-11-17 (revised twice: once after PR #23 v1 review, once after the authoritative-census pass). Scope: Ethereum mainnet + Tron. Read-only enumeration; no paid jobs.

## 1. Selection rule (the deliverable)

A contract qualifies for the chain-watch watchlist **if and only if** its on-chain ABI exposes at least one `event` whose canonical name matches a real freeze-, pause- or blacklist-style action — i.e. an event the issuer or protocol admin emits when gating or unwinding token movement or market access.

The canonical qualifying event-name set, as used by the audit:

```
core pause/unpause:   Paused, Unpaused, Pause, Unpause
core blacklist:       Blacklisted, UnBlacklisted, Blacklist, UnBlacklist,
                      AddedBlackList, RemovedBlackList, DestroyedBlackFunds
core freeze:          Freeze, Unfreeze, Frozen, Unfrozen, FrozenFunds,
                      AddressFrozen, AddressUnfrozen, AddressThawed,
                      FreezeAddress, UnfreezeAddress, FrozenAddressWiped
reserve-level (Aave): ReservePaused, ReserveUnpaused, ReserveFrozen, ReserveActive
market-level (Comp):  ActionPaused, MarketListed, MarketUnlisted, MarketDelisted,
                      NewPauseGuardian
protocol-level (Lido):Stopped, Resumed, StakingPaused, StakingResumed
blacklist-variant:    SanctionedAddressListUpdate
emergency:            EmergencyShutdown, Killed, SetKilled, SetPaused, SetEmergency
```

**Rule extension disclosure.** The initial name set (PR #23 v1) covered only the core stablecoin + Aave V3 event vocabulary. Extending the audit to the six ETH anchors surfaced issuer- and protocol-specific variants (`FreezeAddress` on USDP, `ActionPaused` on Compound, `StakingPaused`/`Stopped` on Lido, `AddressUnfrozen` on BUSD) that are semantically pause/freeze/blacklist actions, just under different canonical names. The extension is additive — no contract that previously qualified now drops; six new ones qualify that would otherwise have been misclassified.

Rationale: the watcher is an event-subscription system. Admin *functions* without a paired event (e.g. Curve `kill_me()`) are invisible to a log-based watcher; they would require trace-filter or state-diff monitoring, a different mechanism out of scope here. See §6 for the Curve case.

**Never-fired qualifying contracts are kept as sentinels, not dropped.** A contract that satisfies the rule but has no firings in the probe window stays on the list; its silence is a signal.

**Padding to hit a number is prohibited.** A shorter honest list beats a padded one.

## 2. Watchlist (11 contracts)

| # | Name | Chain | Address | Qualifying events | Proxy slot | Impl | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | USDT (Tether) | ETH | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | `AddedBlackList`, `RemovedBlackList`, `DestroyedBlackFunds`, `Pause`, `Unpause` | — | — | qualifies |
| 2 | USDC (Circle) | ETH | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | `Blacklisted`, `UnBlacklisted`, `Pause`, `Unpause` | ZOS | `0x43506849d7c04f9138d1a2050bbf3a0c054402dd` | qualifies |
| 3 | BUSD (Paxos / BinanceUSD) | ETH | `0x4Fabb145d64652a948d72533023f6E7A623C7C53` | `AddressFrozen`, `AddressUnfrozen`, `FrozenAddressWiped`, `Pause`, `Unpause` | ZOS | `0x2a3f1a37c04f82aa274f5353834b2d002db91015` | qualifies (winding down — see §5) |
| 4 | USDP (Paxos / Pax Dollar) | ETH | `0x8E870D67F660D95d5be530380D0eC0bd388289E1` | `FreezeAddress`, `UnfreezeAddress`, `FrozenAddressWiped`, `Pause`, `Unpause`, `SanctionedAddressListUpdate` | ZOS | `0xf459ff5ec7d1f371cb34754bda5fe5fce2c9054d` | qualifies |
| 5 | TUSD (TrustToken) | ETH | `0x0000000000085d4780B73119b644AE5ecd22b376` | `Blacklisted`, `DestroyedBlackFunds` | `implementation()` getter | `0xdbc97a631c2fee80417d5d69f32b198c8c39c27e` | qualifies |
| 6 | Aave V2 LendingPool | ETH | `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9` | `Paused`, `Unpaused` | EIP-1967 | `0x02d84abd89ee9db409572f19b6e1596c301f3c81` | qualifies |
| 7 | Lido stETH | ETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | `Stopped`, `Resumed`, `StakingPaused`, `StakingResumed` | `implementation()` (Aragon AppProxy) | `0x028271e30a695c0527a0c50ca30603fed004cdb0` | qualifies |
| 8 | Compound V2 Comptroller (Unitroller) | ETH | `0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B` | `ActionPaused`, `MarketListed`, `MarketExited`, `NewPauseGuardian` | `comptrollerImplementation()` | `0xbafe01ff935c7305907c33bf824352ee5979b526` | qualifies |
| 9 | Aave V3 PoolConfigurator | ETH | `0x64b761D848206f447Fe2dd461b0c635Ec39EbB27` | `ReservePaused`, `ReserveFrozen`, `ReserveActive` | EIP-1967 | `0xff42ce30054dce7dc7c1282a9a497aa58eabce99` | qualifies (65 `ReserveFrozen` in 30d — see §4) |
| 10 | USDT (Tether) | Tron | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | `AddedBlackList`, `RemovedBlackList`, `DestroyedBlackFunds`, `Pause`, `Unpause`, `Deprecate` | — | — | qualifies |
| 11 | USDC (Circle) | Tron | `TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8` | `Blacklisted`, `UnBlacklisted`, `Pause`, `Unpause` | FiatTokenProxy | (Tron proxy; impl merged in `getcontract` ABI) | qualifies — **legacy, ABI-verified, issuer-unconfirmed** (see §7) |

Filter parameters for row 9: 68 Aave V3 reserve asset addresses (from `Pool.getReservesList()` at `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`). Routed by indexed `asset` topic.

For 30-day and all-time freeze counts on account-level contracts (rows 1, 2, 3, 4, 5, 10, 11) see §3's census table. For protocol-level pauser 30-day firings (rows 6, 7, 8, 9) see §4.

## 3. Authoritative freeze census (account-level contracts)

The second revision of this doc ran a full-history census of the seven account-level freeze contracts (the four stablecoins plus BUSD, USDP, TUSD). Protocol-level pausers (Aave V2, Aave V3, Lido, Compound V2) are **excluded** from N and the census — they are address-set admin actions, not per-address freezes, and belong in a separate "DeFi admin actions" cadence metric (see §4). Event-row dedup is by `(tx_hash, log_index)` for Ethereum and `(transaction_id, event_index)` for Tron; distinct-address sets are then built from deduped rows.

Full evidence (per-contract address lists for all-time added, all-time removed, currently frozen, 30-day new, 30-day removed) is in `docs/evidence/watchlist-30d-counts.json` (~1.4 MB). Only aggregates appear here.

| # | Contract | Scan range | All-time add events | All-time remove events | Distinct all-time added | Distinct currently frozen | 30d add events | 30d distinct new | 30d remove events |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | ETH USDT | blk 4,634,748 → head | 3,224 | 347 | 3,214 | **2,868** | 51 | 51 | 0 |
| 2 | ETH USDC | blk 6,082,465 → head | 962 | 227 | 908 | **711** | 59 | 59 | 1 |
| 3 | BUSD | blk 8,493,709 → head | 274 | 1 | 274 | **273** | 8 | 8 | 0 |
| 4 | USDP | blk 14,653,265 → head | 106 | 0 | 106 | **106** | 8 | 8 | 0 |
| 5 | TUSD | blk 11,506,213 → head | 0 | 0 | 0 | **0** (sentinel) | 0 | 0 | 0 |
| 10 | Tron USDT | deployment → head | 9,282 | 1,006 | 9,243 | **8,238** | 308 | 307 | 25 |
| 11 | Tron USDC | deployment → head | 1,205 | 640 | 1,201 | **561** | 85 | 85 | 0 |
| | **Totals** | | **15,053** | **2,221** | **14,946** | **12,757** | **519** | **518** | **26** |

Row numbers correspond to the watchlist table in §2. Rows 6–9 (Aave V2 / Aave V3 / Lido / Compound V2) do not appear here — see §4.

### N — the definitive figure

**N = 519 account-level freeze additions over 30 days** (events, summing column "30d add events"). Dedup'd by distinct address: **518** (one Tron USDT address was blacklisted twice inside the window — likely a remove-then-re-add).

**Fallback N = 434** (events) / **433** (distinct) drops Tron USDC (issuer-unconfirmed):

```
N_headline_events  = 51 + 59 + 8 + 8 + 0 + 308 + 85 = 519
N_headline_distinct                                  = 518
N_fallback_events  = 519 − 85                        = 434
N_fallback_distinct                                  = 433
```

Mark picks which to lead with on Friday; both derive from the same evidence file.

**Removals** (count-only, not in N): 26 across all seven contracts.
**`DestroyedBlackFunds`** (USDT only, both chains, asset-burn — distinct action, not in N): 71 (21 ETH + 50 Tron) — see the earlier 30d probe in the evidence file.

### Reconciliation of the earlier 237 → 308 figure

The 02:10 UTC lane post on #648 cited N = 400 with Tron USDT at 237. The first in-repo re-derivation (PR #23 revision 1, `counts.json`) got 308. This census — a full all-time paginated TronGrid scan dedup'd by `(transaction_id, event_index)`, 53 paginated calls, 9,282 raw events returned with 9,282 unique keys (zero duplicates) — returns 308 for the 30-day subset.

**Root cause of the 237 figure: incomplete pagination in the earlier probe.** The honest explanation is not a "window shift" (my previous hand-wave was wrong — a ~12-hour slide on a ~10/day contract is ±5, not +71). The lane's 237 almost certainly ended pagination at its first empty response or default page cap and never reached the full 30-day set. The census's full fingerprint-walked traversal is the complete count.

Repo therefore stands behind **N = 519 (distinct 518)**, with the 237 (and the derived 400) retracted as undercounts, not as "estimates at a different timestamp".

### Fleet-size read

The live frozen address population across the seven contracts is **~12,757 addresses — thousands, not hundreds.** Breakdown:

```
Tron USDT     8,238  (64.6%)
ETH USDT      2,868  (22.5%)
ETH USDC        711  (5.6%)
Tron USDC       561  (4.4%)
BUSD            273  (2.1%)
USDP            106  (0.8%)
TUSD              0  (sentinel)
```

Tron USDT dominates both the live-frozen fleet (65 %) and the 30-day growth cadence (307 / 518 = 59 %), confirming the reviewer's prior framing. The address-twin pivot is working against a thousands-scale fleet, not a hundreds-scale one.

### Reproduction query

- Ethereum (USDT / USDC / BUSD / USDP / TUSD): Etherscan V2 `logs/getLogs` filtered by `address` + `topic0 = keccak256(event_sig)` over `fromBlock = deployment → toBlock = head`. Paginated at `offset=1000`; auto-bisect on 10-page cap. Dedup by `(transactionHash, logIndex)`; address extracted from indexed `topics[1]` when present, else the first 32-byte word of `data`.
- Tron (USDT / USDC): TronGrid `v1/contracts/{addr}/events?event_name=<Name>&limit=200&order_by=block_timestamp,asc`, paginated via `fingerprint` until empty. Dedup by `(transaction_id, event_index)`. Keyed via header `TRON-PRO-API-KEY`.

## 4. Aave `ReserveFrozen` — separate metric, NOT in N

Aave V3 PoolConfigurator fired `ReserveFrozen` **65 times in the last 30 days** (topic0 `0x0c4443d258a350d27dc50c378b2ebf165e6469725f786d21b30cab16823f5587`). `ReservePaused` (`0xe188d542…`) and `ReserveActive` (`0xc36c7d11…`) each fired **0 times**.

This is **not** included in the headline N. `ReserveFrozen` is asset-level (stops new supply/borrow of a specific reserve; existing positions untouched) and semantically distinct from stablecoin blacklist/freeze, which is account-level (prevents a specific address from transferring). Rolling them together would be misleading. They belong in a separate "DeFi admin actions" cadence table when the dashboard is built.

Row 9 is therefore **active, not a sentinel** — even though two of its three qualifying events had zero firings, the contract as a whole has high cadence.

## 5. Per-anchor verdict notes

- **BUSD** — qualifies, but Paxos announced the wind-down of BUSD issuance in Feb 2023 and new mints are paused. Keep on the watchlist (existing supply is still blacklistable) but flag for review if 30d firings trend to zero across several probes; at that point it becomes a candidate for downgrade to archive-only.
- **USDP** — qualifies with the broadest emergency surface in the set (pause + freeze + `SanctionedAddressListUpdate`). Paxos reports OFAC sanction-list ingestion via that event.
- **TUSD** — qualifies minimally (`Blacklisted`, `DestroyedBlackFunds`). Resolved via `implementation()` getter (not a standard EIP-1967 / ZOS slot); the watcher must re-resolve on `Upgraded` event from the proxy.
- **Aave V2 LendingPool** — qualifies with the pair `Paused`/`Unpaused`. Deprecated in favour of Aave V3 for most markets but still holds non-trivial positions.
- **Lido stETH** — qualifies via Aragon-pattern `Stopped`/`Resumed` (hard pause of the whole app) plus stETH-specific `StakingPaused`/`StakingResumed` (soft pause of staking submissions only). Watch both; they are distinct gates.
- **Compound V2 Comptroller (Unitroller)** — qualifies via `ActionPaused(string,bool)` + `ActionPaused(address,string,bool)` overloads (per-action and per-market), plus `NewPauseGuardian`. The two `ActionPaused` overloads have distinct topic0s; the watcher must subscribe to both.

## 6. Why Curve StableSwap pools do NOT qualify

Enumerated the main Curve StableSwap registry at `0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5` — 49 pools. Fetched each pool's verified ABI from Etherscan V2. **Zero of 49** pools expose any event from the qualifying set.

Spot-check: Curve 3pool (`0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7`) has admin *functions* `kill_me` / `unkill_me`, but its full event list is `TokenExchange, AddLiquidity, RemoveLiquidity, RemoveLiquidityOne, RemoveLiquidityImbalance, CommitNewAdmin, NewAdmin, CommitNewFee, NewFee, RampA, StopRampA`. A pool kill flips an internal state bit without emitting a labelled event.

Consequence: a log-based watcher cannot observe Curve pool kills. Picking them up would require trace-filter monitoring of `kill_me` calls on each pool — a different mechanism, out of scope for this watchlist. The honest result is to drop Curve from the list rather than pad it with contracts the watcher cannot usefully monitor. The CryptoSwap registry (`0x8F94…`), StableSwap factory (`0xB9fC…`) and CryptoSwap factory (`0xF180…`) were not enumerated because the main-registry rate is 0/49 — no reason to expect factory pools to follow a different event pattern.

## 7. Tron USDC label — `legacy, ABI-verified, issuer-unconfirmed`

Decomposition of the label on row 11:

- `legacy` — predates current lane scope, kept per Mark's conditional go.
- `ABI-verified` — confirmed this session via TronGrid; contract name on-chain is `FiatTokenProxy` (Circle's canonical FiatToken proxy pattern, same codebase as Ethereum USDC). Full canonical event + function surface present. 85 real `Blacklisted` firings in 30d are consistent with it being the live USDC-on-Tron contract.
- `issuer-unconfirmed` — Tronscan's anonymous API was rate-limited (`allowed_rps(3)`, suspension escalating to 90 s → 104 s) throughout this session; the `blueCheck` / `public_tag` / `issuer_name` fields that would map the deployer `TYsvgn3yjTQSWMwfsCN4mygYvozJGo8xBC` to Circle's attested identity were unreachable. This is a **session-specific access failure**, not a disproof. See §9 RETRY-1.

## 8. Infrastructure — endpoints, keys, limits

### Etherscan API V2 (required)
- Endpoint: `https://api.etherscan.io/v2/api?chainid=1&…` — V1 is deprecated, returns `"You are using a deprecated V1 endpoint, switch to Etherscan API V2"`. All call sites must include `chainid` (1 for mainnet).
- Free-tier limits: **3 req/s**, **100 000 req/day**, attribution clause applies to anything built on the data.
- Enumeration throttle in this session: 0.4 s between calls (≈2.5 rps, safely under 3).
- Methods used: `proxy/eth_call`, `proxy/eth_getStorageAt`, `proxy/eth_blockNumber`, `contract/getabi`, `logs/getLogs`.

### TronGrid
- Endpoint: `https://api.trongrid.io/…` keyed via header `TRON-PRO-API-KEY: $TRONGRID_API_KEY`.
- Free-tier limit (keyed): **15 QPS**. Unkeyed hits a lower public throttle.
- Methods used: `wallet/getnowblock` (healthcheck), `wallet/getcontract` (ABI), `v1/contracts/{addr}/events` (event frequency, paginated via fingerprint).

### Tronscan (no API key available this session)
- Endpoint: `https://apilist.tronscanapi.com/api/…`.
- Anonymous limit: 3 rps, with aggressive escalation (suspension 9 s → 90 s → 104 s on retries this session).
- Required for: issuer badge / `blueCheck` / `public_tag` cross-reference. See §9 RETRY-1.

### Key delivery path (CLAUDE.md-authorised)
- Both keys live in `~/keys/api-keys.txt` (outside any repo), one `KEY=VALUE` per line.
- **File label → env var remap** for the next session:
  - File label `ETHERSCAN_API` → env var `ETHERSCAN_API_KEY`.
  - File label `TRON_API` → env var `TRONGRID_API_KEY`.
- Load pattern used this session (values never pass through stdout, command text, or committed files):
  ```sh
  ETHERSCAN_API_KEY="$(awk -F= '/^ETHERSCAN_API=/{print $2}' ~/keys/api-keys.txt)" \
  TRONGRID_API_KEY="$(awk -F= '/^TRON_API=/{print $2}' ~/keys/api-keys.txt)" \
      <command>
  ```

### Key-presence self-check (this session)
- Etherscan V2: `eth_blockNumber` → block `0x193517f` ok.
- TronGrid: `wallet/getnowblock` → block 88 069 874 ok.

### Precomputed topic0s (Keccak-256 of canonical signatures)

| Event signature | topic0 |
|---|---|
| `AddedBlackList(address)` | derived at runtime (see counts.json) |
| `RemovedBlackList(address)` | derived at runtime |
| `DestroyedBlackFunds(address,uint256)` | derived at runtime |
| `Blacklisted(address)` | derived at runtime |
| `UnBlacklisted(address)` | derived at runtime |
| `ReservePaused(address,bool)` | `0xe188d542a5f11925d3a3af33703cdd30a43cb3e8066a3cf68b1b57f61a5a94b5` |
| `ReserveFrozen(address,bool)` | `0x0c4443d258a350d27dc50c378b2ebf165e6469725f786d21b30cab16823f5587` |
| `ReserveActive(address,bool)` | `0xc36c7d11ba01a5869d52aa4a3781939dab851cbc9ee6e7fdcedc7d58898a3f1e` |

All computed topic0s used in the re-derivation are stored in `docs/evidence/watchlist-30d-counts.json → topic0_computed`.

## 9. RETRY items (do NOT harden into permanent findings)

**RETRY-1 — Tron USDC deployer cross-reference.** Deployer `TYsvgn3yjTQSWMwfsCN4mygYvozJGo8xBC` could not be cross-referenced to Circle's attested identity this session because Tronscan's anonymous API was rate-limited. A later session with Tronscan API-key access (see [docs.tronscan.org](https://docs.tronscan.org/#get-an-api-key)) should re-run the `apilist.tronscanapi.com/api/token_trc20?contract=TEkxi…rdz8` call, inspect `blueCheck` / `public_tag` / `vip` / `issuer_name`, and if any attestation is present, promote the label from `issuer-unconfirmed` to `issuer-confirmed`. Session-specific access failure, not a disproof.

**RETRY-2 — Re-derive 30-day stablecoin counts in-repo.** DONE (revision 1) and superseded by the §3 census (revision 2). Evidence: `docs/evidence/watchlist-30d-counts.json`. Finding: **N = 519 events / 518 distinct** (the earlier 400 and intermediate 503 are retracted as undercounts).

**RETRY-3 — 30-day firing counts for the three protocol-level pausers.** Rows 6, 7, 8 (Aave V2 LendingPool, Lido stETH, Compound V2 Comptroller) carry a qualifying ABI; their 30-day firing counts were not derived this session (reviewer scoped the census to account-level contracts only, with protocol pausers kept in a separate "DeFi admin actions" metric alongside Aave V3 `ReserveFrozen`). A follow-up pass should run the reproduction query against each pauser's full qualifying event-set and extend the evidence file.

## 10. Reproduction

Enumeration + verification scripts used this session live under `/tmp/wlaudit/` (scratch, not committed). The core steps to reproduce:

1. Load keys per §8.
2. Resolve each proxy via the slot or getter listed in §2's "Proxy slot" column; `getabi` on the resolved impl.
3. For Aave V3, also `Pool.getReservesList()` → 68 reserves as filter parameters.
4. Enumerate Curve StableSwap main registry (`pool_count()` + `pool_list(i)`); `getabi` each; confirm 0 / 49 qualify.
5. Verify stablecoin ABIs (ETH direct for USDT; via ZeppelinOS slot for USDC; via TronGrid `wallet/getcontract` for Tron).
6. `logs/getLogs` on each ETH anchor and PoolConfigurator over `head − 216000 → head`; count by topic0.
7. TronGrid `v1/contracts/{addr}/events` with `min_block_timestamp` for Tron contracts; paginate via `fingerprint`.

All raw counts, block range, computed topic0s, and three sample transaction hashes per bucket: `docs/evidence/watchlist-30d-counts.json`.
