# Evidence Ladder — 10k Coordinator

Four rungs of evidence — live, shadow, benchmarked and registered-live — for the Nosana grant application. Rungs 1, 2 and 4 are production data; rung 3 is a synthetic-at-scale benchmark on real schema.

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

**As of 2026-11-06:** 305 events scouted · 4,842 shadow wakes · $65.37 cumulative shadow est.

**Status:** 48-hour measured run complete (figures as reported); the 10,000 shadow twins were absorbed into the full-fleet registration on 9 Nov 2026 (rung 4).

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

## Rung 4 — Registered-live: the full demonstration fleet on the production coordinator

**What it is:** The full render-eligible image set registered as twins in namespace `eden-prod` on the production coordinator on 9 Nov 2026, and reacting to real events since. Twins stay dormant until an event touches their ecoregion; a wake is recorded, with no job and no model spend.

**Numbers (production query, 2026-11-10 13:45 UTC):**

| Metric | Value |
|--------|-------|
| Twins registered (`eden-prod`) | **580,551** |
| Distinct ecoregions | 594 |
| Net new inserts (9 Nov batch) | 570,551 |
| Pre-existing twins updated in place | 10,000 |
| Duplicates created | 0 (`ON CONFLICT (namespace, kind, external_ref) DO UPDATE`) |
| Insert batch window (database write) | 2026-11-09 16:45:38 → 16:47:36 UTC: 1m58s (~4,900 rows/sec) |
| End-to-end run, including verification | ~6 minutes |

**Live since registration (production query, 2026-11-10 14:00 UTC):**

| Metric | Value |
|--------|-------|
| Real events scouted | 35 |
| Wakes recorded | 178,757 |
| Jobs submitted | 0 |
| Spend | $0.00 |

Wakes are counted from `event_summaries.woken_shadow`, the authoritative wake counter for shadow namespaces. Each wake is recorded without submitting a job or spending on a model. These are measured results; wake-record metrics keep accumulating, and a fuller export will follow after several days of operation.

**Reconciliation with rung 3:** rung 3 used the 569,896 render-eligible images across 591 ecoregions counted on 6 Nov 2026. Rung 4's 580,551 across 594 ecoregions is higher because new renders landed between 6 and 9 Nov.

**Also recorded:** the `eden-pilot` daily budgets in force at query time (fleet $1.50; `write_reading` $0.50; `sweep_reading` $0.50). These belong to the 500-twin pilot (rung 1) and are unchanged by this registration.

**Verification:** registration figures in `registration-580k.json` in this directory (production query, 2026-11-10 13:45 UTC). Live figures from production queries of `coordinator.event_summaries`, `coordinator.jobs` and `coordinator.lineage` for `eden-prod` (2026-11-10 14:00 UTC); raw export to follow. Both re-run on request.

---

## Fleet target distribution

591 ecoregions · 569,896 render-eligible images (6 Nov 2026) · no per-region cap.  
See `fleet-distribution.json`. Registered fleet as of 9 Nov 2026: 580,551 twins across 594 ecoregions (rung 4).
