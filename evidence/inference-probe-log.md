# Inference Throughput Probe — Job Log

Branch: `evidence/nosana-inference-probe`  
Updated: 2026-11-12

## Session cost running total

**733,546 raw / 0.7335 NOS** (jobs 1–9, verified against wallet ATA delta from tx history)

## Job table

| # | Job ID (prefix) | Market | Outcome | Billed s | Net raw | What the log pins |
|---|---|---|---|---|---|---|
| 1 | BufJNa | PREMIUM 97G9… | timeout/delist | 0 | 0 | Not pinned — timed out in queue before any node claimed |
| 2 | 2awU8GZe | COMMUNITY Dcwz62… | job_error | 251 | 62,750 | Server started, became healthy, ran 251 s. llama-server used CPU (n_threads=6, no GPU thread pool). libggml-cuda.so present but CUDA backend silently not loaded — no LD_LIBRARY_PATH set. Script exited 1 at GPU offload check. |
| 3 | 5R7c11Vy | COMMUNITY Dcwz62… | host_error | 179 | 44,750 | Not pinned — opStates empty; result not published ("Failed to publish the job result: fetch failed"); what ran during 179 billed s is unknown |
| 4 | 6zqSqaZF | PREMIUM 97G9… | timeout | 0 | 0 | Not pinned — timed out in queue (~15 min, no node claimed) |
| 5 | 6oRMVaMD | COMMUNITY Dcwz62… | job_error | 115 | 28,980 | Pre-flight reached step 1d (--list-devices). `grep -qi 'CUDA\|cuda\|GPU'` (BRE) matched literal `\|` not alternation — false FATAL despite CUDA0 present. Script exited 1 before model download. |
| 6 | DWYkoeKF | COMMUNITY Dcwz62… | job_error | 900 | 226,800 | All pre-flights passed: CUDA0 found, VRAM 10,127 MiB (model on GPU), driver 595.99.02 compat. Benchmark started ms=1794440493867. No batch completed — SIGKILL (exit 137) at 900 s job timeout while batch 1 was in-flight. |
| 7 | 5D4Tg2kq | COMMUNITY Dcwz62… | host_error | 886 | 225,044 | Not pinned — opStates empty; result not published ("Failed to publish the job result: fetch failed"); what ran during 886 billed s is unknown |
| 8 | 8bgHCNus | COMMUNITY Dcwz62… | validation-error | 5 | 1,265 | Node rejected job def before container started. ops[0].id="VLLM-llama3.1" failed node-side TagBase<operationId> validator — dot in id string. Fixed: id renamed to "vllm-llama31". |
| 9 | C31VmBHox | COMMUNITY Dcwz62… | **ok** | 569 | **143,957** | **200/200 Readings ok. 3.45 R/s, p50=8807ms, p95=9105ms. Prompt 952 tokens (measured), completion 180. vLLM 0.5.4, AWQ INT4. Time-to-healthy 500.5 s (fresh S3 pull). Chain: COMPLETED, deposit 455,400 raw, refund 311,443 raw, net 143,957 raw.** |

## Notes

- Jobs 3 and 7 are the same failure class: host claimed, billed for time, then failed to publish IPFS result. What ran during those seconds is unknown.
- Job 6 is the only llama.cpp run where GPU inference was confirmed (VRAM 10,127 MiB). It was killed by the 900 s platform timeout mid-benchmark; this is now fixed (jobTimeoutSecs=1800, 480 s watchdog).
- Job 2's CPU-only failure led to adding LD_LIBRARY_PATH pre-flight and the --list-devices hard-fail check.
- Job 5's false FATAL led to switching from BRE `grep -qi 'CUDA\|cuda\|GPU'` to `grep -qE "^[[:space:]]*CUDA[0-9]+:"`.
- Premium market (97G9…) had no idle nodes when job 4 was submitted (queue timeout); idle-node pre-submit check added after job 4.
- Job 8: validation-error fires server-side before any container starts; opStates is empty. Dot in op id. Fixed.
- Job 9: first successful inference measurement. Probe ran from local machine via exposed endpoint. IPFS opStates empty (expected for service-mode jobs — probe did not run inside the container).
