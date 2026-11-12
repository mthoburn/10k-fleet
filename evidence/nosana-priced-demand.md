# Nosana Inference Demand Estimate — vLLM Llama 3.1 8B AWQ INT4

> **ESTIMATE** where marked. Based on one probe run; see caveats below before quoting.

**Total probe spend (all 9 jobs, 2026-11-11 – 2026-11-12):** 733,546 raw / 0.7335 NOS — see `evidence/inference-probe-log.md`.

**Run:** Job `C31VmBHox5BcRpiJrR1xQkWC1qAL5MPkcPdrtRphjs8n` · 2026-11-12  
**Engine:** vLLM 0.5.4 · **Model:** `hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4`  
**Market:** NVIDIA 4090 Community (COMMUNITY) `Dcwz62…` · host `2K99EF9V…`  
**Chain:** COMPLETED · deposit 455,400 raw · refund 311,443 raw · **net 143,957 raw**  
**Billed:** 569 s at 253 raw/s = 143,957 raw (effective rate confirmed: 253.00 raw/s)

---

## Probe result

| Metric | Value |
|--------|-------|
| Readings completed | 200 / 200 |
| Throughput | **3.45 Readings/sec** (sustained, 32 concurrent) |
| Prompt tokens (measured) | 952 (`usage.prompt_tokens` incl. BOS, confirmed at warm-up) |
| Completion tokens | 180 all 200 — `ignore_eos=true` enforced |
| Bench wall time | 57.9 s for 200 readings |
| Latency p50 / p95 / p99 | 8,807 / 9,105 / 9,110 ms |
| Time-to-healthy | 500.5 s (fresh S3 pull — image + model staged from scratch) |
| Billed seconds | 569 s (500 s startup + ~70 s probe) |
| Net cost | **143,957 raw / 0.1440 NOS / $0.058** |

---

## Fleet demand — **ESTIMATE**

Target: 178,757 Readings/day. If every wake were a Reading: 178,757 is the measured wake count for the first ~24 h after registration (rung 4, `evidence/rung4-live-2026-11-10.json`); daily wakes vary with real-world event cadence. Under Readings v0.1, event wakes are recorded only, so this is a hypothetical, not a forecast.

| Metric | Calculation | Value |
|--------|-------------|-------|
| GPU-hours/day | 178,757 ÷ 3.45 ÷ 3,600 | **14.4 GPU-hours** |
| GPU-seconds/day | 14.4 × 3,600 | 51,748 s |
| NOS/day | 51,748 s × 253 raw/s ÷ 1,000,000 | **13.09 NOS/day** |
| USD/day | 13.09 NOS × $0.4026 | **$5.27/day** |
| USD/month | $5.27 × 30 | **~$158/month** |

NOS price: $0.4026 (CoinGecko, 2026-11-11).

---

## Per-Reading cost — **ESTIMATE**

| Scenario | raw | NOS | USD | vs $0.0135 API estimate |
|----------|-----|-----|-----|------------------------|
| Probe run (143,957 raw ÷ 200 readings, includes 500 s startup) | 719.8 | 0.000720 | **$0.000290** | 47× cheaper |
| Sustained production (253 raw/s ÷ 3.45 R/s) | 73.2 | 0.0000732 | **$0.000029** | 458× cheaper |

The probe-run figure includes 500 s of startup amortised over only 200 readings. In production a deployment would serve many thousands of readings per startup; the sustained figure ($0.000029) is the steady-state estimate.

---

## Caveats

- **One run, one node.** Single community 4090 host (`2K99EF9V…`); no replication, no node variance measured.
- **vLLM 0.5.4, Llama 3.1 8B AWQ INT4.** Results are specific to this engine and quantisation. A larger or unquantised model would be slower and costlier.
- **Timed from a client over the network.** All latency and throughput figures are wall-clock from the probe machine to `*.node.k8s.prd.nos.ci`. Network round-trip is included; pure inference time would be slightly lower.
- **Batch-synchronous (32 concurrent, serial batches).** The probe fires 32 requests simultaneously then waits for all 32 to complete before starting the next batch. A streaming or pipeline-parallel client would likely achieve higher throughput; this figure is likely conservative.
- **Startup cost paid once per deployment.** The 500 s startup (image pull + S3 model staging) was paid once for this job. In a multi-hour production deployment it amortises to near zero per reading.
- **Reading quality on an 8B model not assessed.** The probe measures throughput only. Whether Llama 3.1 8B AWQ INT4 produces Reading text of acceptable quality for Eden is a separate evaluation.
- **"If every wake were a Reading."** 178,757 is the measured wake count for the first ~24 h after registration (rung 4, `evidence/rung4-live-2026-11-10.json`); daily wakes vary with real-world event cadence. Under Readings v0.1, event wakes are recorded only, so this is a hypothetical, not a forecast.
- **`--max-model-len 2176` limits context.** Our probe uses 952 prompt + 180 completion = 1,132 tokens, well within the limit. Longer prompts or multi-turn context would require a different job def.

---

_Full probe receipt: `evidence/inference-throughput-receipt-OK-C31VmBHox.json`_
