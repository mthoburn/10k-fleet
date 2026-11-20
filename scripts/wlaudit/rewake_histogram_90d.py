"""
Rewake histogram, last 90 days → now.

For ETH USDT and Tron USDT, counts RemovedBlackList + DestroyedBlackFunds
events per UTC day, with:
  - distinct days with ≥1 of each;
  - longest gap (days) between re-wake days;
  - empirical P(≥1 re-wake in a random 24h / 48h / 72h / 7-day window),
    computed by sliding the window over the full 90 days (analytic,
    using the union-of-wet-intervals method);
  - the same, restricted to wallets in the pinned dormant fleet
    (docs/evidence/dormant-fleet-usdt-enriched.json, sha256 pin).

Rate limits (shared-key rule if a detector is running on the same keys):
  - Etherscan V2: ≤ 1 call / 2 s   (2000 ms between calls)
  - TronGrid:    ≤ 2 calls / s     (500 ms between calls)

Output:
  docs/evidence/rewake-histogram-90d.json
  docs/evidence/rewake-histogram-90d.md

Carries "Census data powered by Etherscan".
"""
import os, json, urllib.request, urllib.parse, time, datetime, hashlib
import base58
from Crypto.Hash import keccak

EK = os.environ["ETHERSCAN_API_KEY"]
TK = os.environ["TRONGRID_API_KEY"]

ETH_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"

DORMANT_PIN_SHA256 = "bcd1edb34c4d5e43ac1a635f92a39d45fc17ce7aca7d7859b6fb5fef3c7038d7"
DORMANT_PATH = "docs/evidence/dormant-fleet-usdt-enriched.json"

# Window: [now - 90 days, now], UTC
NOW_UTC = int(datetime.datetime.now(tz=datetime.timezone.utc).timestamp())
WIN_START = NOW_UTC - 90 * 86400
WIN_END = NOW_UTC

ETHERSCAN_CALLS = 0
TRONGRID_CALLS = 0

ETH_SLEEP_S = 2.0   # ≤ 1 call / 2 s
TRON_SLEEP_S = 0.5  # ≤ 2 calls / s


def kk(sig):
    k = keccak.new(digest_bits=256); k.update(sig.encode()); return "0x" + k.hexdigest()


def _h(v):
    if not v or v == "0x": return 0
    try: return int(v, 16)
    except: return 0


def verify_dormant_hash():
    with open(DORMANT_PATH, "rb") as f:
        actual = hashlib.sha256(f.read()).hexdigest()
    if actual != DORMANT_PIN_SHA256:
        raise SystemExit(f"Dormant fleet sha256 mismatch: expected {DORMANT_PIN_SHA256}, got {actual}")
    print(f"✓ dormant-fleet sha256 matches pin ({DORMANT_PIN_SHA256})")


def eget(params, _retries=3):
    global ETHERSCAN_CALLS
    params = {**params, "apikey": EK, "chainid": 1}
    url = "https://api.etherscan.io/v2/api?" + urllib.parse.urlencode(params)
    for attempt in range(_retries):
        ETHERSCAN_CALLS += 1
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = json.loads(r.read().decode())
            msg = str(data.get("message", "")) + " " + str(data.get("result", ""))
            if "rate limit" in msg.lower() or "Max calls per sec" in msg:
                time.sleep(3.0 * (attempt + 1)); continue
            time.sleep(ETH_SLEEP_S)
            return data
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503):
                time.sleep(3.0 * (attempt + 1)); continue
            raise
    time.sleep(ETH_SLEEP_S)
    return data


def tget(path, params, _retries=3):
    global TRONGRID_CALLS
    for attempt in range(_retries):
        TRONGRID_CALLS += 1
        try:
            req = urllib.request.Request(
                f"https://api.trongrid.io{path}?" + urllib.parse.urlencode(params),
                headers={"TRON-PRO-API-KEY": TK},
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode())
            time.sleep(TRON_SLEEP_S)
            return data
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503):
                time.sleep(2.0 * (attempt + 1)); continue
            raise
    return data


def eth_block_for_ts(ts, closest="after"):
    r = eget({"module": "block", "action": "getblocknobytime",
              "timestamp": str(ts), "closest": closest})
    return int(r["result"])


def to_b58(hex20):
    raw = bytes.fromhex("41" + hex20[2:])
    cs = hashlib.sha256(hashlib.sha256(raw).digest()).digest()[:4]
    return base58.b58encode(raw + cs).decode()


# -----------------------------------------------------------------------------
# ETH USDT: fetch RemovedBlackList + DestroyedBlackFunds in the 90-day window
# -----------------------------------------------------------------------------
ETH_EVENTS = {
    "RemovedBlackList":   "RemovedBlackList(address)",
    "DestroyedBlackFunds": "DestroyedBlackFunds(address,uint256)",
}


def fetch_eth(from_block, to_block):
    out = {"RemovedBlackList": [], "DestroyedBlackFunds": []}
    for name, sig in ETH_EVENTS.items():
        t0 = kk(sig)
        page = 1
        while True:
            r = eget({"module": "logs", "action": "getLogs", "address": ETH_USDT,
                      "fromBlock": str(from_block), "toBlock": str(to_block),
                      "topic0": t0, "page": str(page), "offset": "1000"})
            chunk = r.get("result", [])
            if isinstance(chunk, str): break
            out[name].extend(chunk)
            if len(chunk) < 1000: break
            page += 1
            if page > 10: break
    # Dedup + extract wallet (data_word0)
    seen = set(); rows_by_event = {k: [] for k in out}
    for name, logs in out.items():
        for l in logs:
            key = (l["transactionHash"], _h(l.get("logIndex", "")))
            if key in seen: continue
            seen.add(key)
            data = l.get("data", "")
            if not data or len(data) < 66: continue
            w = "0x" + data[2:66][-40:].lower()
            rows_by_event[name].append({
                "chain": "eth", "event": name, "wallet": w,
                "tx": l["transactionHash"],
                "block": _h(l.get("blockNumber", "")),
                "ts_unix": _h(l.get("timeStamp", "")),
                "log_index": _h(l.get("logIndex", "")),
            })
    return rows_by_event


# -----------------------------------------------------------------------------
# Tron USDT: TronGrid v1/contracts/{addr}/events with min/max_block_timestamp
# -----------------------------------------------------------------------------
TRON_EVENTS = ["RemovedBlackList", "DestroyedBlackFunds"]


def fetch_tron():
    out = {"RemovedBlackList": [], "DestroyedBlackFunds": []}
    for name in TRON_EVENTS:
        fp = None; pages = 0
        while True:
            params = {"event_name": name, "limit": "200",
                      "order_by": "block_timestamp,asc",
                      "min_block_timestamp": str(WIN_START * 1000),
                      "max_block_timestamp": str(WIN_END * 1000)}
            if fp: params["fingerprint"] = fp
            d = tget(f"/v1/contracts/{TRON_USDT}/events", params)
            out[name].extend(d.get("data", []))
            fp = (d.get("meta") or {}).get("fingerprint")
            pages += 1
            if not fp or pages >= 30: break
    seen = set(); rows_by_event = {k: [] for k in out}
    for name, events in out.items():
        for e in events:
            key = (e.get("transaction_id"), e.get("event_index"))
            if key in seen: continue
            seen.add(key)
            res = e.get("result") or {}
            u = res.get("_user") or res.get("_blackListedUser") or res.get("0")
            if not u: continue
            uh = u.lower()
            hex20 = "0x" + (uh[2:] if uh.startswith("41") and len(uh) == 42 else uh[-40:])
            try: b58 = to_b58(hex20)
            except Exception: b58 = None
            rows_by_event[name].append({
                "chain": "tron", "event": name, "wallet": hex20, "tron_base58": b58,
                "tx": e.get("transaction_id"),
                "block": e.get("block_number"),
                "ts_unix": int(e.get("block_timestamp", 0)) // 1000,
                "event_index": e.get("event_index"),
            })
    return rows_by_event


# -----------------------------------------------------------------------------
# Day-bucketing + sliding-window probability
# -----------------------------------------------------------------------------
def day_buckets(rows):
    from collections import Counter
    c = Counter()
    for r in rows:
        d = datetime.datetime.utcfromtimestamp(r["ts_unix"]).strftime("%Y-%m-%d")
        c[d] += 1
    return dict(sorted(c.items()))


def longest_gap_days(day_set, win_start_ts, win_end_ts):
    """Longest run of consecutive UTC days WITHOUT an event, within the window."""
    # Build sorted list of days with events (as date objects)
    days = sorted(datetime.datetime.strptime(d, "%Y-%m-%d").date() for d in day_set)
    # Window days
    start_d = datetime.datetime.utcfromtimestamp(win_start_ts).date()
    end_d = datetime.datetime.utcfromtimestamp(win_end_ts).date()
    if not days:
        return (end_d - start_d).days + 1
    # Gaps: start→first, between, last→end
    gaps = []
    prev = start_d
    for d in days:
        gap = (d - prev).days  # days WITHOUT event between prev and d (exclusive of d)
        gaps.append(max(0, gap - (1 if prev != start_d else 0)))
        # cleaner: strict dry-days = (d - prev).days - (0 if prev==start_d else 1)
        # actually simpler: count dry days between events
        prev = d
    # tail
    tail = (end_d - prev).days
    gaps.append(tail)
    # Also lead
    lead = (days[0] - start_d).days
    gaps[0] = lead
    return max(gaps)


def union_wet_measure(events_ts, window_s, range_start, range_end):
    """
    Measure (seconds) of t in [range_start, range_end] such that
    [t, t+window_s] ∩ events ≠ ∅.
    Equivalent to union of intervals [E_i - window_s, E_i] intersected with
    [range_start, range_end].
    """
    if not events_ts:
        return 0
    intervals = sorted((e - window_s, e) for e in events_ts)
    # Clip and merge
    total = 0
    cur_lo = None; cur_hi = None
    for lo, hi in intervals:
        lo = max(lo, range_start); hi = min(hi, range_end)
        if lo >= hi: continue
        if cur_lo is None:
            cur_lo, cur_hi = lo, hi
        elif lo <= cur_hi:
            cur_hi = max(cur_hi, hi)
        else:
            total += cur_hi - cur_lo
            cur_lo, cur_hi = lo, hi
    if cur_lo is not None:
        total += cur_hi - cur_lo
    return total


def sliding_prob(events_ts, window_hours):
    """P(≥1 event in a random window of `window_hours`), window-start chosen
    uniformly in [WIN_START, WIN_END - W]."""
    W = window_hours * 3600
    range_start = WIN_START
    range_end = WIN_END - W
    if range_end <= range_start:
        return None
    wet = union_wet_measure(events_ts, W, range_start, range_end)
    return wet / (range_end - range_start)


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
def main():
    verify_dormant_hash()
    print(f"Window: {datetime.datetime.utcfromtimestamp(WIN_START).isoformat()}Z "
          f"→ {datetime.datetime.utcfromtimestamp(WIN_END).isoformat()}Z "
          f"(now, Unix {WIN_END})")

    # Dormant fleet addresses
    with open(DORMANT_PATH) as f:
        dormant = json.load(f)
    dormant_eth = {r["address"].lower() for r in dormant["rows"] if r.get("chain") == "eth"}
    dormant_tron = {r["address"].lower() for r in dormant["rows"] if r.get("chain") == "tron"}
    print(f"Dormant fleet: {len(dormant_eth)} ETH + {len(dormant_tron)} Tron = {len(dormant_eth)+len(dormant_tron)}")

    print("\n=== ETH USDT ===")
    eth_from = eth_block_for_ts(WIN_START, "after")
    eth_to = eth_block_for_ts(WIN_END, "before")
    print(f"ETH block range: {eth_from} .. {eth_to}")
    eth_rows = fetch_eth(eth_from, eth_to)
    for k, v in eth_rows.items():
        print(f"  {k}: {len(v)} events")

    print("\n=== Tron USDT ===")
    tron_rows = fetch_tron()
    for k, v in tron_rows.items():
        print(f"  {k}: {len(v)} events")

    # Per-chain, per-event: day buckets + distinct days + longest gap + windowed P
    def chain_stats(rows_by_event, dormant_set):
        out = {}
        for ev_name, rows in rows_by_event.items():
            all_ts = sorted(r["ts_unix"] for r in rows if WIN_START <= r["ts_unix"] <= WIN_END)
            days = day_buckets([r for r in rows if WIN_START <= r["ts_unix"] <= WIN_END])
            # Dormant-fleet subset
            fleet_rows = [r for r in rows if r["wallet"] in dormant_set
                          and WIN_START <= r["ts_unix"] <= WIN_END]
            fleet_ts = sorted(r["ts_unix"] for r in fleet_rows)
            fleet_days = day_buckets(fleet_rows)
            out[ev_name] = {
                "event_count_total": len(all_ts),
                "event_count_dormant_fleet": len(fleet_ts),
                "distinct_days_with_ge1_total": len(days),
                "distinct_days_with_ge1_dormant_fleet": len(fleet_days),
                "longest_dry_gap_days_total": longest_gap_days(set(days.keys()), WIN_START, WIN_END),
                "longest_dry_gap_days_dormant_fleet": longest_gap_days(set(fleet_days.keys()), WIN_START, WIN_END),
                "day_buckets_total": days,
                "day_buckets_dormant_fleet": fleet_days,
                "P_ge1_in_window_total": {
                    "24h": sliding_prob(all_ts, 24),
                    "48h": sliding_prob(all_ts, 48),
                    "72h": sliding_prob(all_ts, 72),
                    "7d":  sliding_prob(all_ts, 24 * 7),
                },
                "P_ge1_in_window_dormant_fleet": {
                    "24h": sliding_prob(fleet_ts, 24),
                    "48h": sliding_prob(fleet_ts, 48),
                    "72h": sliding_prob(fleet_ts, 72),
                    "7d":  sliding_prob(fleet_ts, 24 * 7),
                },
            }
        # Combined (any event, union of timestamps) — the number a round-length
        # question actually cares about.
        all_rows = []
        for rows in rows_by_event.values(): all_rows += rows
        all_ts = sorted(r["ts_unix"] for r in all_rows if WIN_START <= r["ts_unix"] <= WIN_END)
        all_days = day_buckets([r for r in all_rows if WIN_START <= r["ts_unix"] <= WIN_END])
        fleet_rows = [r for r in all_rows if r["wallet"] in dormant_set
                      and WIN_START <= r["ts_unix"] <= WIN_END]
        fleet_ts = sorted(r["ts_unix"] for r in fleet_rows)
        fleet_days = day_buckets(fleet_rows)
        out["Either"] = {
            "event_count_total": len(all_ts),
            "event_count_dormant_fleet": len(fleet_ts),
            "distinct_days_with_ge1_total": len(all_days),
            "distinct_days_with_ge1_dormant_fleet": len(fleet_days),
            "longest_dry_gap_days_total": longest_gap_days(set(all_days.keys()), WIN_START, WIN_END),
            "longest_dry_gap_days_dormant_fleet": longest_gap_days(set(fleet_days.keys()), WIN_START, WIN_END),
            "P_ge1_in_window_total": {
                "24h": sliding_prob(all_ts, 24),
                "48h": sliding_prob(all_ts, 48),
                "72h": sliding_prob(all_ts, 72),
                "7d":  sliding_prob(all_ts, 24 * 7),
            },
            "P_ge1_in_window_dormant_fleet": {
                "24h": sliding_prob(fleet_ts, 24),
                "48h": sliding_prob(fleet_ts, 48),
                "72h": sliding_prob(fleet_ts, 72),
                "7d":  sliding_prob(fleet_ts, 24 * 7),
            },
        }
        return out

    eth_stats = chain_stats(eth_rows, dormant_eth)
    tron_stats = chain_stats(tron_rows, dormant_tron)

    # Combined-chain: union of ETH + Tron timestamps for the round-length call
    combined_rows = {}
    for ev in ETH_EVENTS:
        combined_rows[ev] = eth_rows.get(ev, []) + tron_rows.get(ev, [])
    combined_stats = chain_stats(combined_rows, dormant_eth | dormant_tron)

    out = {
        "label": "90-day re-wake histogram (retrospective, read-only)",
        "attribution": "Census data powered by Etherscan.",
        "window_utc": {
            "start": datetime.datetime.utcfromtimestamp(WIN_START).isoformat() + "Z",
            "end":   datetime.datetime.utcfromtimestamp(WIN_END).isoformat() + "Z",
            "duration_days": 90,
            "note": "Window closes at script-run time (now); re-running regenerates with a different end.",
        },
        "generated_at_utc": datetime.datetime.utcnow().isoformat() + "Z",
        "sources": {
            "dormant_fleet": f"{DORMANT_PATH} (sha256 {DORMANT_PIN_SHA256})",
            "eth_usdt_contract": ETH_USDT,
            "tron_usdt_contract": TRON_USDT,
        },
        "method": (
            "ETH: Etherscan V2 logs/getLogs on ETH USDT for RemovedBlackList(address) "
            "and DestroyedBlackFunds(address,uint256), topic0-filtered, deduped by "
            "(tx_hash, log_index). Tron: TronGrid v1/contracts/{addr}/events with "
            "min/max_block_timestamp, deduped by (transaction_id, event_index). "
            "Sliding-window probability computed analytically as the union of wet "
            "intervals [E_i - W, E_i] ∩ [window_start, window_end - W], divided by "
            "the valid-range length. Dormant-fleet restriction joins wallet address "
            "against docs/evidence/dormant-fleet-usdt-enriched.json."
        ),
        "rate_limits_observed": {
            "etherscan_v2": "≤ 1 call / 2 s (2000 ms spacing)",
            "trongrid": "≤ 2 calls / s (500 ms spacing)",
        },
        "budget_used": {
            "etherscan_v2_calls": ETHERSCAN_CALLS,
            "trongrid_calls": TRONGRID_CALLS,
        },
        "eth_usdt": eth_stats,
        "tron_usdt": tron_stats,
        "combined": combined_stats,
    }
    with open("docs/evidence/rewake-histogram-90d.json", "w") as f:
        json.dump(out, f, indent=2, default=str)
    print("\nwrote docs/evidence/rewake-histogram-90d.json")
    print(f"budget: etherscan={ETHERSCAN_CALLS} trongrid={TRONGRID_CALLS}")

    # Short MD summary
    def pct(p):
        return "—" if p is None else f"{100*p:.1f}%"
    md = []
    md.append("# 90-day re-wake histogram\n")
    md.append("*Census data powered by Etherscan.*\n")
    md.append(f"- Window: `{out['window_utc']['start']}` → `{out['window_utc']['end']}` (90 days to script-run time).")
    md.append(f"- Dormant fleet pin: `{DORMANT_PATH}` (sha256 `{DORMANT_PIN_SHA256}`).")
    md.append(f"- Chains: ETH USDT + Tron USDT. Events: `RemovedBlackList`, `DestroyedBlackFunds`.\n")
    md.append("## Headline — P(≥1 re-wake in a random window)\n")
    md.append("| Chain | Scope | 24 h | 48 h | 72 h | 7 d |")
    md.append("|---|---|---:|---:|---:|---:|")
    def row(label, stats_blob, scope_key):
        p = stats_blob["Either"][scope_key]
        md.append(f"| {label} | {'total' if scope_key.endswith('total') else 'dormant fleet'} "
                  f"| {pct(p['24h'])} | {pct(p['48h'])} | {pct(p['72h'])} | {pct(p['7d'])} |")
    row("ETH USDT",   eth_stats,      "P_ge1_in_window_total")
    row("ETH USDT",   eth_stats,      "P_ge1_in_window_dormant_fleet")
    row("Tron USDT",  tron_stats,     "P_ge1_in_window_total")
    row("Tron USDT",  tron_stats,     "P_ge1_in_window_dormant_fleet")
    row("Combined",   combined_stats, "P_ge1_in_window_total")
    row("Combined",   combined_stats, "P_ge1_in_window_dormant_fleet")

    md.append("\n## Per-event cadence\n")
    md.append("| Chain | Event | Count | Distinct days | Longest dry gap (days) |")
    md.append("|---|---|---:|---:|---:|")
    for chain_label, stats in (("ETH USDT", eth_stats), ("Tron USDT", tron_stats)):
        for ev in ("RemovedBlackList", "DestroyedBlackFunds", "Either"):
            s = stats[ev]
            md.append(f"| {chain_label} | {ev} | {s['event_count_total']} "
                      f"| {s['distinct_days_with_ge1_total']} | {s['longest_dry_gap_days_total']} |")

    md.append("\n## Dormant-fleet-restricted cadence (same table, joined on wallet)\n")
    md.append("| Chain | Event | Count (fleet) | Distinct days | Longest dry gap (days) |")
    md.append("|---|---|---:|---:|---:|")
    for chain_label, stats in (("ETH USDT", eth_stats), ("Tron USDT", tron_stats)):
        for ev in ("RemovedBlackList", "DestroyedBlackFunds", "Either"):
            s = stats[ev]
            md.append(f"| {chain_label} | {ev} | {s['event_count_dormant_fleet']} "
                      f"| {s['distinct_days_with_ge1_dormant_fleet']} | {s['longest_dry_gap_days_dormant_fleet']} |")

    md.append("\n## Budget used\n")
    md.append(f"- Etherscan V2 calls: **{ETHERSCAN_CALLS}** (rate: ≤ 1 call / 2 s)")
    md.append(f"- TronGrid calls:     **{TRONGRID_CALLS}** (rate: ≤ 2 calls / s)")
    md.append("- $0, read-only. Keys loaded from `~/keys/api-keys.txt`, never printed.")

    with open("docs/evidence/rewake-histogram-90d.md", "w") as f:
        f.write("\n".join(md) + "\n")
    print("wrote docs/evidence/rewake-histogram-90d.md")


if __name__ == "__main__":
    main()
