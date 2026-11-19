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

### Sentinel-address note (post-merge addendum)

**Status**: resolved. Decoder confirmed correct; entries are real on-chain blacklistings.

The currently-frozen sets include a small number of near-zero addresses: **17** on ETH USDT (`0x0000…0000`, `0x0000…0018`, `0x0000…0019`, `0x0000…001a`, …) and **8** on Tron USDT (`0x0000…1896`, `0x0000…2053`, `0x0000…234a`, …) under the leading-10-bytes-zero filter — total **25**. A wider leading-8-bytes-zero filter catches one more ETH entry (18+8 = 26). The initial concern ("~50", decoder grabbed the wrong 32-byte word) resolves to:

1. **The count is 25–26, not ~50.** Reviewer / sup estimate was roughly 2× the actual.
2. **The decoder is correct, verified three ways:**
   - **Structural**: `AddedBlackList(address)` is a single-parameter event. Every one of the 17 ETH_USDT logs has `topics.length == 1` and `data.length == 32 bytes` — a single word. There is no "other 32-byte word" for the decoder to have picked wrongly. Example: tx `0x26e2265c66d7de39bdf0570a74118bbeec782ea11b10b9b075f3ef3866d70722` at block 6,969,269, raw `data = 0x0000000000000000000000000000000000000000000000000000000000000000`.
   - **On-chain live state**: `USDT.isBlackListed(address)` returns **true for all 17** near-zero addresses today — the live storage of the Tether contract records these addresses as blacklisted. If the decoder had grabbed a wrong word, we would be retrieving a different address than the one the contract has in state, and `isBlackListed()` would return `false`. It returns `true` 17/17.
   - **Fixture-pinned**: `docs/evidence/decode-fixtures.json` includes an explicit near-zero fixture (ETH USDT tx above → expected `0x0`) so a future decoder regression would fail CI loudly.
3. **How they got there**: all 17 ETH_USDT near-zero logs were emitted from Tether's **Gnosis multisig admin** (senders `0xf4b51b14…`, `0x61d5a4d5…`, `0xac3b242e…` using `confirmTransaction(uint256)` → the multisig's internal `execTransaction` → `USDT.addBlackList(X)`). Several are sequential small integers (0x0, 0x18, 0x19, 0x1a) — the pattern is consistent with issuer sentinel / test additions in the early life of the blacklist feature, with a few where the stored address in the multisig pendingTx apparently got set to a small uint value (possibly txId leakage). Either way, the on-chain state is what it is.

They count toward on-chain totals but should NOT be fed into the fleet seed as substantive wallets.

#### Sentinel-exclusion rule (committed)

> **An address is a sentinel — excluded from fleet seeding — if and only if its first 10 bytes (the first 20 hex characters of the 40-char body, i.e. `address[2:22] == "0" * 20`) are all zero.**

That rule, applied to the seven account-level `currently_frozen` sets from `docs/evidence/watchlist-30d-counts.json`, yields **25 sentinels** (17 ETH USDT + 8 Tron USDT; the other five contracts contribute zero). It is the exact rule used by `docs/evidence/dormant-sample-500.json` and the one the grant copy relies on. It is deterministic and re-derivable from the evidence file in one pass.

The count is a function of the threshold. A stricter threshold (e.g. first 12 bytes zero) would classify fewer addresses as sentinels. A looser one (e.g. first 8 bytes zero, which is `address[2:18]`) catches one additional ETH USDT entry (26 total), shifting the seedable number from 12,732 to 12,731. The 10-byte threshold is what this doc and the committed evidence stand behind; any revision should be stated with the same precision.

Resulting counts after exclusion (fleet-seedable only), lead-10-byte filter:

```
ETH USDT currently_frozen seedable = 2,868 − 17 = 2,851
Tron USDT currently_frozen seedable = 8,238 −  8 = 8,230
Others unchanged.
Seedable live-frozen fleet total    = 12,732  (vs 12,757 on-chain total)
```

#### Guidance for grant copy

- **Headline**: use **12,732** seedable live-frozen wallets (the fleet the project can actually address-twin). Derivation: `on-chain live-frozen total 12,757 − 25 sentinels (per rule above) = 12,732`.
- **Footnote**: "On-chain, the raw blacklist state across these seven contracts records 12,757 addresses; 25 of those are near-zero issuer sentinel / test additions (verified real on-chain, decoder-independent, documented in `docs/watchlist-audit.md` §3 and `docs/evidence/decode-fixtures.json`) and are excluded from the fleet seed."

Both numbers resolve from the same evidence file; neither is massaged.

### Enriched dormant sample

For the paid Case-1 proof, every sample wallet needs its **real** freeze time so the twin can be registered with a truthful `frozen_at`. `docs/evidence/dormant-sample-500-enriched.json` extends `docs/evidence/dormant-sample-500.json` (original kept untouched) with, per row:

- `freeze_tx` — hash of the earliest `AddedBlackList` / `Blacklisted` / `AddressFrozen` / `FreezeAddress` event on the source contract naming this wallet.
- `freeze_block` — block number of that event.
- `frozen_at` — ISO 8601 UTC timestamp of the freeze block.

Method: full-history paginated event scan per source contract (Etherscan V2 `logs/getLogs` for ETH, TronGrid `v1/contracts/{addr}/events` for Tron); wallet-indexed; earliest timestamp kept. Deterministic — re-running on a different day only changes the result if a wallet's EARLIEST freeze is itself replaced, which cannot happen (freeze events are append-only).

Result: **500 / 500 rows resolved** with freeze_tx + frozen_at. `unresolved_count = 0`. Freeze dates span **2020-02-14 → 2026-11-16**, confirming the dormant-sample covers real long-tail history and is not clustered on the last 30 days.

### Decoder golden fixtures

To prevent silent decoder regressions in Issue D's watcher (per that issue's Definition of Done), `docs/evidence/decode-fixtures.json` pins a known historical `(tx_hash, log_index)` to an expected wallet for every qualifying event-type on both chains that has at least one firing:

- 3 fixtures on the `data_word0` path (ETH USDT `AddedBlackList` / `RemovedBlackList` / `DestroyedBlackFunds` — all non-indexed, wallet in `data`).
- 4 fixtures on the `topics1` path (ETH USDC `Blacklisted` / `UnBlacklisted`, BUSD `AddressFrozen` / `AddressUnfrozen`, USDP `FreezeAddress` — all with `address indexed`).
- 4 fixtures on the `trongrid_abi_named_param` path (Tron USDT `AddedBlackList` / `RemovedBlackList` / `DestroyedBlackFunds`, Tron USDC `Blacklisted` — read by ABI parameter name, position-free).
- 1 explicit near-zero sentinel fixture (ETH USDT tx `0x26e2265c…d70722` → expected `0x0`, cross-verified by `isBlackListed` live-state).
- 1 live-state proof flag on the near-zero fixture so a future reader knows the expected value is not a bug.

The watcher's unit tests (Issue D) must load this file at startup and assert `decode(tx, log_index) == expected_wallet` for every entry. A future contract added to the watchlist whose wallet is NOT parameter 0, or an event whose signature rev-upgrades, will fail these fixtures loudly.

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
- `issuer-unconfirmed` — Rerun 2026-11-19 reached Tronscan after extended back-off and returned the `token_trc20` record; `blueTag`, `publicTag`, `vip`, and `isBlueCheck` are all empty / false — **no verified-issuer attestation**. The token's self-reported metadata (symbol `USDCOLD`, name "USD Coin Old", `home_page = centre.io`, description naming CENTRE/Circle) is suggestive but not an attestation. Label stays `issuer-unconfirmed`. Full field dump and decision rule: §9 RETRY-1.

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

**RETRY-1 — Tron USDC deployer cross-reference.** Rerun 2026-11-19 (anonymous Tronscan API, after extended back-off clear): `apilist.tronscanapi.com/api/token_trc20?contract=TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8` returned a token record. Attestation findings:

- `blueTag = ""`, `publicTag = ""`, `greyTag = ""`, `redTag = ""`, `vip = false` — **no verified-issuer badge of any kind.**
- `isBlueCheck` / `blueCheck` / `issuer_name` fields: not present in the response.
- `level = "2"` (Tronscan's internal tier; not a verified-issuer attestation).
- Self-description: `symbol = "USDCOLD"`, `name = "USD Coin Old"`, `home_page = "https://www.centre.io/"`, `token_desc` = *"USDC is a fully collateralized US Dollar stablecoin developed by CENTRE..."*. These are suggestive (CENTRE is the Circle/Coinbase consortium that originated USDC), but **are self-reported fields, not Tronscan attestation**.

Verdict: **label stays `legacy, ABI-verified, issuer-unconfirmed`.** The `legacy` tag is reinforced (symbol literally "USDCOLD", name "USD Coin Old"). The `issuer-unconfirmed` tag is reinforced: no blue-check / public-tag / vip / issuer-name attestation on Tronscan. The 2026-11-19 reconciliation PR therefore keeps the grant headline at the WITHOUT-Tron-USDC fallback (434/433) and the 519/518 cross-check is used only with the legacy footnote.

A future session with keyed Tronscan access could still look for a `verifiedStatus` / `badgeList` field on an authenticated endpoint; this anonymous `token_trc20` call does not expose one. Promote the label only on explicit attestation, never on self-reported metadata.

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
