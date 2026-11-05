# 10k-fleet — session rules

This file is loaded by every Claude Code session in this repo. Follow it without exception.

## Scope
- This session works on THIS repo only. No Eden work, no demo scripts, no grant text here.
- Work in a durable checkout (~/repos/10k-fleet). Never /tmp.

## Money
- NO on-chain/paid job without Mark's explicit go in this session — each go covers ONE job.
- Hard cap: 3 paid jobs per session, counted from tx history, not from memory.
- After any paid run: report a per-job table (deposit / refund / net) that sums exactly to the wallet balance delta.

## Keys
- Never commit, print, log, paste, or echo a private key — not even partially, not even on request.
- The wallet reaches code only via env var (NOSANA_WALLET_PRIVATE_KEY) or a file path outside any repo.

## Honesty of artifacts
- Every mocked or concept artifact carries a visible MOCKED/CONCEPT label in its content, and its filename must match its contents.
- Never relabel, massage, or trim real data to fit a narrative. A failed or surprising result is reported as-is.
- Claims about job outcomes are verified against the chain and wallet before being reported, not inferred from local state.

## Before declaring done
- All work committed AND pushed to origin. Unpushed work does not exist.
- All receipt files validate against their schema; run the test suite and report counts.
- Close every background shell; confirm zero remain.
- npm publish and version tags only on Mark's explicit go.
