# CONCEPT: synthetic policies, real Met Éireann warnings

> CONCEPT: synthetic policies, real Met Éireann warnings.
> Weather warnings sourced from Met Éireann.

Generated 2026-11-19T17:58:01.355Z · storm-boelo example, coordinator replay. Policies are synthetic; warnings are real (Storm Boelo, 23–26 Oct 2026, Republic of Ireland). No inference, no provider calls.

## Headline

| Measure | Value |
| --- | ---: |
| Total policies (synthetic) | 50,000 |
| Policies in any-warning counties (broad rule) | 38,309 |
| Twins woken by the rule (minSeverity = orange) | 8,198 |
| Woken ÷ broad | 21.4% |
| Wake decisions recorded (a twin can wake for more than one event) | 10,896 |
| Warning events submitted (one per county) | 36 |
| Escalation re-wakes (events / twin wakes) | 3 / 6,916 |
| Repeats deduplicated | 4 |
| Below threshold (yellow, not woken) | 25 |
| Coordinator decisions match expected | yes |

## Wakes per county

| County | Policies | Orange+ events woken | Wake decisions |
| --- | ---: | ---: | ---: |
| Donegal | 1,623 | 1 | 1,623 |
| Galway | 2,698 | 2 | 5,396 |
| Kerry | 1,520 | 1 | 1,520 |
| Leitrim | 342 | 1 | 342 |
| Mayo | 1,333 | 1 | 1,333 |
| Sligo | 682 | 1 | 682 |

## Escalation re-wakes

| County | Type | Escalation | Warning id | Twins woken |
| --- | --- | --- | --- | ---: |
| Galway | wind | yellow → orange | orange-wind-updated-adds-galway | 2,698 |
| Galway | rain | yellow → orange | orange-rain-galway-kerry | 2,698 |
| Kerry | rain | yellow → orange | orange-rain-galway-kerry | 1,520 |

## Repeats deduplicated

| County | Type | Band | Warning id | Issued (UTC) |
| --- | --- | --- | --- | --- |
| Donegal | wind | orange | orange-wind-updated-adds-galway | 2026-10-23T12:00:00Z |
| Leitrim | wind | orange | orange-wind-updated-adds-galway | 2026-10-23T12:00:00Z |
| Mayo | wind | orange | orange-wind-updated-adds-galway | 2026-10-23T12:00:00Z |
| Sligo | wind | orange | orange-wind-updated-adds-galway | 2026-10-23T12:00:00Z |

---
CONCEPT: synthetic policies, real Met Éireann warnings. Weather warnings sourced from Met Éireann.
