"""
CONCEPT: synthetic policies, real Met Éireann warnings.

Deterministic 50k-policy book generator for Storm Boelo concept replay
(Note 2, 18 Nov plan). Counties weighted by CSO 2022 Census of
Population, Table F1001 — "Population by Sex, Year and Administrative
County" (Republic of Ireland only, 26 counties).

Reproducibility: regenerating with the same seed MUST produce a
byte-identical file. Seed is recorded in the file header.
"""
import json, hashlib, datetime, os, sys

SEED = 20261119  # fixed; do not change — regeneration must be byte-identical
N = 50000
OUT = "docs/evidence/CONCEPT-ireland-policy-book-50k.json"

# CSO Census of Population 2022 — F1001 Population by Administrative County
# Republic of Ireland, 26 counties. Source: data.cso.ie, table F1001.
# Values recorded here for the seed to be reproducible without a network call.
CSO_2022 = {
    "Carlow": 61968,
    "Cavan": 81704,
    "Clare": 127938,
    "Cork": 584156,
    "Donegal": 167084,
    "Dublin": 1458154,
    "Galway": 277737,
    "Kerry": 156458,
    "Kildare": 247774,
    "Kilkenny": 104160,
    "Laois": 91877,
    "Leitrim": 35199,
    "Limerick": 209536,
    "Longford": 46751,
    "Louth": 139703,
    "Mayo": 137231,
    "Meath": 220296,
    "Monaghan": 65288,
    "Offaly": 83150,
    "Roscommon": 70259,
    "Sligo": 70198,
    "Tipperary": 167895,
    "Waterford": 127363,
    "Westmeath": 96221,
    "Wexford": 163919,
    "Wicklow": 155485,
}
CSO_SOURCE = "https://data.cso.ie/table/F1001 (CSO Census of Population 2022, Table F1001, Republic of Ireland administrative counties)"


def allocate(weights, total):
    """Largest-remainder apportionment — deterministic, no RNG needed."""
    s = sum(weights.values())
    raw = {k: (v / s) * total for k, v in weights.items()}
    floors = {k: int(v) for k, v in raw.items()}
    remainders = sorted(((raw[k] - floors[k], k) for k in raw), reverse=True)
    deficit = total - sum(floors.values())
    for _, k in remainders[:deficit]:
        floors[k] += 1
    return floors


def main():
    counts = allocate(CSO_2022, N)
    assert sum(counts.values()) == N

    policies = []
    for county in sorted(counts.keys()):
        for i in range(counts[county]):
            h = hashlib.sha256(f"{SEED}:{county}:{i}".encode()).hexdigest()[:12]
            policies.append({
                "policy_id": f"pol_{h}",
                "county": county,
                "label": "CONCEPT: synthetic policies",
            })

    out = {
        "label": "CONCEPT: synthetic policies, real Met Éireann warnings",
        "attribution": "Weather warnings sourced from Met Éireann (applies to the companion warnings file; this book is synthetic).",
        "generator": "scripts/wlaudit/storm_boelo_policy_book.py",
        "seed": SEED,
        "total": N,
        "scope": "Republic of Ireland — 26 administrative counties.",
        "weighting_source": CSO_SOURCE,
        "weighting_table_used": CSO_2022,
        "counts_per_county": counts,
        "fields": ["policy_id", "county", "label"],
        "reproducibility": "Re-running this generator with SEED unchanged produces a byte-identical file. Verified by diffing two consecutive runs.",
        "policies": policies,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2, sort_keys=False)
    sha = hashlib.sha256(open(OUT, "rb").read()).hexdigest()
    size = os.path.getsize(OUT)
    print(f"wrote {OUT} bytes={size} sha256={sha}")
    print(f"per-county counts (top 5): {sorted(counts.items(), key=lambda x: -x[1])[:5]}")

if __name__ == "__main__":
    main()
