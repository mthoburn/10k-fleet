# CONCEPT: synthetic policies, real Met Éireann warnings — shape-check

**Label (required on every report produced from this pair):** *CONCEPT: synthetic policies, real Met Éireann warnings.*

**Attribution (required on every report):** *Weather warnings sourced from Met Éireann.*

This one-pager specifies the wake policy, the event payload shape, event identity, submission order, and the report columns the Eden-side runner is expected to produce from the companion CONCEPT inputs:

- `docs/evidence/CONCEPT-storm-boelo-warnings.json` — Met Éireann warning time series, Republic of Ireland only.
- `docs/evidence/CONCEPT-ireland-policy-book-50k.json` — 50,000 synthetic policies, one twin each, `region = county`.

No code is executed here; no coordinator / Neon / Eden-side service is touched by this PR.

## Wake policy

- `minSeverity = orange`.
- Region exact-match on `county`.
- **Severity ordering:** `yellow < orange < red`. `minSeverity = orange` therefore matches **orange and red**, not yellow.
- No-insurer-data rule: the book is a CONCEPT set. Every report MUST carry the "CONCEPT: synthetic policies" label alongside any count derived from it.

## Event payload shape (per warning, chain-side analogue of Note 1's event model)

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
  "event_identity": "<see below>",
  "event_key": "<sha256(event_identity)>"
}
```

## Event identity

- If `warning_source_id` is present: `(warning_source_id, county, severity_band)`.
- Else: `(county, warning_type, severity_band)`.

Identity **does not include `issued_at`**. Consequences:

- A same-band extension (same Orange wind warning re-issued with a later `valid_to` on the same county) **deduplicates** — one wake per county per band per warning_type.
- A band escalation (e.g. Galway yellow wind → Galway orange wind) produces a **new** identity and **triggers a re-wake** for that county's twin.
- `issued_at` is retained **for submission order only**.

## Submission order

Submit warnings by `issued_at` ascending — mirrors real-time issue order. Where `issued_at` is marked APPROXIMATE in the warnings file, submit in the order the file lists them (the file preserves the intended chronology).

## Expected report columns (for the Eden-side runner)

1. **Broad-rule reach vs orange-rule wakes.** Policies in counties under ANY warning (today's broad rule) vs. twins woken under the `minSeverity = orange` rule. Expected: the broad rule reaches many more policies than it should; the orange rule wakes a smaller, intentional subset.
2. **Wakes per county.** How many twins woke per county (orange+ band).
3. **Escalation re-wakes.** How many wakes were escalations (yellow → orange or orange → red on the same (county, warning_type)) rather than first-time orange+ warnings. The Galway orange-wind escalation IS the archetype re-wake this concept demonstrates.
4. **Repeat deduplication.** Count of submitted warnings whose identity was already seen → recorded as deduped, not woken.
5. **Wake decision timing.** Time each wake was decided relative to its warning's `issued_at` (should be effectively instantaneous; the column surfaces lag if any).

Every column header and the report body must carry the two required lines at the top:

> CONCEPT: synthetic policies, real Met Éireann warnings.
> Weather warnings sourced from Met Éireann.

## What this spec does NOT do

- Does not execute any wake-decision replay.
- Does not connect to a coordinator / coordinator DB / Neon branch.
- Does not import from Eden `server/` or `client/`.
- Does not call any Nosana or paid or on-chain service. $0 across the board.
