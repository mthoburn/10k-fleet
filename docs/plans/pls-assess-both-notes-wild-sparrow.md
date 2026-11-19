# Plan — Dev 2 execution plan (18 Nov)

## Context

Two notes for Dev 2 (10k-fleet lane):

1. **Binance-hack cross-check** — read-only data analysis cross-referencing Tether's 29 Oct 2026 Binance-hack freezes against the chain-watch census. $0, half-day, deliverable is an addendum to `docs/evidence/chain-watch-evidence-index.md` (PR #29) plus raw-rows JSON.
2. **Storm Boelo inputs-only** — Met Éireann warnings JSON + seeded 50k-policy CSO-weighted book + a shape-check doc. Replay runs Eden-side. No coordinator package, no DB access from this terminal. Target end of Friday 20 Nov.

Mark confirmed (18 Nov):
- Note 2 scope = inputs-only. Do NOT touch the coordinator package or any database.
- Everything Storm Boelo-related carries the visible label: *"CONCEPT: synthetic policies, real Met Éireann warnings"* in content and filename.

Reviewer confirmed (18 Nov) with two adds on Note 1 and five adjustments on Note 2 — all folded into the sections below.

Prior Phase-1 audit confirmed all Note 1 join inputs already live in the repo on open branches, and that 10k-fleet has no coordinator code or DB credentials — reinforcing the inputs-only scope on Note 2.

## Sequencing

1. Note 1 first (faster, ~half day, reuses existing scaffolding).
2. Note 2 inputs second (end-of-Friday target).
Both land as separate PRs.

---

## Note 1 — Binance cross-check

### Branch + PR

Cut `chain-watch/binance-xref` from `origin/chain-watch/evidence-index` (PR #29's branch). Open PR into PR #29 so the Binance addendum rides with the evidence index; #29 merges once with both changes.

### Query scope

Window: `2026-10-29 00:00 UTC → 2026-10-30 23:59 UTC`. Chains: ETH USDT + Tron USDT only (Tether's press release is USDT-specific; other stablecoins not in scope for this cross-check). Decoders already pinned in `docs/evidence/decode-fixtures.json`.

### Deliverables

**`docs/evidence/binance-xref-29oct2026.json`** — raw rows:

- All ETH USDT + Tron USDT `AddedBlackList` events with `block_timestamp` in the window. For each: `chain`, `wallet`, `freeze_tx`, `freeze_block`, `block_ts`, `balance_at_freeze_block` (`balanceOf(wallet, tag=hex(freeze_block))`).
- Match flags per row: `in_phase2_fleet` (join on `docs/evidence/dormant-fleet-usdt-enriched.json`), `in_census_seedable` (join on the 12,732 non-sentinel set from `docs/evidence/watchlist-30d-counts.json`). If a row is in the census but not the Phase-2 fleet or vice versa, state why (sentinel? post-cutoff add?).
- Post-29-Oct wake-check: for each flagged wallet, scan `DestroyedBlackFunds` + `RemovedBlackList` on the same contract from `freeze_block → head`. List hits with `tx`, `block`, `event_name`, and which twin would have woken.
- **24-hour / 1-hour buckets around 29 Oct** to detect clustering vs the ~15/day USDT-combined baseline. Return times and counts only — no address lists.

**Addendum appended to `docs/evidence/chain-watch-evidence-index.md`** — the four answers from the note, with:
- Neutral wording ("the day Tether reports freezing funds from the Binance hack", never "hacker wallets").
- "Census data powered by Etherscan" on Etherscan-derived figures.
- Match-by-date-and-chain-only disclaimer explicit: *"Tether's release does not list addresses; we cannot say which wallets are 'the hack wallets'."*
- Raw-rows file referenced by path.

### Query method (reuse of prior session scripts)

- `Crypto.Hash.keccak` + Etherscan V2 `logs/getLogs` pattern from `/tmp/wlaudit/census.py` and `/tmp/wlaudit/enrich.py`.
- ETH block boundaries: Etherscan V2 `block/getblocknobytime` (if available) or binary-search `proxy/eth_getBlockByNumber` on `timestamp`. Tron: pass `min_block_timestamp` / `max_block_timestamp` in ms directly to the events API.
- Historical balance: `proxy/eth_call` with `to=USDT`, `data=<selector_balanceOf>+<wallet_padded>`, `tag=hex(freeze_block)`.
  - **Pre-flight check (reviewer add-1)**: test ONE historical call first. The Etherscan V2 proxy rejected `tag=finalized` in Phase 2, so archive-state support is not a given. If the free tier refuses `tag=hex(block)`, set `balance_at_freeze_block: "unavailable"` per row and continue — do NOT fail the job on it. Record the pre-flight result in the raw-rows file header.
- Pagination + dedup by `(tx_hash, log_index)` / `(transaction_id, event_index)`, same as the enrichment scripts.

#### Balance-sum framing (reviewer add-2)

The total `balance_at_freeze_block` sum is **all USDT freezes in the 29–30 Oct window — a superset of the hack-related ones** (Tether's release names zero addresses). The addendum labels it that way: *"sum of frozen USDT balances across all 29–30 Oct USDT freezes, which contains but is not limited to funds Tether reports freezing from the Binance hack"*. A gap vs the $1.5B headline is a data flag to report, not a signal to trim rows.

### Budget

≤ 200 Etherscan V2 calls + ≤ 20 TronGrid calls (well under the 2000 Etherscan ceiling). $0, read-only. Keys loaded via `~/keys/api-keys.txt` inline-awk pattern, never printed.

### Verification

Hand-verify ≥ 2 rows per chain against the Etherscan / Tronscan UI (same block timestamp and event args). Cross-check sum of `balance_at_freeze_block` against Tether's $1.5B headline — ballpark match expected; a wide gap is a data flag to report, not trim. Count-sanity: 29 Oct cluster should visibly exceed the 30-day daily baseline bucket.

---

## Note 2 — Storm Boelo inputs

### Branch + PR

`concept/storm-boelo-inputs` cut from `main`. Separate PR into `main`.

### Deliverables (all labelled "CONCEPT: synthetic policies, real Met Éireann warnings")

**`docs/evidence/CONCEPT-storm-boelo-warnings.json`** — warning **time series**:
- **Primary source (reviewer adj-1)**: met.ie warning archive. News commentary (`impacts-of-storm-boelo/` etc.) used only to cross-check; never as the primary. The file records both source URLs per entry.
- Capture every warning as a time-ordered series, not a single snapshot. Must include at minimum:
  - the initial Orange wind warning covering Donegal, Leitrim, Mayo, Sligo (one entry per county — see adj-3);
  - the **updated** Orange wind warning that ADDS Galway (own `issued_at`) — this addition is the escalation the concept demonstrates, without it there is no re-wake story;
  - the Galway Orange rain warning;
  - the Kerry Orange rain warning;
  - every yellow and red issued across the event, likewise split per county.
- **Republic of Ireland / Met Éireann only (reviewer adj-2)**. Northern Ireland warnings are UK Met Office and are either excluded entirely or placed in a separate, clearly-labelled `"ni_uk_metoffice_reference_only"` array; they are NEVER mixed into the Met Éireann set.
- **Per-county event splitting (reviewer adj-3)**: any province-wide, "all counties", or multi-county warning is split into one event per county in the file. Each split entry carries the same `warning_source_id` so the Eden-side runner can reconstruct the group if needed.
- Per entry: `county` (ROI, English spelling), `warning_source_id` (met.ie stable ID if one exists; else `null`), `level` (yellow / orange / red), `warning_type` (wind / rain), `issued_at` (ISO UTC), `valid_from` (ISO UTC), `valid_to` (ISO UTC), `source_url_primary` (met.ie archive URL), `source_url_cross_check` (news URL, nullable), `notes` (nullable, for ambiguities).
- Top-of-file metadata:
  - `"label": "CONCEPT: synthetic policies, real Met Éireann warnings"`;
  - `"severity_order"` (adj-5): `["yellow","orange","red"]`, stated explicitly;
  - `"attribution"` (adj-5): the exact credit / licence line met.ie requires for re-use of its warnings (fetched from met.ie's terms during gathering), e.g. *"Weather warnings sourced from Met Éireann"*;
  - `"generated_at_utc"`, source URL list, any gaps / ambiguities called out — not papered over.

**`docs/evidence/CONCEPT-ireland-policy-book-50k.json`** — synthetic insured book:
- 50,000 policies, one twin each, `region = county`.
- Counties distributed in proportion to the most recent CSO census population per county (26 counties — Republic of Ireland; file documents the exact CSO table used and its URL).
- **Seeded with a fixed numeric seed** recorded in the file header. Reproducible: regenerating with the same seed MUST produce a byte-identical file (verification step below).
- Per policy: `policy_id` (deterministic, seed-derived), `county`, `label: "CONCEPT: synthetic policies"`.
- Not geolocated beyond county; no fake addresses / names / amounts — just the minimum fields the shape-check doc depends on.

**`docs/evidence/CONCEPT-storm-boelo-shape-check.md`** — one-pager:
- Wake policy to register on the Eden side: `minSeverity = orange`, region exact-match on county.
- **Severity ordering (reviewer adj-5)** stated at the top of the doc: `yellow < orange < red`. `minSeverity = orange` therefore matches orange and red, not yellow.
- **Attribution + label (reviewer adj-5)**: both the "CONCEPT: synthetic policies, real Met Éireann warnings" line and the exact met.ie credit / licence line appear on the doc and are required on any report the Eden-side runner produces.
- Event payload shape per warning (chain-side analogue of the Note 1 event model):
  ```
  {
    "namespace": "concept-storm-boelo",
    "subject_kind": "policy",
    "subject_region": "<county>",
    "event_type": "met_eireann_warning",
    "severity": "<yellow|orange|red>",
    "warning_type": "<wind|rain>",
    "issued_at": "<ISO UTC>",                    // submission order only
    "valid_from": "<ISO UTC>",
    "valid_to": "<ISO UTC>",
    "warning_source_id": "<met.ie stable ID or null>",
    "source_url_primary": "<met.ie URL>",
    "event_identity": "<reviewer adj-4; see below>",
    "event_key": "<sha256(event_identity)>"
  }
  ```
- **Event identity (reviewer adj-4)**: identity is
  - `(warning_source_id, county, severity_band)` if met.ie exposes a stable warning ID,
  - else `(county, warning_type, severity_band)`.
  Identity does NOT include `issued_at` — so a same-band extension (same orange warning re-issued with a later valid-to on the same county) deduplicates, and a band escalation (e.g. Galway yellow → orange) correctly counts as new and triggers a re-wake. `issued_at` is retained for submission ORDER only.
- Submission order: by `issued_at` ascending — mirrors real-time issue order.
- Expected report columns (for the Eden-side runner):
  - policies in counties under ANY warning (today's broad rule) vs twins woken (orange+ rule);
  - wakes per county; escalation re-wakes; repeats deduped;
  - time each wake was decided relative to its warning's `issued_at`.
- Labels + no-insurer-data rule + Met Éireann attribution restated at the top.

### What this PR explicitly does NOT do

- Does NOT run any wake-decision replay.
- Does NOT connect to a coordinator / coordinator DB / Neon branch.
- Does NOT import from Eden `server/` or `client/`.
- Does NOT call any Nosana or paid or on-chain service. $0 across the board.

### Budget

Read-only web fetches to met.ie for the warning archive + CSO for county populations. No API keys burnt.

### Verification

- Run the policy-book generator twice with the same seed → outputs byte-identical.
- Validate each warning JSON row against its met.ie archive `source_url_primary` (spot-check ≥ 3 rows per severity band). News `source_url_cross_check` used only to confirm wording, never to supply facts.
- Confirm the Galway add-to-the-orange-wind-warning escalation is present with its own distinct `issued_at` and resolves to a new `event_identity` (per adj-4 rule) vs the initial Donegal/Leitrim/Mayo/Sligo warning.
- Confirm no Northern Ireland / UK Met Office entries sit in the Met Éireann set.
- Confirm all three files carry the CONCEPT label AND the Met Éireann attribution line in content, and the filenames include `CONCEPT-`.
- `vitest` / `npm test` unaffected (no code changes to repo logic).

---

## Critical files

- `docs/evidence/chain-watch-evidence-index.md` *(PR #29 branch `chain-watch/evidence-index`)* — Note 1 addendum lands here.
- `docs/evidence/dormant-fleet-usdt-enriched.json` *(branch `chain-watch/dormant-fleet-usdt`)* — Phase-2 fleet join source.
- `docs/evidence/watchlist-30d-counts.json` *(main)* — census, seedable 12,732 = 12,757 − 25 sentinels.
- `docs/evidence/decode-fixtures.json` *(branch `chain-watch/case1-sample`)* — ABI/topic references.
- CLAUDE.md — binding scope rules (no Eden server/client imports; no Eden work beyond read-only data analysis).
- New files for Note 2: `docs/evidence/CONCEPT-storm-boelo-warnings.json`, `docs/evidence/CONCEPT-ireland-policy-book-50k.json`, `docs/evidence/CONCEPT-storm-boelo-shape-check.md`.

## Reuse from prior work

- `/tmp/wlaudit/enrich.py` — pagination + wallet→earliest-event map; adapt for dated-window query.
- `/tmp/wlaudit/longgap.py` — pairs event-A against event-B by wallet; adapt for freeze→later-wake check in Note 1.
- `/tmp/wlaudit/fleet_usdt.py` — two-chain scan skeleton; narrow blockrange to 29–30 Oct window.
- Sentinel exclusion rule `address[2:22] == "0" * 20` — already codified; reuse verbatim.
- `base58` + `pycryptodome` already installed in the session env.

## Report-back (post each PR)

For Note 1:
- headline counts per chain, total frozen balance at freeze block, Phase-2-fleet match rate, census-seedable match rate, post-freeze wake hits, 29 Oct cluster indicators.

For Note 2:
- warning count per level / county, policy count per county, seed value, generator SHA for reproducibility.

Both reports neutral-worded, "Census data powered by Etherscan" where applicable, CONCEPT label on Storm Boelo items.
