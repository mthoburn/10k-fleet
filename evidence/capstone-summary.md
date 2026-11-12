# Capstone Readings Run — Rung 5 Evidence

> **DEMONSTRATION:** outputs are evidence files, NOT written into production readings tables.

**Job ID:** `ECb5Way34T7TN6xTPnvFfqdJysCxwxk59Fy2zB7QeyTy`
**Date:** 2026-11-12
**Market:** NVIDIA 4090 Community (COMMUNITY) `Dcwz62Ti…`
**Host:** `EkEEjgQu…`
**Outcome:** ok

---

## What this demonstrates

The end-to-end loop: real wake records from eden-prod → one Nosana vLLM inference job → Readings generated → receipted. This is rung 5 of the 10k-fleet grant ladder.

---

## Wake batch

| Metric | Value |
|--------|-------|
| Total wakes | 190 |
| Twin kinds | image (40), organism-spawn (150) |
| Unique events | 4 (all events in coordinator history) |
| Event types | EQ, TC, FL |
| Date range | 2026-10-12 → 2026-11-09 |

Source: `coordinator.wake_decisions` JOIN `coordinator.twins` JOIN `coordinator.events` JOIN eden-prod `unified_events` / `event_spawns` / `botanical_entities`. Pulled live from production 2026-11-12.

---

## Readings generated

| Metric | Value |
|--------|-------|
| Readings OK | **190 / 190** |
| Throughput | **7.58 R/s** |
| Latency p50 / p95 | 3978 / 4632 ms |
| Bench wall time | 25.1s |

---

## Cost

| Metric | Value |
|--------|-------|
| Market price | 262 raw/s (ticked up from 253 raw/s at job C31VmBHox) |
| Billed seconds | 242s (chain: timeEnd − timeStart) |
| Deposit | 471,600 raw (262 × 1800s timeout) |
| Refund | 408,196 raw (262 × 1558 unused seconds) |
| **Net raw** | **63,404 raw** |
| **Net NOS** | **0.063404 NOS** |
| **Net USD** | **$0.0255** |
| Per-Reading (net) | 333.7 raw / $0.000134 |

NOS price: $0.4026 (CoinGecko 2026-11-11, **ESTIMATE**).

> **Reconciliation note:** ATA delta measured immediately after `jobs.end()` was 471,600 raw (the full deposit, refund not yet settled on-chain). Net is reconciled from chain fields: `timeStart=1794499592`, `timeEnd=1794499834`, billed = 242s × 262 raw/s = 63,404 raw. Refund of 408,196 raw returns to wallet after on-chain settlement.

---

## Extrapolations — ESTIMATE

| Scenario | Value |
|----------|-------|
| At current fleet size (190 wakes, all events to date) | $0.0255 per full cycle |
| At probe throughput (3.45 R/s, 178,757 wakes/day) | **~$5.27/day** (see nosana-priced-demand.md) |
| Per-Reading sustained rate | **~$0.000029** (see nosana-priced-demand.md) |

All extrapolations labelled ESTIMATE. See `evidence/nosana-priced-demand.md` for methodology and caveats.

## Sample Readings

### Reading 1 — Ceratias holboelli / Earthquake

**Wake:** `537917cf-2df9-42f8-a5c9-eb045a4f8635`
**Organism:** Ceratias holboelli (Kroyer's deep sea angler fish) · habitat `meow:20048`
**Event:** Earthquake in Japan · 36.25°N 141.83°E
**Tokens:** 243 prompt / 180 completion · 3706ms

> At 4:52 AM on November 9th, 2026, an earthquake struck the coastal waters of Japan, centered 36.2471°N, 141.8299°E, with a measured 3.0/10 severity index. This low-magnitude seismic event is unlikely to have caused significant disruptions to Kroyer's deep sea angler fish, Ceratias holboelli, populations, but may have triggered sediment re-suspension and temporary changes in water chemistry. On the seafloor, earthquake-induced sediment redistribution could potentially impact the nearby habitat of the brittle star, Amphipholis squamata, a common associate of Kroyer's deep sea angler fish. Further monitoring is required to fully assess the impact of this event on the meadow habitat, meow:20048. 

Word count: 79. Reading style: Specific

### Reading 2 — Oithona atlantica / Earthquake

**Wake:** `ad60fc27-0192-45aa-8859-6cb94cb77e9a`
**Organism:** Oithona atlantica · habitat `meow:20048`
**Event:** Earthquake in Japan · 36.25°N 141.83°E
**Tokens:** 231 prompt / 180 completion · 4223ms

> ad60fc27-0192-45aa-8859-6cb94cb77e9a. 

Here is a Reading for the wake ad60fc27-0192-45aa-8859-6cb94cb77e9a:

The earthquake in Japan has likely triggered landslides and sediment mobilization in the surrounding watersheds of the Ogasawara warm current, a critical oceanic feature influencing the coastal waters where Oithona atlantica, a key copepod species, is found. As a result, increased turbidity and suspended sediment in the water column may alter the light availability for phytoplankton growth, potentially cascading to changes in the food web structure of this marine ecosystem. These impacts may be felt by Oithona atlantica, a species sensitive to changes in water quality and light availability, which plays a crucial role

### Reading 3 — Clausocalanus lividus Frost & Fleminger, 1968 / Earthquake

**Wake:** `10fd9b65-bcd2-4101-bbba-d973ba615ddb`
**Organism:** Clausocalanus lividus Frost & Fleminger, 1968 · habitat `meow:20048`
**Event:** Earthquake in Japan · 36.25°N 141.83°E
**Tokens:** 237 prompt / 180 completion · 4071ms

> Here is the Reading: 

This earthquake, centered 100 km south of Morioka in the western coastal region of Iwate, Japan, has generated seismic waves that will reach Clausocalanus lividus, a small copepod native to the waters of the Iwate coastal ecoregion, in the Pacific Ocean. This tiny crustacean, a key component of the pelagic food web, has likely experienced changes in temperature and flow regimes due to the subsidence and sediment redistribution caused by the earthquake. The impact on its native habitat's chemistry and food supply, such as the primary production of phytoplankton and zooplankton, will depend on the duration and intensity of the event, but an alteration in copepod populations is a likely consequence. 

Note: The Reading assesses the impact of the earthquake on the copepod Clausocalanus lividus,


---

## Caveats

- **DEMONSTRATION:** no Reading records were written to production tables.
- **190 wakes vs 178,757 in rung 4 — these count different things.** 190 is the number of individually recorded `wake_decisions` rows written during the coordinator's non-shadow phases (Oct 12 – Nov 9, 2026). The 178,757 in rung 4 are shadow-mode aggregate counters (`event_summaries.woken_shadow`), which by design do not write per-twin rows — they count wakes that would have fired had shadow mode been off. This batch uses every per-twin record that exists; at scale, shadow counters become per-twin records and batches grow accordingly.
- **Quality not evaluated.** The 8B AWQ INT4 model generates plausible ecological text but quality has not been reviewed by a domain expert.
- **Same caveats as probe** (single node, single run, one community 4090): see `evidence/nosana-priced-demand.md#caveats`.

---

_Full receipt: `evidence/capstone-receipt.json`_
_All readings: `evidence/capstone-readings.json`_
_Source wakes: `evidence/capstone-wakes.json`_
