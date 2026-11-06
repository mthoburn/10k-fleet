# Evidence Ladder — 10k Coordinator

Three rungs of evidence — live, shadow, and benchmarked — for the Nosana grant application. Rungs 1–2 are live/production data; rung 3 is a synthetic-at-scale benchmark on real schema.

---

## Rung 1 — Pilot: live fleet under hard budget caps

**What it is:** 500 real eden-pilot twins across 53 ecoregions, running daily since 30 Oct 2026 on the production coordinator. Every job is budget-checked before spend; refusals are recorded in full.

**Numbers (UTC days, production coordinator):**

| Day | Delivered | Refused | Spend (USD) |
|-----|-----------|---------|-------------|
| 2026-10-30 | 98 | 196 | $0.9124 |
| 2026-10-31–11-02 | 0 | 1,260 | $0.0000 |
| 2026-11-03 | 93 | 556 | $0.9363 |
| 2026-11-04 | 93 | 461 | $0.9355 |
| 2026-11-05 | 92 | 313 | $0.9263 |
| 2026-11-06 | 91 | 117 | $0.9278 |

Oct 31–Nov 2 freeze was a known bug (#541), fixed and confirmed reset 2026-11-04.  
Every active day: spend ≤ $1.00 job_kind cap ✓ and ≤ $1.50 fleet cap ✓

**Cost per delivered job (Oct 30 sample):** $0.9124 / 98 = **$0.0093/job** (model: claude-sonnet-4-6, 950 prompt + 180 completion tokens)

**Verification:** `pilot-ledger.json` in this directory. Query: `coordinator.lineage JOIN coordinator.jobs WHERE namespace='eden-pilot'`.

---

## Rung 2 — Shadow run: 10k fleet, production coordinator, real events

**What it is:** 10,000 real twins (namespace `eden-prod`) across 588 ecoregions running in shadow mode on the production coordinator. All 101 events in the 48h window were scouted; zero live jobs fired.

**Numbers (48h window: 2026-10-30 21:05 UTC → 2026-11-01 21:05 UTC):**

| Metric | Value |
|--------|-------|
| Events submitted | 101 |
| Events scouted | 101 (100%) |
| Shadow wakes | 1,733 |
| Live wakes | 0 |
| Coalesced / skipped | 0 / 0 |
| Fan-out p50 / p95 / max | 18 / 18 / 18 |
| Shadow estimated cost (window) | $23.3955 |
| Implied fully-live cost/day | **$11.70** |
| Failures | 0 |
| eden-pilot affected | No |

**As of 2026-11-06 (run ongoing):** 305 events scouted · 4,842 shadow wakes · $65.37 cumulative shadow est.

**Verification:** `shadow-10k-summary.json` in this directory. Query: `coordinator.event_summaries WHERE namespace='eden-prod'`.

---

## Rung 3 — Scale test: 570k synthetic twins, real schema

**What it is:** Full-fleet load test on an isolated Neon test branch (real schema, synthetic data at 10k-fleet target scale).

**Numbers (from `load-test-summary.json` and `load-test-report.md`):**

| Metric | Value |
|--------|-------|
| Twins seeded | 569,896 across 591 ecoregions |
| Events replayed | 14 (severity ≥ 0.3, 7-day window) |
| Total wake decisions | 107,616 |
| Scout latency p50 / p95 | 270ms / 807ms |
| Budget overrun at C=50 | **$0.000000** |
| Sweep selection (worst case) | ~2.3s (all-tier-2 synthetic; production pre-filter reduces this) |

**Source:** mthoburn/edenbotanical#556, branch `load-test/phase2` @ `063155bb`.

---

## Fleet target distribution

591 ecoregions · 569,896 render-eligible images · no per-region cap.  
See `fleet-distribution.json`.
