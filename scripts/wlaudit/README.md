# scripts/wlaudit — chain-watch query scaffolding

Preserved for the next Dev 2 so the chain-watch Issue C / Phase 2 / Binance cross-check lineage is not rebuilt from scratch. Every script here was authored during the 17 Nov Dev 2 session and generated an evidence artefact that lives under `docs/evidence/`.

## Rules the scripts obey

- **Keys never printed.** All scripts read `ETHERSCAN_API_KEY` / `TRONGRID_API_KEY` from the process environment (`os.environ[...]`). No script interpolates, logs, writes, or hashes the key anywhere.
- **Keys loaded from `~/keys/api-keys.txt` by file path**, outside any repo — the CLAUDE.md-authorised delivery path. The file labels are `ETHERSCAN_API` and `TRON_API`; the shell invoker remaps them inline to the env var names the scripts expect.
- **Read-only** — `eth_call`, `eth_getStorageAt`, `eth_getBlockByNumber`, `eth_blockNumber`, `logs/getLogs`, `contract/getabi`, `block/getblocknobytime`, TronGrid `wallet/getcontract` + `v1/contracts/{addr}/events` only. No tx submission, no on-chain writes, no paid services.
- **Rate-throttled** to ≤ 2.5 rps on Etherscan (free tier is 3 rps / 100k/day). TronGrid keyed at 15 QPS.

## Environment

Python 3.11+ with:

```sh
pip install base58 pycryptodome
```

No other deps. Scripts use stdlib `urllib.request` / `json` / `time` / `datetime` / `hashlib`.

## Invocation pattern (keys never on the command line)

```sh
ETHERSCAN_API_KEY="$(awk -F= '/^ETHERSCAN_API=/{print $2}' ~/keys/api-keys.txt)" \
TRONGRID_API_KEY="$(awk -F= '/^TRON_API=/{print $2}' ~/keys/api-keys.txt)" \
    python3 scripts/wlaudit/<name>.py
```

`awk` prints only the value into the env assignment; the value never touches stdout, command text, or any file.

## Script map

### Core (reusable across future tasks)

| Script | Produces | What it does |
|---|---|---|
| `census.py` | `docs/evidence/watchlist-30d-counts.json` | Full all-time + 30d freeze census for the 7 account-level contracts. Dedup'd by `(tx_hash, log_index)` / `(transaction_id, event_index)`. |
| `enrich.py` | `docs/evidence/dormant-sample-500-enriched.json` | Per-wallet earliest-freeze map + join against a sample. Classifies any unresolved with a stated cause (`map_miss` / `not_in_all_time_added` / `log_returned_without_timestamp`). |
| `fleet_usdt.py` | `docs/evidence/dormant-fleet-usdt-enriched.json` | Same logic as `enrich.py`, scaled to every currently-frozen USDT wallet on ETH + Tron (sentinels excluded per `docs/watchlist-audit.md` §3). |
| `longgap.py` | `/tmp/wlaudit/longgap.json` (not committed) | Finds wallet pairs with a long freeze → `DestroyedBlackFunds` gap, used to pick the Case-1 long-dormant proof wallet. |

### Decode + fixtures

| Script | Produces | What it does |
|---|---|---|
| `fixtures.py` | `docs/evidence/decode-fixtures.json` | Pins one known historical tx → expected-wallet per qualifying event-type (ETH data_word0, ETH topics1, Tron ABI-named). Includes the near-zero sentinel fixture. |
| `pairs.py` | `docs/evidence/dormant-sample-500.json`, part of `case1-wallets.json` | Draws the 500-wallet dormant sample proportional to contract share, applies sentinel exclusion, builds Tron base58. |

### Diagnostics (one-shot; reusable patterns)

| Script | Purpose |
|---|---|
| `investigate.py` | Pulls each ETH_USDT near-zero AddedBlackList log AND its triggering tx's input to decide artefact vs real. |
| `isblacklisted.py` | Confirms live on-chain state (`USDT.isBlackListed(address)`) for the near-zero entries — proved 17 / 17 real. |
| `verify.py` | Confirms ABI-level qualification for ETH USDT/USDC + initial Aave 30d event-frequency sketch. |
| `usdc.py` | Resolves ETH USDC via the ZeppelinOS slot (non-EIP-1967) and verifies the `Blacklisted/UnBlacklisted` event surface. |

### Exploratory (kept for the forensic trail; low future use)

| Script | Note |
|---|---|
| `probe.py` | Early Aave V3 PoolConfigurator proxy-impl resolve + Curve 3pool event sniff. |
| `anchors.py`, `anchors2.py` | First + second pass ABI classification of the six ETH anchors (BUSD, USDP, TUSD, Aave V2, Lido, Compound V2). |
| `counts.py` | Early 30d probe (counts only, pre-dedup). Superseded by `census.py`. Kept for provenance of the intermediate "503" figure. |
| `run_enum.py` | Original Curve StableSwap registry enumeration + Aave V3 PoolConfigurator event scan. Confirmed 0 / 49 Curve pools qualify under the selection rule. |

## What is NOT committed

- Scratch `/tmp/wlaudit/*.json` and `*.log` output files. Reusable outputs already live under `docs/evidence/`; the rest are one-shot intermediates.
- `/tmp/wlaudit/*.py.bak` editor backups.
- Any `/tmp/wlaudit/issue*.md` body drafts (used once with `gh issue edit`).

## For the next Dev 2

- Read `docs/watchlist-audit.md` first — it names each script's artefact and the sentinel rule the whole stack relies on.
- `docs/evidence/decode-fixtures.json` is the invariant: whatever you change about the watcher or any of these scripts, that fixture file is the test oracle.
- If you need a new chain or event-type, extend `census.py` (contract list + event sig) and `fixtures.py` (one new fixture) in the same PR. Do not add a new ad-hoc script; grow the ones already here.
- Rebuild rule, if this directory is lost: the plan file at `~/.claude/plans/pls-assess-both-notes-wild-sparrow.md` plus `docs/evidence/decode-fixtures.json` are enough to reconstruct everything below.
