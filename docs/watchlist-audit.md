# Watchlist audit — chain-watch Issue C (P0)

Status: draft, 2026-11-17. Scope: Ethereum mainnet + Tron. Read-only enumeration; no paid jobs.

## 1. Selection rule (the deliverable)

A contract qualifies for the chain-watch watchlist **if and only if** its on-chain ABI exposes at least one `event` whose canonical name matches a real freeze-, pause- or blacklist-style action — i.e. an event the issuer or protocol admin emits when gating or unwinding token movement or market access.

Concretely, the qualifying event-name set is:

```
Paused, Unpaused, Pause, Unpause,
Blacklisted, UnBlacklisted, Blacklist, UnBlacklist,
AddedBlackList, RemovedBlackList, DestroyedBlackFunds,
Freeze, Unfreeze, Frozen, Unfrozen, FrozenFunds,
AddressFrozen, AddressThawed,
ReservePaused, ReserveUnpaused, ReserveFrozen, ReserveActive,
EmergencyShutdown, Killed, SetKilled, SetPaused, SetEmergency
```

Rationale: the watcher is an event-subscription system. Admin *functions* without a paired event (e.g. Curve `kill_me()`) are invisible to a log-based watcher; they would require trace-filter or state-diff monitoring, a different mechanism out of scope here. See §5 for the Curve case.

**Never-fired qualifying contracts are kept as sentinels, not dropped.** A contract that satisfies the rule but has no firings in the probe window stays on the list; its silence is a signal.

**Padding to hit a number is prohibited.** A shorter honest list beats a padded one.

## 2. Watchlist (5 contracts)

| # | Name | Chain | Address | Qualifying events | 30d firings |
|---|---|---|---|---|---|
| 1 | USDT (Tether) | ETH | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | `AddedBlackList`, `RemovedBlackList`, `DestroyedBlackFunds`, `Pause`, `Unpause` | 51 adds |
| 2 | USDC (Circle) | ETH | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (impl `0x43506849d7c04f9138d1a2050bbf3a0c054402dd`) | `Blacklisted`, `UnBlacklisted`, `Pause`, `Unpause` | 59 adds |
| 3 | USDT (Tether) | Tron | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | `AddedBlackList`, `RemovedBlackList`, `DestroyedBlackFunds`, `Pause`, `Unpause`, `Deprecate` | 237 adds |
| 4 | USDC (Circle) | Tron | `TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8` (FiatTokenProxy) — **legacy, ABI-verified, issuer-unconfirmed** | `Blacklisted`, `UnBlacklisted`, `Pause`, `Unpause` | 53 adds |
| 5 | Aave V3 PoolConfigurator | ETH | `0x64b761D848206f447Fe2dd461b0c635Ec39EbB27` (impl `0xff42ce30054dce7dc7c1282a9a497aa58eabce99`) | `ReservePaused`, `ReserveFrozen`, `ReserveActive` | 65 `ReserveFrozen` (see §4) |

Filter parameters for contract 5: 68 Aave V3 reserve asset addresses (from `Pool.getReservesList()` at `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`). The watcher routes `ReservePaused` / `ReserveFrozen` / `ReserveActive` events by the indexed `asset` topic. The list of 68 reserve addresses is captured at `tmp/aave_reserves.json` (not committed); regenerate via the enumeration script in §7.

## 3. 30-day event-frequency probe — N derivation

The headline figure **N = 400 blacklist/freeze additions over 30 days** is the sum of the "30d firings" column for contracts 1–4 (account-level add-to-blacklist / freeze actions only; removals reported separately as 24):

```
N_headline = 51  (ETH USDT)
           + 59  (ETH USDC)
           + 237 (Tron USDT)
           + 53  (Tron USDC)
           ----
           = 400
```

**Fallback N = 347** drops contract 4 (Tron USDC, issuer-unconfirmed):

```
N_fallback = 400 − 53 = 347
```

Mark picks which to lead with on Friday; both are cleanly derivable from the same table above.

The per-contract 30-day counts (51 / 59 / 237 / 53; removals 24) are the figures corrected on the lane thread `edenbotanical #648` (02:10 UTC, 2026-11-17). This session did not re-derive them; the derivation recipe is:

- Ethereum (USDT/USDC): Etherscan V2 `logs/getLogs` filtered by `address` + `topic0 = keccak256(event_sig)`, blockrange = head − 216000 to head (≈30d at 12 s / block).
- Tron (USDT/USDC): TronGrid `v1/contracts/{addr}/events?event_name=AddedBlackList&min_block_timestamp=...` paginated.

## 4. Aave `ReserveFrozen` — separate metric, NOT in N

Aave V3 PoolConfigurator fired `ReserveFrozen` **65 times in the last 30 days** (topic0 `0x0c4443d258a350d27dc50c378b2ebf165e6469725f786d21b30cab16823f5587`). `ReservePaused` and `ReserveActive` fired **0 times** each.

This is **not** included in the headline N. `ReserveFrozen` is asset-level (stops new supply/borrow of a specific reserve; existing positions untouched) and semantically distinct from stablecoin blacklist/freeze, which is account-level (prevents a specific address from transferring). Rolling them together would be misleading. They belong in a separate "DeFi admin actions" cadence table when the dashboard is built.

Contract 5 therefore is **active, not a sentinel**.

## 5. Why Curve StableSwap pools do NOT qualify

Enumerated the main Curve StableSwap registry at `0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5` — 49 pools. Fetched each pool's verified ABI from Etherscan V2. **Zero of 49** pools expose any event from the qualifying set.

Spot-check: Curve 3pool (`0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7`) has admin *functions* `kill_me` / `unkill_me`, but its full event list is `TokenExchange, AddLiquidity, RemoveLiquidity, RemoveLiquidityOne, RemoveLiquidityImbalance, CommitNewAdmin, NewAdmin, CommitNewFee, NewFee, RampA, StopRampA`. A pool kill flips an internal state bit without emitting a labelled event.

Consequence: a log-based watcher cannot observe Curve pool kills. Picking them up would require trace-filter monitoring of `kill_me` calls on each pool — a different mechanism, out of scope for this watchlist. The honest result is to drop Curve from the list rather than pad it with contracts the watcher cannot usefully monitor. The CryptoSwap registry (`0x8F94…`), StableSwap factory (`0xB9fC…`) and CryptoSwap factory (`0xF180…`) were not enumerated because the main-registry rate is 0/49 — no reason to expect factory pools to follow a different event pattern.

## 6. ABI verification details per contract

### ETH USDT — `0xdAC17F958D2ee523a2206206994597C13D831ec7`
Not a proxy. Direct ABI via Etherscan V2 `contract/getabi`. Qualifying events present: `AddedBlackList, RemovedBlackList, DestroyedBlackFunds, Pause, Unpause`.

### ETH USDC — `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
`FiatTokenProxy`. Implementation stored at the ZeppelinOS slot `keccak256("org.zeppelinos.proxy.implementation")` = `0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3` (**not** EIP-1967). Current impl: `0x43506849d7c04f9138d1a2050bbf3a0c054402dd`. Qualifying events present: `Blacklisted, UnBlacklisted, Pause, Unpause`. The watcher must resolve the impl on upgrade; subscribe to logs on the proxy address (events are emitted from the proxy's address).

### Tron USDT — `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`
Contract name on-chain: `TetherToken`. ABI pulled via TronGrid `wallet/getcontract`. Qualifying events: `AddedBlackList, RemovedBlackList, DestroyedBlackFunds, Pause, Unpause` plus bonus `Deprecate` (protocol-level freeze signal — worth watching).

### Tron USDC — `TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8`
Contract name on-chain: `FiatTokenProxy` (Circle's canonical proxy, same pattern as Ethereum USDC). ABI pulled via TronGrid `wallet/getcontract`. Qualifying events present: `Blacklisted, UnBlacklisted, Pause, Unpause` and matching functions `blacklist / unBlacklist / pause / unpause / isBlacklisted / paused`.

Label: **legacy, ABI-verified, issuer-unconfirmed**. Decomposition:

- `legacy` — predates current lane scope, kept per Mark's conditional go.
- `ABI-verified` — confirmed this session via TronGrid; canonical FiatToken event + function surface present.
- `issuer-unconfirmed` — Tronscan was anonymously rate-limited (`allowed_rps(3)`, suspension escalating to 90 s) throughout this session; the badge / `blueCheck` / `public_tag` fields that would map the deployer `TYsvgn3yjTQSWMwfsCN4mygYvozJGo8xBC` to Circle's attested identity were unreachable. This is a **session-specific** access failure, not a disproof of issuance. See §9 RETRY-1.

### Aave V3 PoolConfigurator — `0x64b761D848206f447Fe2dd461b0c635Ec39EbB27`
EIP-1967 proxy. Impl resolved from slot `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` → `0xff42ce30054dce7dc7c1282a9a497aa58eabce99`. Qualifying events: `ReservePaused, ReserveFrozen, ReserveActive`. 68 reserve assets enumerated from `Pool.getReservesList()` as filter parameters.

## 7. Infrastructure — endpoints, keys, limits

### Etherscan API V2 (required)
- Endpoint: `https://api.etherscan.io/v2/api?chainid=1&…` — V1 is deprecated, returns `"You are using a deprecated V1 endpoint, switch to Etherscan API V2"`. All call sites must include `chainid` (1 for mainnet).
- Free-tier limits: **3 req/s**, **100 000 req/day**, attribution clause applies to anything built on the data.
- Enumeration throttle in this session: 0.4 s between calls (≈2.5 rps, safely under 3).
- Methods used: `proxy/eth_call`, `proxy/eth_getStorageAt`, `proxy/eth_blockNumber`, `contract/getabi`, `logs/getLogs`.

### TronGrid
- Endpoint: `https://api.trongrid.io/…` keyed via header `TRON-PRO-API-KEY: $TRONGRID_API_KEY`.
- Free-tier limit (keyed): **15 QPS**. Unkeyed hits a lower public throttle.
- Methods used: `wallet/getnowblock` (healthcheck), `wallet/getcontract` (ABI).

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

## 8. Precomputed topic0s (Keccak-256 of canonical signatures)

For the event-frequency probe queries:

| Event signature | topic0 |
|---|---|
| `ReservePaused(address,bool)` | `0xe188d542a5f11925d3a3af33703cdd30a43cb3e8066a3cf68b1b57f61a5a94b5` |
| `ReserveFrozen(address,bool)` | `0x0c4443d258a350d27dc50c378b2ebf165e6469725f786d21b30cab16823f5587` |
| `ReserveActive(address,bool)` | `0xc36c7d11ba01a5869d52aa4a3781939dab851cbc9ee6e7fdcedc7d58898a3f1e` |

Ethereum / Tron stablecoin event topics are standard Tether / FiatToken signatures; the watcher should derive them at startup via Keccak-256 of the canonical ABI strings rather than hardcoding.

## 9. RETRY items (do NOT harden into permanent findings)

**RETRY-1 — Tron USDC deployer cross-reference.** Deployer `TYsvgn3yjTQSWMwfsCN4mygYvozJGo8xBC` could not be cross-referenced to Circle's attested identity this session because Tronscan's anonymous API was rate-limited. A later session with Tronscan API-key access (see [docs.tronscan.org](https://docs.tronscan.org/#get-an-api-key)) should re-run the `apilist.tronscanapi.com/api/token_trc20?contract=TEkxi…rdz8` call, inspect `blueCheck` / `public_tag` / `vip` / `issuer_name`, and if any attestation is present, promote the label from `issuer-unconfirmed` to `issuer-confirmed`. This is a session-specific access failure, not a disproof.

**RETRY-2 — Re-derive the four 30-day stablecoin counts in-repo.** This session cited the 51/59/237/53 figures from prior lane work rather than re-deriving them. A follow-up session should run the Etherscan V2 `logs/getLogs` + TronGrid `events` queries documented in §3 and attach the raw count JSON to the repo under `docs/evidence/watchlist-30d-counts.json`, so the numbers are reproducible without lane-thread dependency.

## 10. Reproduction

Enumeration + verification scripts used this session live under `/tmp/wlaudit/` (not committed — scratch). The core steps to reproduce:

1. Load keys per §7.
2. Resolve Aave V3 PoolConfigurator impl via EIP-1967 slot; `getabi` on the impl; confirm `ReservePaused`/`ReserveFrozen`/`ReserveActive` present.
3. `Pool.getReservesList()` → 68 reserves.
4. Enumerate Curve StableSwap main registry (`pool_count()` + `pool_list(i)`); `getabi` each; confirm 0 / 49 qualify.
5. `getabi` each stablecoin (resolve USDC proxy via ZeppelinOS slot; USDT not a proxy) and Tron contracts via TronGrid `wallet/getcontract`.
6. `logs/getLogs` on Aave PoolConfigurator over head − 216 000 → head; count by topic0.
